import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GameRecorderPreferences } from "../../types";
import {
  GAME_RECORDER_AUDIO_BITRATE,
  GAME_RECORDER_SEGMENT_DURATION_MS,
  getGameRecorderVideoBitrate,
} from "../../shared";
import {
  getNativeRecorderOutputDimensions,
  normalizeNativeRecorderWindowHandle,
} from "./game-recorder-native-ffmpeg";
import {
  LINUX_SOFTWARE_ENCODER,
  linuxEncoderPlan,
  selectLinuxRecorderEncoder,
  type LinuxRecorderEncoder,
} from "./linux-recorder-encoder";

const execFileAsync = promisify(execFile);

export const parseLinuxRecorderDevices = (output: string) => ({
  x11: /^\s*D[ E]\s+x11grab\s/m.test(output),
  pulse: /^\s*D[ E]\s+pulse\s/m.test(output),
});

export const probeLinuxRecorder = async (ffmpegPath: string) => {
  try {
    const { stdout, stderr } = await execFileAsync(
      ffmpegPath,
      ["-hide_banner", "-devices"],
      { timeout: 8000, maxBuffer: 1024 * 1024 }
    );
    const devices = parseLinuxRecorderDevices(stdout + stderr);
    if (!devices.x11) return { available: false, pulse: false, encoder: null };
    const encoder = await selectLinuxRecorderEncoder(ffmpegPath);
    return { available: encoder !== null, pulse: devices.pulse, encoder };
  } catch {
    return { available: false, pulse: false, encoder: null };
  }
};

export const buildLinuxRecorderFfmpegArguments = (options: {
  configuration: GameRecorderPreferences;
  windowId: string;
  display: string;
  sourceWidth: number;
  sourceHeight: number;
  outputPattern: string;
  pulseMonitor: string | null;
  encoder?: LinuxRecorderEncoder;
}) => {
  const windowId = normalizeNativeRecorderWindowHandle(options.windowId);
  if (BigInt(windowId) > 0xffffffffn)
    throw new Error("X11 window ID is out of range");
  if (!/^:[0-9]+(?:\.[0-9]+)?$/.test(options.display))
    throw new Error("A local X11 display is required");
  const { configuration } = options;
  const pulseMonitor = configuration.captureGameAudio
    ? options.pulseMonitor
    : null;
  if (
    pulseMonitor !== null &&
    (!pulseMonitor ||
      pulseMonitor === "default" ||
      /[\u0000-\u001f\u007f]/.test(pulseMonitor))
  )
    throw new Error("An explicit PulseAudio output monitor is required");
  const dimensions = getNativeRecorderOutputDimensions(
    configuration,
    options.sourceWidth,
    options.sourceHeight
  );
  const targetBitrate = getGameRecorderVideoBitrate(
    configuration,
    dimensions,
    "video/mp4;codecs=avc1"
  );
  const segmentSeconds = GAME_RECORDER_SEGMENT_DURATION_MS / 1000;
  const encoder = options.encoder ?? LINUX_SOFTWARE_ENCODER;
  const plan = linuxEncoderPlan(encoder, configuration.qualityPreset);
  return {
    dimensions,
    targetBitrate,
    args: [
      "-hide_banner",
      "-loglevel",
      "warning",
      "-nostdin",
      "-nostats",
      "-progress",
      "pipe:2",
      "-stats_period",
      "0.5",
      ...plan.deviceArguments,
      "-thread_queue_size",
      "512",
      "-f",
      "x11grab",
      "-draw_mouse",
      "0",
      "-framerate",
      String(configuration.fps),
      // Exact X11 client capture, not root-window capture cropped to coordinates.
      "-window_id",
      windowId,
      "-i",
      options.display,
      ...(pulseMonitor
        ? ["-thread_queue_size", "1024", "-f", "pulse", "-i", pulseMonitor]
        : []),
      "-map",
      "0:v:0",
      ...(pulseMonitor ? ["-map", "1:a:0"] : []),
      "-vf",
      `scale=${dimensions.width}:${dimensions.height}:force_original_aspect_ratio=decrease,pad=${dimensions.width}:${dimensions.height}:(ow-iw)/2:(oh-ih)/2,${plan.pixelFilter}`,
      ...plan.encoderArguments,
      "-b:v",
      String(targetBitrate),
      "-maxrate",
      String(Math.round(targetBitrate * 1.25)),
      "-bufsize",
      String(Math.round(targetBitrate * 2.5)),
      "-g",
      String(configuration.fps * segmentSeconds),
      ...(encoder.name === "libx264" ? ["-sc_threshold", "0"] : []),
      "-force_key_frames",
      `expr:gte(t,n_forced*${segmentSeconds})`,
      "-fps_mode",
      "cfr",
      ...(pulseMonitor
        ? [
            "-c:a",
            "aac",
            "-b:a",
            String(GAME_RECORDER_AUDIO_BITRATE),
            "-ar",
            "48000",
            "-ac",
            "2",
            "-af",
            "aresample=48000:async=1000:first_pts=0",
          ]
        : []),
      "-avoid_negative_ts",
      "make_zero",
      "-f",
      "segment",
      "-segment_time",
      String(segmentSeconds),
      "-segment_time_delta",
      "0.05",
      "-reset_timestamps",
      "1",
      "-segment_list",
      "pipe:1",
      "-segment_list_type",
      "csv",
      "-segment_format",
      "mp4",
      "-segment_format_options",
      "movflags=+frag_keyframe+empty_moov+default_base_moof",
      "-y",
      options.outputPattern,
    ],
  };
};
