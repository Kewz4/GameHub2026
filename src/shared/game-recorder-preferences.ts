import type {
  GameRecorderFps,
  GameRecorderPreferences,
  GameRecorderQualityPreset,
  GameRecorderReplayDuration,
  GameRecorderResolution,
  UserPreferences,
} from "@types";

export const DEFAULT_GAME_RECORDER_PREFERENCES: GameRecorderPreferences = {
  enabled: false,
  resolution: "1080p",
  fps: 60,
  qualityPreset: "quality",
  instantReplayEnabled: false,
  replayDurationSeconds: 30,
  captureGameAudio: true,
  outputDirectory: null,
};

const RESOLUTIONS = new Set<GameRecorderResolution>([
  "source",
  "720p",
  "1080p",
  "1440p",
  "2160p",
]);
const FRAME_RATES = new Set<GameRecorderFps>([30, 60, 120]);
const QUALITY_PRESETS = new Set<GameRecorderQualityPreset>([
  "performance",
  "balanced",
  "quality",
]);
const REPLAY_DURATIONS = new Set<GameRecorderReplayDuration>([15, 30, 45, 60]);

export const resolveGameRecorderPreferences = (
  preferences?: Partial<UserPreferences> | null
): GameRecorderPreferences => {
  const resolution = preferences?.gameRecorderResolution;
  const fps = preferences?.gameRecorderFps;
  const qualityPreset = preferences?.gameRecorderQualityPreset;
  const replayDuration = preferences?.gameRecorderReplayDurationSeconds;

  return {
    enabled:
      preferences?.gameRecorderEnabled ??
      DEFAULT_GAME_RECORDER_PREFERENCES.enabled,
    resolution:
      resolution && RESOLUTIONS.has(resolution)
        ? resolution
        : DEFAULT_GAME_RECORDER_PREFERENCES.resolution,
    fps:
      fps && FRAME_RATES.has(fps) ? fps : DEFAULT_GAME_RECORDER_PREFERENCES.fps,
    qualityPreset:
      qualityPreset && QUALITY_PRESETS.has(qualityPreset)
        ? qualityPreset
        : DEFAULT_GAME_RECORDER_PREFERENCES.qualityPreset,
    instantReplayEnabled:
      preferences?.gameRecorderInstantReplayEnabled ??
      DEFAULT_GAME_RECORDER_PREFERENCES.instantReplayEnabled,
    replayDurationSeconds:
      replayDuration && REPLAY_DURATIONS.has(replayDuration)
        ? replayDuration
        : DEFAULT_GAME_RECORDER_PREFERENCES.replayDurationSeconds,
    captureGameAudio:
      preferences?.gameRecorderCaptureAudio ??
      DEFAULT_GAME_RECORDER_PREFERENCES.captureGameAudio,
    outputDirectory: preferences?.gameRecorderOutputDirectory?.trim() || null,
  };
};
