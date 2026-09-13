import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_GAME_RECORDER_PREFERENCES } from "../../shared";
import {
  buildLinuxRecorderFfmpegArguments,
  parseLinuxRecorderDevices,
} from "./linux-recorder-ffmpeg";
import { selectPulseMonitorSource } from "./linux-audio-mixer";

test("Linux recorder uses an exact X11 window and never a desktop rectangle", () => {
  const output = buildLinuxRecorderFfmpegArguments({
    configuration: DEFAULT_GAME_RECORDER_PREFERENCES,
    windowId: "1234",
    display: ":99",
    sourceWidth: 640,
    sourceHeight: 360,
    outputPattern: "/tmp/output-%08d.mp4",
    pulseMonitor: null,
  });
  assert.deepEqual(
    output.args.slice(
      output.args.indexOf("-window_id"),
      output.args.indexOf("-window_id") + 4
    ),
    ["-window_id", "1234", "-i", ":99"]
  );
  assert.ok(!output.args.includes("pulse"));
  assert.ok(!output.args.includes("-grab_x"));
  assert.ok(output.args.includes("libx264"));
});

test("monitor resolution selects only the default sink's explicitly related monitor", () => {
  const sinks = [{ name: "headphones", index: 7 }];
  const sources = [
    { name: "microphone", monitor_of_sink: 4294967295 },
    { name: "speaker.monitor", monitor_of_sink: 2 },
    { name: "headphones.monitor", monitor_of_sink: 7 },
  ];
  assert.equal(
    selectPulseMonitorSource("headphones", sinks, sources),
    "headphones.monitor"
  );
  assert.equal(
    selectPulseMonitorSource("headphones", sinks, sources.slice(0, 2)),
    null
  );
  assert.equal(
    selectPulseMonitorSource("headphones", sinks, [
      { name: "default", monitor_of_sink: 7 },
    ]),
    null
  );
  assert.equal(selectPulseMonitorSource("unknown", sinks, sources), null);
});

test("Linux audio input is an explicit monitor and invalid handles/displays are rejected", () => {
  const options = {
    configuration: DEFAULT_GAME_RECORDER_PREFERENCES,
    windowId: "123",
    display: ":1.0",
    sourceWidth: 640,
    sourceHeight: 360,
    outputPattern: "/tmp/output.mp4",
    pulseMonitor: "headphones.monitor",
  };
  const { args } = buildLinuxRecorderFfmpegArguments(options);
  assert.deepEqual(
    args.slice(args.indexOf("pulse") - 1, args.indexOf("pulse") + 3),
    ["-f", "pulse", "-i", "headphones.monitor"]
  );
  assert.throws(() =>
    buildLinuxRecorderFfmpegArguments({ ...options, pulseMonitor: "default" })
  );
  assert.throws(() =>
    buildLinuxRecorderFfmpegArguments({ ...options, windowId: "0" })
  );
  assert.throws(() =>
    buildLinuxRecorderFfmpegArguments({ ...options, windowId: "4294967296" })
  );
  assert.throws(() =>
    buildLinuxRecorderFfmpegArguments({ ...options, display: "remote-host:0" })
  );
  const videoOnly = buildLinuxRecorderFfmpegArguments({
    ...options,
    configuration: { ...options.configuration, captureGameAudio: false },
  });
  assert.ok(
    !videoOnly.args.includes("pulse"),
    "a discovered monitor never overrides the user's disabled audio preference"
  );
  assert.deepEqual(
    parseLinuxRecorderDevices(
      " D  x11grab X11 screen capture\n D  pulse Pulse audio input\n"
    ),
    { x11: true, pulse: true }
  );
  assert.deepEqual(
    parseLinuxRecorderDevices(" D  x11grab X11\n DE pulse Pulse audio\n"),
    { x11: true, pulse: true }
  );
});
