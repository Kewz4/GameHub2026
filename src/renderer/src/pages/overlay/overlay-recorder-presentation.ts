import type {
  GameRecorderCaptureDiagnostics,
  GameRecorderPreferences,
  GameRecorderReplayDuration,
} from "@types";

export interface OverlayReplayPresentation {
  availableSeconds: number;
  bufferLabel: string;
  isReady: boolean;
  progressPercent: number;
  saveLabel: string;
  statusLabel: string;
}

export const getOverlayReplayPresentation = (
  bufferedSeconds: number,
  replayDurationSeconds: GameRecorderReplayDuration
): OverlayReplayPresentation => {
  const targetSeconds = replayDurationSeconds;
  const safeBufferedSeconds = Number.isFinite(bufferedSeconds)
    ? Math.max(0, bufferedSeconds)
    : 0;
  const availableSeconds = Math.min(
    targetSeconds,
    Math.floor(safeBufferedSeconds)
  );
  const isReady = safeBufferedSeconds >= targetSeconds;

  return {
    availableSeconds,
    bufferLabel: isReady
      ? `${targetSeconds}s ready`
      : `${availableSeconds}s of ${targetSeconds}s buffered`,
    isReady,
    progressPercent: Math.min(100, (safeBufferedSeconds / targetSeconds) * 100),
    saveLabel: isReady
      ? `Save last ${targetSeconds}s`
      : `Save ${availableSeconds}s available`,
    statusLabel: isReady
      ? "Instant Replay is ready"
      : "Buffering Instant Replay",
  };
};

export const getOverlayRecorderTechnicalSummary = (
  diagnostics: GameRecorderCaptureDiagnostics | null,
  configuration: Pick<
    GameRecorderPreferences,
    "resolution" | "fps" | "qualityPreset"
  >
) => {
  const preset =
    configuration.qualityPreset === "quality"
      ? "High"
      : configuration.qualityPreset === "balanced"
        ? "Balanced"
        : "Performance";
  if (!diagnostics) {
    return `${preset} · ${configuration.resolution} · ${configuration.fps} FPS requested`;
  }
  const codec = diagnostics.mimeType.toLowerCase().includes("avc1")
    ? "H.264"
    : diagnostics.mimeType.toLowerCase().includes("hvc1") ||
        diagnostics.mimeType.toLowerCase().includes("hev1")
      ? "HEVC"
      : diagnostics.mimeType.toLowerCase().includes("vp9")
        ? "VP9"
        : diagnostics.mimeType.toLowerCase().includes("vp8")
          ? "VP8"
          : diagnostics.mimeType.toLowerCase().includes("mp4")
            ? "H.264"
            : "Video";
  const encodedMbps = diagnostics.recentEncodedBitrate / 1_000_000;
  const resolution =
    diagnostics.outputWidth === 1280 && diagnostics.outputHeight === 720
      ? "720p"
      : diagnostics.outputWidth === 1920 && diagnostics.outputHeight === 1080
        ? "1080p"
        : diagnostics.outputWidth === 2560 && diagnostics.outputHeight === 1440
          ? "1440p"
          : diagnostics.outputWidth === 3840 &&
              diagnostics.outputHeight === 2160
            ? "4K"
            : `${diagnostics.outputWidth}×${diagnostics.outputHeight}`;
  const cadence =
    diagnostics.encodedFps === null
      ? `${diagnostics.outputFps} FPS negotiated`
      : `${diagnostics.encodedFps.toFixed(1)} FPS encoded`;
  const backend =
    diagnostics.backend === "native_ffmpeg_nvenc"
      ? "NVENC"
      : diagnostics.backend === "native_ffmpeg_x11"
        ? diagnostics.encoderName === "h264_nvenc"
          ? "X11/NVENC"
          : diagnostics.encoderName === "h264_vaapi"
            ? "X11/VA-API"
            : diagnostics.encoderName === "libx264"
              ? "X11/libx264"
              : "X11"
        : diagnostics.backend === "media_recorder"
          ? "Compatibility"
          : null;
  return `${preset} · ${backend ? `${backend} ` : ""}${codec} · ${resolution} · ${cadence} · ${encodedMbps.toFixed(1)} Mbps`;
};
