import type {
  GameRecorderPreferences,
  GameRecorderQualityPreset,
  GameRecorderResolution,
} from "@types";

export const GAME_RECORDER_SEGMENT_DURATION_MS = 3_000;
// 256 kbps is the highest stereo rate accepted by the bundled LGPL libopus
// encoder and is transparent for a 48 kHz game/system mix.
export const GAME_RECORDER_AUDIO_BITRATE = 256_000;
export const GAME_RECORDER_AUDIO_SAMPLE_RATE = 48_000;
export const GAME_RECORDER_AUDIO_CHANNELS = 2;
export const GAME_RECORDER_CAPTURE_RETRY_INITIAL_MS = 5_000;
export const GAME_RECORDER_CAPTURE_RETRY_MAX_MS = 30_000;

export type GameRecorderDimensions = {
  width: number;
  height: number;
};

const RESOLUTION_DIMENSIONS: Record<
  Exclude<GameRecorderResolution, "source">,
  GameRecorderDimensions
> = {
  "720p": { width: 1_280, height: 720 },
  "1080p": { width: 1_920, height: 1_080 },
  "1440p": { width: 2_560, height: 1_440 },
  "2160p": { width: 3_840, height: 2_160 },
};

type GameRecorderQualityProfile = {
  minimumBitrate: number;
  maximumBitrate: number;
  bitsPerPixel: Record<"h264" | "hevc" | "vp9" | "vp8", number>;
};

const QUALITY_PROFILES: Record<
  GameRecorderQualityPreset,
  GameRecorderQualityProfile
> = {
  performance: {
    minimumBitrate: 6_000_000,
    maximumBitrate: 60_000_000,
    bitsPerPixel: { h264: 0.18, hevc: 0.13, vp9: 0.12, vp8: 0.17 },
  },
  balanced: {
    minimumBitrate: 8_000_000,
    maximumBitrate: 120_000_000,
    bitsPerPixel: { h264: 0.3, hevc: 0.22, vp9: 0.2, vp8: 0.27 },
  },
  quality: {
    minimumBitrate: 12_000_000,
    maximumBitrate: 180_000_000,
    bitsPerPixel: { h264: 0.45, hevc: 0.32, vp9: 0.3, vp8: 0.4 },
  },
};

/**
 * MediaRecorder codec preference, best first.
 *
 * Chromium attempts a platform video-encode accelerator for supported H.264
 * profiles and falls back internally when one is unavailable. MIME support is
 * not proof that hardware encoding is active, so runtime diagnostics report
 * encoded cadence/throughput separately. WebM remains the portable fallback.
 */
export const GAME_RECORDER_MIME_CANDIDATES = [
  // H.264 High profile, level 5.2 (covers 4K60) + AAC-LC.
  'video/mp4;codecs="avc1.640034,mp4a.40.2"',
  'video/mp4;codecs="avc1.64002A,mp4a.40.2"',
  'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
] as const;

export type GameRecorderContainer = "mp4" | "webm";

export const getGameRecorderContainer = (
  mimeType: string | null | undefined
): GameRecorderContainer =>
  mimeType?.toLowerCase().includes("mp4") ? "mp4" : "webm";

export const getGameRecorderTargetDimensions = (
  resolution: GameRecorderResolution
): GameRecorderDimensions | null =>
  resolution === "source" ? null : RESOLUTION_DIMENSIONS[resolution];

/**
 * MediaRecorder only exposes target bitrate controls, not a constant-quality
 * mode. Scale the target with the actual captured pixel rate so high-motion
 * 1080p60/1440p/4K gameplay is not forced through streaming-grade bitrates.
 *
 * The VP8 fallback receives extra headroom because it is less bitrate-efficient
 * than VP9. The upper bound avoids accidentally asking Chromium for an
 * unbounded source-resolution stream on very large/high-refresh displays.
 */
export const getGameRecorderVideoBitrate = (
  configuration: Pick<
    GameRecorderPreferences,
    "resolution" | "fps" | "qualityPreset"
  >,
  actualDimensions: Partial<GameRecorderDimensions> | null | undefined,
  mimeType: string | null | undefined
) => {
  const configuredDimensions = getGameRecorderTargetDimensions(
    configuration.resolution
  );
  const fallbackWidth = configuredDimensions?.width ?? 1_920;
  const fallbackHeight = configuredDimensions?.height ?? 1_080;
  const width =
    actualDimensions?.width &&
    Number.isFinite(actualDimensions.width) &&
    actualDimensions.width > 0
      ? actualDimensions.width
      : fallbackWidth;
  const height =
    actualDimensions?.height &&
    Number.isFinite(actualDimensions.height) &&
    actualDimensions.height > 0
      ? actualDimensions.height
      : fallbackHeight;
  const codecs = mimeType?.toLowerCase() ?? "";
  const profile = QUALITY_PROFILES[configuration.qualityPreset];
  const bitsPerPixel =
    codecs.includes("hvc1") || codecs.includes("hev1")
      ? profile.bitsPerPixel.hevc
      : codecs.includes("avc1") || codecs.includes("mp4")
        ? profile.bitsPerPixel.h264
        : codecs.includes("vp9")
          ? profile.bitsPerPixel.vp9
          : profile.bitsPerPixel.vp8;

  return Math.round(
    Math.min(
      profile.maximumBitrate,
      Math.max(
        profile.minimumBitrate,
        width * height * configuration.fps * bitsPerPixel
      )
    )
  );
};

export const getGameRecorderEstimatedBufferBytes = (
  configuration: Pick<
    GameRecorderPreferences,
    | "resolution"
    | "fps"
    | "qualityPreset"
    | "captureGameAudio"
    | "replayDurationSeconds"
  >
) => {
  const videoBitrate = getGameRecorderVideoBitrate(
    configuration,
    getGameRecorderTargetDimensions(configuration.resolution),
    "video/mp4;codecs=avc1"
  );
  const totalBitrate =
    videoBitrate +
    (configuration.captureGameAudio ? GAME_RECORDER_AUDIO_BITRATE : 0);
  // The rolling buffer intentionally retains two extra 3-second segments so a
  // save cannot race cleanup at the requested cutoff.
  return Math.ceil(
    (totalBitrate / 8) * (configuration.replayDurationSeconds + 6)
  );
};

export const getGameRecorderCaptureRetryDelay = (consecutiveFailures: number) =>
  Math.min(
    GAME_RECORDER_CAPTURE_RETRY_MAX_MS,
    GAME_RECORDER_CAPTURE_RETRY_INITIAL_MS *
      2 ** Math.max(0, Math.floor(consecutiveFailures) - 1)
  );
