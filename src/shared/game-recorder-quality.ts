import type { GameRecorderPreferences, GameRecorderResolution } from "@types";

export const GAME_RECORDER_SEGMENT_DURATION_MS = 3_000;
// 256 kbps is the highest stereo rate accepted by the bundled LGPL libopus
// encoder and is transparent for a 48 kHz game/system mix.
export const GAME_RECORDER_AUDIO_BITRATE = 256_000;
export const GAME_RECORDER_AUDIO_SAMPLE_RATE = 48_000;
export const GAME_RECORDER_AUDIO_CHANNELS = 2;

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

const MIN_VIDEO_BITRATE = 8_000_000;
const MAX_VIDEO_BITRATE = 180_000_000;
const VP9_BITS_PER_PIXEL_PER_FRAME = 0.3;
const VP8_BITS_PER_PIXEL_PER_FRAME = 0.4;

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
  configuration: Pick<GameRecorderPreferences, "resolution" | "fps">,
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
  const bitsPerPixel = mimeType?.includes("vp9")
    ? VP9_BITS_PER_PIXEL_PER_FRAME
    : VP8_BITS_PER_PIXEL_PER_FRAME;

  return Math.round(
    Math.min(
      MAX_VIDEO_BITRATE,
      Math.max(
        MIN_VIDEO_BITRATE,
        width * height * configuration.fps * bitsPerPixel
      )
    )
  );
};
