import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GameRecorderQualityPreset } from "../../types";

export type LinuxRecorderEncoder =
  | { name: "libx264"; hardware: false }
  | { name: "h264_nvenc"; hardware: true }
  | { name: "h264_vaapi"; hardware: true; renderNode: string };

export const LINUX_SOFTWARE_ENCODER: LinuxRecorderEncoder = {
  name: "libx264",
  hardware: false,
};
const execFileAsync = promisify(execFile);

export const isVaapiRenderNode = (value: string) =>
  /^\/dev\/dri\/renderD\d{1,5}$/.test(value);

export const listAccessibleVaapiRenderNodes = async (): Promise<string[]> => {
  const entries = await fs.promises.readdir("/dev/dri").catch(() => []);
  const candidates = entries
    .filter((name) => /^renderD\d{1,5}$/.test(name))
    .sort()
    .slice(0, 4);
  const accessible = await Promise.all(
    candidates.map(async (name) => {
      const candidate = `/dev/dri/${name}`;
      try {
        const stat = await fs.promises.lstat(candidate);
        if (!stat.isCharacterDevice()) return null;
        await fs.promises.access(
          candidate,
          fs.constants.R_OK | fs.constants.W_OK
        );
        return candidate;
      } catch {
        return null;
      }
    })
  );
  return accessible.filter(
    (candidate): candidate is string => candidate !== null
  );
};

export const linuxEncoderPlan = (
  encoder: LinuxRecorderEncoder,
  quality: GameRecorderQualityPreset = "balanced"
) => {
  if (encoder.name === "h264_vaapi") {
    if (!isVaapiRenderNode(encoder.renderNode))
      throw new Error("Invalid VA-API render node");
    return {
      deviceArguments: ["-vaapi_device", encoder.renderNode],
      pixelFilter: "format=nv12,hwupload",
      encoderArguments: ["-c:v", "h264_vaapi", "-profile:v", "high"],
    };
  }
  if (encoder.name === "h264_nvenc") {
    return {
      deviceArguments: [],
      pixelFilter: "format=nv12",
      encoderArguments: [
        "-c:v",
        "h264_nvenc",
        "-preset",
        "p4",
        "-tune",
        "hq",
        "-profile:v",
        "high",
        "-forced-idr",
        "1",
      ],
    };
  }
  return {
    deviceArguments: [],
    pixelFilter: "format=yuv420p",
    encoderArguments: [
      "-c:v",
      "libx264",
      "-preset",
      quality === "performance" ? "ultrafast" : "veryfast",
    ],
  };
};

export const buildLinuxEncoderProbeArguments = (
  encoder: LinuxRecorderEncoder
) => {
  const plan = linuxEncoderPlan(encoder);
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    ...plan.deviceArguments,
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=256x256:rate=30:duration=0.1",
    "-frames:v",
    "3",
    "-vf",
    plan.pixelFilter,
    ...plan.encoderArguments,
    "-b:v",
    "1000000",
    "-maxrate",
    "1250000",
    "-bufsize",
    "2500000",
    "-g",
    "30",
    "-f",
    "null",
    "/dev/null",
  ];
};

type EncoderProbeDependencies = {
  run?: (args: string[]) => Promise<void>;
  renderNodes?: () => Promise<string[]>;
  softwareOnly?: boolean;
};

/** Select only after a bounded real synthetic encode has initialized the
 * device, pixel-upload/filter path, and encoder. No listing-based GPU claim. */
export const selectLinuxRecorderEncoder = async (
  ffmpegPath: string,
  dependencies: EncoderProbeDependencies = {}
): Promise<LinuxRecorderEncoder | null> => {
  const run =
    dependencies.run ??
    (async (args: string[]) => {
      await execFileAsync(ffmpegPath, args, {
        timeout: 4000,
        killSignal: "SIGKILL",
        maxBuffer: 1024 * 1024,
      });
    });
  const candidates: LinuxRecorderEncoder[] = [];
  if (!dependencies.softwareOnly) {
    candidates.push({ name: "h264_nvenc", hardware: true });
    const nodes = await (
      dependencies.renderNodes ?? listAccessibleVaapiRenderNodes
    )().catch(() => []);
    for (const renderNode of [...new Set(nodes)]
      .filter(isVaapiRenderNode)
      .slice(0, 4)) {
      candidates.push({ name: "h264_vaapi", hardware: true, renderNode });
    }
  }
  candidates.push(LINUX_SOFTWARE_ENCODER);
  for (const candidate of candidates) {
    try {
      await run(buildLinuxEncoderProbeArguments(candidate));
      return candidate;
    } catch {
      /* Unavailable driver/device/filter: try the next safe backend. */
    }
  }
  return null;
};
