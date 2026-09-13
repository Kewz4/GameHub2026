import {
  GAME_RECORDER_AUDIO_BITRATE,
  GAME_RECORDER_AUDIO_CHANNELS,
  GAME_RECORDER_AUDIO_SAMPLE_RATE,
  GAME_RECORDER_SEGMENT_DURATION_MS,
  getGameRecorderTargetDimensions,
  getGameRecorderVideoBitrate,
} from "../../shared";
import type { GameRecorderPreferences } from "../../types";

export type NativeRecorderEncoder = "h264_nvenc";

export type NativeRecorderBuildOptions = {
  configuration: GameRecorderPreferences;
  encoder: NativeRecorderEncoder;
  ffmpegWindowHandle: string;
  sourceWidth: number;
  sourceHeight: number;
  outputPattern: string;
  includeAudio: boolean;
};

export type NativeRecorderSegmentListEntry = {
  path: string;
  startSeconds: number;
  endSeconds: number;
};

type NativeRecorderQuality = {
  preset: "p4" | "p5" | "p6";
  constantQuality: number;
  lookaheadFrames: number;
  multipass: "disabled" | "qres";
};

const NATIVE_QUALITY: Record<
  GameRecorderPreferences["qualityPreset"],
  NativeRecorderQuality
> = {
  performance: {
    preset: "p4",
    constantQuality: 23,
    lookaheadFrames: 0,
    multipass: "disabled",
  },
  balanced: {
    preset: "p5",
    constantQuality: 20,
    lookaheadFrames: 8,
    multipass: "qres",
  },
  quality: {
    preset: "p6",
    constantQuality: 17,
    lookaheadFrames: 16,
    multipass: "qres",
  },
};

const positiveEven = (value: number, fallback: number) => {
  const finite =
    Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
  return Math.max(2, finite - (finite % 2));
};

const MAXIMUM_INITIAL_AUDIO_PADDING_MS = 10_000;

/**
 * Convert the real delay between native video startup and Chromium loopback's
 * first samples into bounded silence. Raw PCM has no timestamps of its own; if
 * this gap is omitted, FFmpeg labels late-arriving audio as starting at t=0 and
 * the entire soundtrack leads the video by the loopback initialization time.
 */
export const getNativeRecorderInitialAudioPaddingFrames = (
  sessionStartedAt: number,
  chunkStartedAt: number,
  sampleRate: number
) => {
  if (
    !Number.isFinite(sessionStartedAt) ||
    !Number.isFinite(chunkStartedAt) ||
    !Number.isFinite(sampleRate) ||
    sampleRate <= 0
  ) {
    return 0;
  }
  const delayMs = Math.min(
    MAXIMUM_INITIAL_AUDIO_PADDING_MS,
    Math.max(0, chunkStartedAt - sessionStartedAt)
  );
  return Math.max(0, Math.round((delayMs * sampleRate) / 1_000));
};

export const normalizeNativeRecorderWindowHandle = (value: string) => {
  const normalized = String(value).trim();
  if (!/^\d{1,20}$/u.test(normalized) || normalized === "0") {
    throw new Error("The game window handle is invalid.");
  }
  return normalized;
};

export const getNativeRecorderOutputDimensions = (
  configuration: Pick<GameRecorderPreferences, "resolution">,
  sourceWidth: number,
  sourceHeight: number
) => {
  const requested = getGameRecorderTargetDimensions(configuration.resolution);
  return {
    width: positiveEven(requested?.width ?? sourceWidth, 1_920),
    height: positiveEven(requested?.height ?? sourceHeight, 1_080),
  };
};

/**
 * Build the Windows Graphics Capture -> NVENC pipeline.
 *
 * `gfxcapture` and `h264_nvenc` exchange D3D11 surfaces directly, avoiding the
 * browser readback/copy path that dropped frames under load. The only value
 * interpolated into the Lavfi graph is a validated decimal HWND; file-system
 * values stay as separate spawn arguments.
 */
export const buildNativeRecorderFfmpegArguments = ({
  configuration,
  encoder,
  ffmpegWindowHandle,
  sourceWidth,
  sourceHeight,
  outputPattern,
  includeAudio,
}: NativeRecorderBuildOptions) => {
  const hwnd = normalizeNativeRecorderWindowHandle(ffmpegWindowHandle);
  const dimensions = getNativeRecorderOutputDimensions(
    configuration,
    sourceWidth,
    sourceHeight
  );
  const quality = NATIVE_QUALITY[configuration.qualityPreset];
  const targetBitrate = getGameRecorderVideoBitrate(
    configuration,
    dimensions,
    "video/mp4;codecs=avc1"
  );
  const maximumBitrate = Math.round(targetBitrate * 1.25);
  const bufferSize = maximumBitrate * 2;
  const gopFrames = Math.max(
    1,
    Math.round(configuration.fps * (GAME_RECORDER_SEGMENT_DURATION_MS / 1_000))
  );
  const segmentSeconds = GAME_RECORDER_SEGMENT_DURATION_MS / 1_000;
  const captureFilter = [
    `gfxcapture=hwnd=${hwnd}`,
    `max_framerate=${configuration.fps}`,
    "capture_cursor=0",
    "capture_border=0",
    "display_border=0",
    "resize_mode=scale_aspect",
    "scale_mode=bicubic",
    `width=${dimensions.width}`,
    `height=${dimensions.height}`,
  ].join(":");

  return {
    args: [
      "-hide_banner",
      "-loglevel",
      "warning",
      "-nostats",
      "-progress",
      "pipe:2",
      "-stats_period",
      "0.5",
      "-f",
      "lavfi",
      "-i",
      captureFilter,
      ...(includeAudio
        ? [
            "-thread_queue_size",
            "4096",
            "-f",
            "f32le",
            "-ar",
            String(GAME_RECORDER_AUDIO_SAMPLE_RATE),
            "-ac",
            String(GAME_RECORDER_AUDIO_CHANNELS),
            "-i",
            "pipe:0",
          ]
        : []),
      "-map",
      "0:v:0",
      ...(includeAudio ? ["-map", "1:a:0"] : []),
      "-c:v",
      encoder,
      "-preset",
      quality.preset,
      "-tune",
      "hq",
      "-profile:v",
      "high",
      "-rc",
      "vbr",
      "-cq",
      String(quality.constantQuality),
      "-b:v",
      String(targetBitrate),
      "-maxrate",
      String(maximumBitrate),
      "-bufsize",
      String(bufferSize),
      "-spatial_aq",
      "1",
      "-temporal_aq",
      "1",
      "-aq-strength",
      "8",
      "-rc-lookahead",
      String(quality.lookaheadFrames),
      "-multipass",
      quality.multipass,
      "-g",
      String(gopFrames),
      "-forced-idr",
      "1",
      "-no-scenecut",
      "1",
      "-force_key_frames",
      `expr:gte(t,n_forced*${segmentSeconds})`,
      "-fps_mode",
      "cfr",
      "-color_range",
      "tv",
      "-colorspace",
      "bt709",
      "-color_primaries",
      "bt709",
      "-color_trc",
      "bt709",
      ...(includeAudio
        ? [
            "-c:a",
            "aac",
            "-b:a",
            String(GAME_RECORDER_AUDIO_BITRATE),
            "-ar",
            String(GAME_RECORDER_AUDIO_SAMPLE_RATE),
            "-ac",
            String(GAME_RECORDER_AUDIO_CHANNELS),
            "-af",
            `aresample=${GAME_RECORDER_AUDIO_SAMPLE_RATE}:async=1000:first_pts=0`,
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
      outputPattern,
    ],
    dimensions,
    targetBitrate,
    encoder,
  };
};

const decodeCsvPath = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replaceAll('""', '"');
  }
  return trimmed;
};

/** Parse FFmpeg's `segment_list_type=csv` completion notification. */
export const parseNativeRecorderSegmentListEntry = (
  line: string
): NativeRecorderSegmentListEntry | null => {
  const endSeparator = line.lastIndexOf(",");
  if (endSeparator <= 0) return null;
  const startSeparator = line.lastIndexOf(",", endSeparator - 1);
  if (startSeparator <= 0) return null;

  const segmentPath = decodeCsvPath(line.slice(0, startSeparator));
  const startSeconds = Number(line.slice(startSeparator + 1, endSeparator));
  const endSeconds = Number(line.slice(endSeparator + 1));
  if (
    !segmentPath ||
    !Number.isFinite(startSeconds) ||
    !Number.isFinite(endSeconds) ||
    startSeconds < 0 ||
    endSeconds <= startSeconds
  ) {
    return null;
  }
  return { path: segmentPath, startSeconds, endSeconds };
};

export const buildNativeRecorderProbeArguments = (
  encoder: NativeRecorderEncoder
) => [
  "-hide_banner",
  "-loglevel",
  "error",
  "-f",
  "lavfi",
  "-i",
  // Older NVENC generations reject dimensions below 145 pixels.
  "color=size=256x256:rate=1:duration=0.1",
  "-frames:v",
  "1",
  "-c:v",
  encoder,
  "-f",
  "null",
  process.platform === "win32" ? "NUL" : "/dev/null",
];
