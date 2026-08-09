export type GameRecorderResolution =
  | "source"
  | "720p"
  | "1080p"
  | "1440p"
  | "2160p";

export type GameRecorderFps = 30 | 60 | 120;

export type GameRecorderReplayDuration = 15 | 30 | 45 | 60;

export type GameRecorderQualityPreset = "performance" | "balanced" | "quality";

export interface GameRecorderPreferences {
  enabled: boolean;
  resolution: GameRecorderResolution;
  fps: GameRecorderFps;
  qualityPreset: GameRecorderQualityPreset;
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

export interface GameRecorderCaptureDiagnostics {
  mimeType: string;
  outputWidth: number;
  outputHeight: number;
  /** Cadence negotiated with the desktop-capture track. */
  outputFps: number;
  /** Cadence measured from encoded MP4 video samples over wall-clock time. */
  encodedFps: number | null;
  targetVideoBitrate: number;
  /** Recent container bytes divided by wall-clock capture time. */
  recentEncodedBitrate: number;
  hasAudio: boolean;
}

export interface GameRecorderState {
  status: GameRecorderStatus;
  configuration: GameRecorderPreferences;
  resolvedOutputDirectory: string;
  recordingStartedAt: number | null;
  bufferedSeconds: number;
  captureActive: boolean;
  captureDiagnostics: GameRecorderCaptureDiagnostics | null;
  /** GPU process capability, not a claim that this exact encoder is active. */
  hardwareVideoEncodingAvailable: boolean | null;
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
  outputFps: number;
  /** Video bitrate requested from MediaRecorder for this session. */
  targetVideoBitrate: number;
  /** Encoded MP4 video samples in this slice; unavailable for WebM fallback. */
  encodedVideoFrames: number | null;
  normalizedOutput: boolean;
}
