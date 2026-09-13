export type GameRecorderResolution =
  | "source"
  | "720p"
  | "1080p"
  | "1440p"
  | "2160p";

export type GameRecorderFps = 30 | 60 | 120;

export type GameRecorderReplayDuration = 15 | 30 | 45 | 60;

export type GameRecorderQualityPreset = "performance" | "balanced" | "quality";

export type GameRecorderCaptureBackend =
  | "media_recorder"
  | "native_ffmpeg_x11"
  | "native_ffmpeg_nvenc";

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
  backend?: GameRecorderCaptureBackend;
  encoderName?: string;
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
  /** Automatic exact-window capture support in the current desktop session. */
  desktopCaptureAvailable?: boolean;
  /** Whether the active capture backend can include system/game audio. */
  systemAudioCaptureAvailable?: boolean;
  status: GameRecorderStatus;
  configuration: GameRecorderPreferences;
  resolvedOutputDirectory: string;
  recordingStartedAt: number | null;
  bufferedSeconds: number;
  captureActive: boolean;
  /** Backend selected for the live capture process. A completed segment is
   * still required before the UI describes that backend as session-verified. */
  activeCaptureBackend: GameRecorderCaptureBackend | null;
  captureDiagnostics: GameRecorderCaptureDiagnostics | null;
  /** Successful hardware probe (Linux) or GPU/native capability (Windows),
   * not a claim that this exact encoder has captured a completed game segment. */
  hardwareVideoEncodingAvailable: boolean | null;
  /** Result of the platform FFmpeg encoder probe (Windows NVENC / Linux
   * NVENC, VA-API, or software x264). This is not itself a hardware claim and does not
   * prove that a particular game window can be captured through that encoder. */
  nativeVideoEncodingAvailable: boolean | null;
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
  backend?: GameRecorderCaptureBackend;
  /** Rejects PCM queued by an older native FFmpeg process after a restart. */
  captureSessionId?: number;
  /** Drop the encoder's current unfinished slice. Used when capture stops
   * because another window became foreground, so desktop frames cannot leak. */
  discardPending?: boolean;
}

export interface GameRecorderPcmChunkMetadata {
  captureSessionId: number;
  sampleRate: number;
  channels: number;
  frameCount: number;
  /** Epoch time for the first sample in this chunk. The native video process
   * starts before Chromium finishes establishing Windows loopback audio; this
   * lets the muxer preserve that real startup gap instead of shifting audio
   * early against the captured video. */
  chunkStartedAt: number;
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
