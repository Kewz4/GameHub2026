import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_GAME_RECORDER_PREFERENCES } from "../../shared";
import { buildLinuxRecorderFfmpegArguments } from "./linux-recorder-ffmpeg";
import {
  buildLinuxEncoderProbeArguments,
  isVaapiRenderNode,
  selectLinuxRecorderEncoder,
  type LinuxRecorderEncoder,
} from "./linux-recorder-encoder";

const codec = (args: string[]) => args[args.indexOf("-c:v") + 1];

test("selects NVENC only after a successful real-encode command, never an encoder listing", async () => {
  const calls: string[][] = [];
  const selected = await selectLinuxRecorderEncoder("ffmpeg", {
    run: async (args) => {
      calls.push(args);
    },
    renderNodes: async () => [],
  });
  assert.deepEqual(selected, { name: "h264_nvenc", hardware: true });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes("testsrc2=size=256x256:rate=30:duration=0.1"));
  assert.ok(calls[0].includes("-frames:v"));
  assert.ok(!calls[0].includes("-encoders"));
  assert.ok(!calls[0].includes("x11grab") && !calls[0].includes("pulse"));
});

test("driver/probe failure selects a probed VA-API node and validates the upload path", async () => {
  const calls: string[][] = [];
  const selected = await selectLinuxRecorderEncoder("ffmpeg", {
    run: async (args) => {
      calls.push(args);
      if (codec(args) === "h264_nvenc") throw new Error("driver unavailable");
    },
    renderNodes: async () => [
      "/tmp/not-a-gpu",
      "/dev/dri/renderD128",
      "/dev/dri/renderD128",
    ],
  });
  assert.deepEqual(selected, {
    name: "h264_vaapi",
    hardware: true,
    renderNode: "/dev/dri/renderD128",
  });
  assert.equal(calls.length, 2);
  assert.ok(calls[1].includes("-vaapi_device"));
  assert.ok(calls[1].includes("format=nv12,hwupload"));
});

test("permission/timeouts/unsupported hardware fall back to a successful software encode", async () => {
  const calls: string[][] = [];
  const selected = await selectLinuxRecorderEncoder("ffmpeg", {
    run: async (args) => {
      calls.push(args);
      if (codec(args) !== "libx264") throw new Error("EACCES or timed out");
    },
    renderNodes: async () => ["/dev/dri/renderD128"],
  });
  assert.deepEqual(selected, { name: "libx264", hardware: false });
  assert.deepEqual(calls.map(codec), ["h264_nvenc", "h264_vaapi", "libx264"]);
  assert.equal(
    await selectLinuxRecorderEncoder("missing", {
      run: async () => {
        throw new Error("ENOENT");
      },
      renderNodes: async () => {
        throw new Error("EACCES");
      },
    }),
    null
  );
});

test("runtime software retry never re-enters a failed hardware device", async () => {
  const calls: string[][] = [];
  const selected = await selectLinuxRecorderEncoder("ffmpeg", {
    softwareOnly: true,
    renderNodes: async () => {
      throw new Error("must not enumerate hardware");
    },
    run: async (args) => {
      calls.push(args);
    },
  });
  assert.equal(selected?.name, "libx264");
  assert.deepEqual(calls.map(codec), ["libx264"]);
});

test("every encoder preserves exact X11 targeting and explicit output-monitor selection", () => {
  const candidates: LinuxRecorderEncoder[] = [
    { name: "h264_nvenc", hardware: true },
    { name: "h264_vaapi", hardware: true, renderNode: "/dev/dri/renderD128" },
    { name: "libx264", hardware: false },
  ];
  for (const encoder of candidates) {
    const { args } = buildLinuxRecorderFfmpegArguments({
      configuration: DEFAULT_GAME_RECORDER_PREFERENCES,
      windowId: "123",
      display: ":99",
      sourceWidth: 640,
      sourceHeight: 360,
      outputPattern: "/tmp/segment-%08d.mp4",
      pulseMonitor: "test.monitor",
      encoder,
    });
    assert.equal(args[args.indexOf("-window_id") + 1], "123");
    assert.equal(codec(args), encoder.name);
    assert.ok(args.includes("test.monitor"));
    assert.ok(!args.includes("default") && !args.includes("-grab_x"));
    if (encoder.name === "h264_vaapi")
      assert.match(args[args.indexOf("-vf") + 1], /format=nv12,hwupload$/);
  }
  assert.equal(isVaapiRenderNode("/dev/dri/renderD128"), true);
  assert.equal(isVaapiRenderNode("/dev/dri/../video0"), false);
  assert.throws(() =>
    buildLinuxEncoderProbeArguments({
      name: "h264_vaapi",
      hardware: true,
      renderNode: "/dev/video0",
    })
  );
});
