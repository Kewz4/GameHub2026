export type GameRecorderResolution =
  | "source"
  | "720p"
  | "1080p"
  | "1440p"
  | "2160p";

export type GameRecorderFps = 30 | 60 | 120;

export type GameRecorderReplayDuration = 15 | 30 | 45 | 60;

export interface GameRecorderPreferences {
  enabled: boolean;
  resolution: GameRecorderResolution;
  fps: GameRecorderFps;
  instantReplayEnabled: boolean;
  replayDurationSeconds: GameRecorderReplayDuration;
  captureGameAudio: boolean;
  outputDirectory: string | null;
}

export type GameRecorderStatus =
  | "disabled"
  | "waiting"
  | "ready"
  | "buffering"
  | "recording"
  | "saving"
  | "unavailable"
  | "error";

export interface GameRecorderState {
  status: GameRecorderStatus;
  configuration: GameRecorderPreferences;
  resolvedOutputDirectory: string;
  recordingStartedAt: number | null;
  bufferedSeconds: number;
  captureActive: boolean;
  gameTitle: string | null;
  lastSavedClipPath: string | null;
  statusMessage: string | null;
  errorMessage: string | null;
}

export interface GameRecorderSaveResult {
  ok: boolean;
  path: string | null;
  error: string | null;
}

export interface GameRecorderCaptureCommand {
  type: "start" | "stop" | "flush";
  configuration?: GameRecorderPreferences;
  /** Drop the encoder's current unfinished slice. Used when capture stops
   * because another window became foreground, so desktop frames cannot leak. */
  discardPending?: boolean;
}

export interface GameRecorderSegmentMetadata {
  startedAt: number;
  endedAt: number;
  mimeType: string;
  hasAudio: boolean;
  /** Dimensions and cadence actually supplied to MediaRecorder. */
  outputWidth: number;
  outputHeight: number;
  outputFps: GameRecorderFps;
  normalizedOutput: boolean;
}
