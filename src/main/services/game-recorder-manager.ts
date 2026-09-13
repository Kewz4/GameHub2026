import { isStaging } from "@main/constants";
import { db, levelKeys } from "@main/level";
import {
  DEFAULT_GAME_RECORDER_PREFERENCES,
  GAME_RECORDER_AUDIO_BITRATE,
  GAME_RECORDER_AUDIO_CHANNELS,
  GAME_RECORDER_AUDIO_SAMPLE_RATE,
  buildGameRecorderConcatManifest,
  getGameRecorderCaptureRetryDelay,
  getGameRecorderContainer,
  resolveGameRecorderPreferences,
  type GameRecorderContainer,
} from "@shared";
import type {
  Game,
  GameRecorderCaptureBackend,
  GameRecorderCaptureCommand,
  GameRecorderPcmChunkMetadata,
  GameRecorderPreferences,
  GameRecorderSaveResult,
  GameRecorderSegmentMetadata,
  GameRecorderState,
  UserPreferences,
} from "@types";
import {
  BrowserWindow,
  app,
  desktopCapturer,
  screen,
  shell,
  type DesktopCapturerSource,
  type NativeImage,
} from "electron";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { findOverlayGameProcesses } from "./overlay-game-process";
import { logger } from "./logger";
import { NativeAddon } from "./native-addon";
import { WindowManager } from "./window-manager";
import { isGameWindowDisplaySized } from "./game-recorder-capture-source";
import {
  NativeRecorderSession,
  probeNativeRecorderEncoder,
  type NativeRecorderCompletedSegment,
} from "./game-recorder-native-session";
import { captureWindowsGameWindowFrame } from "./windows-game-capture";
import { resolveMediaToolPath } from "./media-tool-path";
import { probeLinuxRecorder } from "./linux-recorder-ffmpeg";
import { linuxAudioMixer } from "./linux-audio-mixer";
import {
  selectLinuxRecorderEncoder,
  type LinuxRecorderEncoder,
} from "./linux-recorder-encoder";
import {
  supportsDesktopGameCapture,
  desktopCaptureUnavailableMessage,
} from "./desktop-capture-capability";

const TARGET_POLL_INTERVAL_MS = 750;
const FOREGROUND_PRIVACY_POLL_INTERVAL_MS = 100;
// A capped 4K/120 segment can still be tens of megabytes. Give Chromium IPC
// and slower recording drives enough time to commit the boundary before
// declaring a save failure.
const SAVE_FLUSH_TIMEOUT_MS = 15_000;
const SEGMENT_RETENTION_MARGIN_MS = 6_000;
const MINIMUM_CAPTURE_DISK_RESERVE_BYTES = 512 * 1024 ** 2;

type RecorderSegment = {
  path: string;
  startedAt: number;
  endedAt: number;
  mimeType: string;
  bytes: number;
  hasAudio: boolean;
  /** Geometry actually encoded into this segment, reported by the capture
   *  renderer. Segments are only stream-copy concatenated with matching ones. */
  outputWidth: number;
  outputHeight: number;
  outputFps: number;
  targetVideoBitrate: number;
  encodedVideoFrames: number | null;
  /** Container MediaRecorder produced (mp4 for the hardware H.264 path). */
  container: GameRecorderContainer;
  backend: GameRecorderCaptureBackend;
  encoderName: string;
};

type PendingSave = {
  kind: "recording" | "replay";
  requestedAt: number;
  resolve: (result: GameRecorderSaveResult) => void;
  timeout: NodeJS.Timeout;
};

const successfulSave = (outputPath: string): GameRecorderSaveResult => ({
  ok: true,
  path: outputPath,
  error: null,
});

const failedSave = (error: string): GameRecorderSaveResult => ({
  ok: false,
  path: null,
  error,
});

const sanitizeFilePart = (value: string) => {
  const sanitized = value
    .split("")
    .map((character) => (character.charCodeAt(0) <= 31 ? " " : character))
    .join("")
    .replace(/[<>:"/\\|?*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .replace(/[. ]+$/u, "");
  if (!sanitized) return "Gameplay";
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(sanitized)
    ? `_${sanitized}`
    : sanitized;
};

const timestampForFile = () =>
  new Date()
    .toISOString()
    .replace("T", " ")
    .replace("Z", "")
    .replaceAll(":", "-")
    .replace(".", "-");

const sourceMatchesWindow = (
  source: DesktopCapturerSource,
  windowId: string
) => {
  const [kind, sourceWindowId] = source.id.split(":");
  return kind === "window" && sourceWindowId === windowId;
};

export class GameRecorderManager {
  private static preferences = DEFAULT_GAME_RECORDER_PREFERENCES;
  private static spotifySystemAudioBlocked = false;
  private static activeGame: Game | null = null;
  private static targetPid = 0;
  private static targetWindowId: string | null = null;
  private static targetPoll: NodeJS.Timeout | null = null;
  private static foregroundPrivacyPoll: NodeJS.Timeout | null = null;
  private static targetRefreshPending = false;
  private static captureWindow: BrowserWindow | null = null;
  private static captureWindowReady: Promise<BrowserWindow> | null = null;
  private static captureRendererReady = false;
  private static captureActive = false;
  private static captureBackend: GameRecorderCaptureBackend | null = null;
  private static nativeSession: NativeRecorderSession | null = null;
  private static nativeProbe: Promise<boolean> | null = null;
  private static nativeEncoderAvailable: boolean | null = null;
  private static nativeFailureTargetKey: string | null = null;
  private static linuxPulseInputAvailable = false;
  private static linuxPulseMonitor: string | null = null;
  private static linuxEncoder: LinuxRecorderEncoder | null = null;
  private static linuxEncoderFallbackPending = false;
  private static captureSessionSequence = 0;
  private static captureReconcile: Promise<void> | null = null;
  private static captureReconcileRequested = false;
  private static captureRetryAfter = 0;
  private static captureFailureCount = 0;
  private static segmentDirectory: string | null = null;
  private static segmentSequence = 0;
  private static loggedSegmentCodec: string | null = null;
  private static segments: RecorderSegment[] = [];
  private static recordingStartedAt: number | null = null;
  private static recordingSegments: RecorderSegment[] = [];
  private static protectedSegmentPaths = new Set<string>();
  private static pendingSave: PendingSave | null = null;
  private static saveInFlight: Promise<GameRecorderSaveResult> | null = null;
  private static saving = false;
  private static lastSavedClipPath: string | null = null;
  private static errorMessage: string | null = null;
  private static statusMessage: string | null = null;
  private static initialized = false;

  public static initialize() {
    if (this.initialized) return;
    this.initialized = true;
    app.once("will-quit", () => {
      this.stopTargetPolling();
      this.stopCaptureEngine(true);
      this.captureWindow?.destroy();
      this.captureWindow = null;
      this.captureWindowReady = null;
      void this.removeSegmentDirectory();
    });
  }

  public static async applyUserPreferences(preferences: UserPreferences) {
    const previous = this.preferences;
    this.preferences = this.resolvePreferences(preferences);
    this.errorMessage = null;

    if (!this.preferences.enabled) {
      this.stopTargetPolling();
      this.targetPid = 0;
      this.targetWindowId = null;
      if (this.recordingStartedAt !== null) {
        await this.stopRecording();
      }
      await this.stopCaptureEngine();
      await this.clearRollingSegments();
      this.publishState("Gameplay capture is disabled.");
      return;
    }

    if (this.activeGame && !this.targetPoll) {
      this.startTargetPolling();
      await this.refreshTarget();
    }

    const captureConfigurationChanged =
      previous.resolution !== this.preferences.resolution ||
      previous.fps !== this.preferences.fps ||
      previous.qualityPreset !== this.preferences.qualityPreset ||
      previous.captureGameAudio !== this.preferences.captureGameAudio;
    const replayDurationChanged =
      previous.replayDurationSeconds !== this.preferences.replayDurationSeconds;

    if (
      !this.preferences.instantReplayEnabled &&
      previous.instantReplayEnabled
    ) {
      await this.clearRollingSegments(false);
    }

    if (captureConfigurationChanged) {
      this.nativeFailureTargetKey = null;
      // Never concatenate segments created with different dimensions, frame
      // rates, or audio layouts. Finish an active manual recording under its
      // original capture configuration, then start a fresh replay buffer.
      let recordingSplitFailed = false;
      if (this.recordingStartedAt !== null) {
        const splitResult = await this.stopRecording();
        if (!splitResult.ok) {
          recordingSplitFailed = true;
          logger.warn(
            "Could not finish recording before applying capture settings",
            splitResult.error
          );
        }
      }
      if (this.captureActive) await this.stopCaptureEngine();
      await this.clearRollingSegments(!recordingSplitFailed);
      if (recordingSplitFailed) {
        this.publishState(
          "Capture settings will apply after the current recording is stopped."
        );
        return;
      }
    }

    if (replayDurationChanged) {
      await this.trimRollingSegments();
    }

    await this.reconcileCapture();
    this.publishState();
  }

  public static async setActiveGame(game: Game) {
    if (
      this.activeGame?.objectId === game.objectId &&
      this.activeGame.shop === game.shop
    ) {
      return;
    }

    await this.endCurrentGameSession();
    this.activeGame = game;
    const savedPreferences = await db
      .get<string, UserPreferences | null>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null);
    this.preferences = this.resolvePreferences(savedPreferences);
    if (this.preferences.enabled) {
      this.startTargetPolling();
      await this.refreshTarget();
    }
    this.publishState();
  }

  public static async clearActiveGame(game: Game) {
    if (
      !this.activeGame ||
      this.activeGame.objectId !== game.objectId ||
      this.activeGame.shop !== game.shop
    ) {
      return;
    }

    if (this.recordingStartedAt !== null) {
      await this.stopRecording();
    }
    await this.endCurrentGameSession();
    this.publishState("Start a game to use gameplay capture.");
  }

  public static getState(): GameRecorderState {
    const defaultOutput = path.join(app.getPath("videos"), "GameHub");
    const bufferedSeconds = this.getBufferedSeconds();
    const platformSupported = supportsDesktopGameCapture(process.platform);
    const recentSegments = this.segments.slice(-3);
    const recentDurationMs = recentSegments.reduce(
      (total, segment) =>
        total + Math.max(0, segment.endedAt - segment.startedAt),
      0
    );
    const newestSegment = recentSegments.at(-1);
    const measuredSegments = recentSegments.filter(
      (segment) => segment.encodedVideoFrames !== null
    );
    const measuredDurationMs = measuredSegments.reduce(
      (total, segment) =>
        total + Math.max(0, segment.endedAt - segment.startedAt),
      0
    );
    const videoEncodeStatus = platformSupported
      ? app.getGPUFeatureStatus().video_encode
      : undefined;

    let status: GameRecorderState["status"];
    if (!platformSupported) status = "unavailable";
    else if (!this.preferences.enabled) status = "disabled";
    else if (this.errorMessage) status = "error";
    else if (this.saving) status = "saving";
    else if (this.recordingStartedAt !== null) status = "recording";
    else if (
      !this.activeGame ||
      !this.targetPid ||
      (process.platform === "linux" && !this.targetWindowId)
    )
      status = "waiting";
    else if (
      this.preferences.instantReplayEnabled &&
      (this.captureActive || bufferedSeconds > 0)
    ) {
      status = "buffering";
    } else {
      status = "ready";
    }

    return {
      status,
      desktopCaptureAvailable: platformSupported,
      systemAudioCaptureAvailable:
        process.platform === "win32" ||
        (this.linuxPulseInputAvailable &&
          this.linuxPulseMonitor !== null &&
          this.nativeFailureTargetKey !== this.currentTargetKey()),
      configuration: { ...this.preferences },
      resolvedOutputDirectory:
        this.preferences.outputDirectory ?? defaultOutput,
      recordingStartedAt: this.recordingStartedAt,
      bufferedSeconds,
      captureActive: this.captureActive,
      activeCaptureBackend: this.captureActive ? this.captureBackend : null,
      hardwareVideoEncodingAvailable:
        process.platform === "linux"
          ? (this.linuxEncoder?.hardware ?? null)
          : this.nativeEncoderAvailable === true
            ? true
            : videoEncodeStatus === undefined
              ? null
              : videoEncodeStatus === "enabled",
      nativeVideoEncodingAvailable: this.nativeEncoderAvailable,
      captureDiagnostics: newestSegment
        ? {
            backend: newestSegment.backend,
            encoderName: newestSegment.encoderName,
            mimeType: newestSegment.mimeType,
            outputWidth: newestSegment.outputWidth,
            outputHeight: newestSegment.outputHeight,
            outputFps: newestSegment.outputFps,
            encodedFps:
              measuredDurationMs > 0
                ? (measuredSegments.reduce(
                    (total, segment) =>
                      total + (segment.encodedVideoFrames ?? 0),
                    0
                  ) *
                    1_000) /
                  measuredDurationMs
                : null,
            targetVideoBitrate: newestSegment.targetVideoBitrate,
            recentEncodedBitrate:
              recentDurationMs > 0
                ? (recentSegments.reduce(
                    (total, segment) => total + segment.bytes,
                    0
                  ) *
                    8_000) /
                  recentDurationMs
                : 0,
            hasAudio: newestSegment.hasAudio,
          }
        : null,
      gameTitle: this.activeGame?.title ?? null,
      lastSavedClipPath: this.lastSavedClipPath,
      statusMessage:
        (!platformSupported
          ? desktopCaptureUnavailableMessage(process.platform)
          : this.statusMessage) ??
        (!platformSupported
          ? desktopCaptureUnavailableMessage(process.platform)
          : !this.preferences.enabled
            ? "Enable gameplay capture in Settings."
            : !this.activeGame
              ? "Start a game to use gameplay capture."
              : !this.targetPid
                ? "Waiting for the game window…"
                : this.recordingStartedAt !== null && !this.captureActive
                  ? "Recording is paused while the game is in the background."
                  : this.preferences.instantReplayEnabled && !this.captureActive
                    ? "Instant replay pauses while the game is in the background."
                    : this.spotifySystemAudioBlocked
                      ? "System audio is disabled while Spotify Connect is selected, so Spotify music cannot enter gameplay recordings."
                      : process.platform === "linux" && !this.linuxPulseMonitor
                        ? "X11 game-window capture is video-only; system audio is not captured."
                        : null),
      errorMessage: this.errorMessage,
    };
  }

  private static resolvePreferences(
    userPreferences: UserPreferences | null
  ): GameRecorderPreferences {
    const resolved = resolveGameRecorderPreferences(userPreferences);
    this.spotifySystemAudioBlocked = Boolean(
      userPreferences?.musicProvider === "spotify" && resolved.captureGameAudio
    );
    return this.spotifySystemAudioBlocked
      ? { ...resolved, captureGameAudio: false }
      : resolved;
  }

  public static async startRecording() {
    if (!supportsDesktopGameCapture(process.platform)) {
      throw new Error(desktopCaptureUnavailableMessage(process.platform));
    }
    if (!this.preferences.enabled) {
      throw new Error("Enable gameplay capture in Settings first.");
    }
    if (!this.activeGame || !this.targetPid) {
      throw new Error("Start a game and wait for its window to be detected.");
    }
    if (this.recordingStartedAt !== null) return this.getState();
    if (this.saving)
      throw new Error("Please wait for the current clip to save.");

    this.errorMessage = null;
    this.statusMessage = null;
    this.recordingStartedAt = Date.now();
    this.recordingSegments = [];
    await this.reconcileCapture();
    this.publishState();
    return this.getState();
  }

  public static async stopRecording(): Promise<GameRecorderSaveResult> {
    if (this.recordingStartedAt === null) {
      return failedSave("No gameplay recording is active.");
    }
    if (this.pendingSave || this.saving) {
      return failedSave("A clip is already being saved.");
    }

    if (!this.captureActive) {
      return this.finalizeRecording();
    }

    return this.waitForSegmentBoundary("recording");
  }

  public static async saveInstantReplay(): Promise<GameRecorderSaveResult> {
    if (!this.preferences.enabled) {
      return failedSave("Enable gameplay capture in Settings first.");
    }
    if (!this.preferences.instantReplayEnabled) {
      return failedSave("Enable Instant Replay in Settings first.");
    }
    if (this.pendingSave || this.saving) {
      return failedSave("A clip is already being saved.");
    }
    if (!this.segments.length && !this.captureActive) {
      return failedSave("The replay buffer does not have any gameplay yet.");
    }

    if (!this.captureActive) return this.finalizeReplay();
    return this.waitForSegmentBoundary("replay");
  }

  public static async openOutputDirectory() {
    const outputDirectory = this.getState().resolvedOutputDirectory;
    await fs.promises.mkdir(outputDirectory, { recursive: true });
    await shell.openPath(outputDirectory);
  }

  public static async commitSegment(
    senderId: number,
    metadata: GameRecorderSegmentMetadata,
    payload: ArrayBuffer | Uint8Array
  ) {
    const captureWindow = this.captureWindow;
    if (
      !captureWindow ||
      captureWindow.isDestroyed() ||
      captureWindow.webContents.id !== senderId
    ) {
      throw new Error("Recorder segment rejected from an unknown renderer.");
    }

    // Display capture can contain another app for the fraction of a polling
    // interval after Alt+Tab. Refuse the whole unfinished slice while the game
    // is not foreground; the prior committed slices remain valid and private.
    const foregroundPid = ["win32", "linux"].includes(process.platform)
      ? NativeAddon.getForegroundProcessId()
      : this.targetPid;
    if (
      ["win32", "linux"].includes(process.platform) &&
      (!this.activeGame || !this.targetPid || foregroundPid !== this.targetPid)
    ) {
      logger.info("Dropping recorder segment captured outside the game", {
        gamePid: this.targetPid,
        foregroundPid,
      });
      return;
    }

    const startedAt = Number(metadata?.startedAt);
    const endedAt = Number(metadata?.endedAt);
    const mimeType = String(metadata?.mimeType ?? "video/webm");
    if (
      !Number.isFinite(startedAt) ||
      !Number.isFinite(endedAt) ||
      endedAt <= startedAt
    ) {
      throw new Error("Recorder segment metadata was invalid.");
    }

    // Electron has already materialized the IPC payload. View that memory
    // directly instead of allocating and copying another 20–70 MB Buffer for
    // every high-resolution slice.
    const bytes =
      payload instanceof Uint8Array
        ? Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength)
        : Buffer.from(payload);
    if (!bytes.length) return;

    const container = getGameRecorderContainer(mimeType);
    const directory = await this.ensureSegmentDirectory();
    await this.assertDiskHeadroom(directory, bytes.length);
    const fileName = `segment-${String(this.segmentSequence++).padStart(
      8,
      "0"
    )}.${container}`;
    const segmentPath = path.join(directory, fileName);
    await fs.promises.writeFile(segmentPath, bytes);

    const segment: RecorderSegment = {
      path: segmentPath,
      startedAt,
      endedAt,
      mimeType,
      bytes: bytes.length,
      hasAudio: Boolean(metadata?.hasAudio),
      outputWidth: Number(metadata?.outputWidth) || 0,
      outputHeight: Number(metadata?.outputHeight) || 0,
      outputFps: Number(metadata?.outputFps) || 0,
      targetVideoBitrate: Number(metadata?.targetVideoBitrate) || 0,
      encodedVideoFrames: Number.isFinite(metadata?.encodedVideoFrames)
        ? Number(metadata.encodedVideoFrames)
        : null,
      container,
      backend: "media_recorder",
      encoderName: "Chromium MediaRecorder",
    };
    await this.acceptSegment(segment);
  }

  private static async acceptSegment(segment: RecorderSegment) {
    // MIME support identifies the codec/container, not the encoder backend.
    // Chromium can silently fall back to software even for H.264, so report the
    // GPU process capability without claiming this exact stream is accelerated.
    const codecIdentity = `${segment.backend}:${segment.encoderName}:${segment.mimeType}`;
    if (this.loggedSegmentCodec !== codecIdentity) {
      this.loggedSegmentCodec = codecIdentity;
      logger.info("Game recorder encoding", {
        backend: segment.backend,
        encoder: segment.encoderName,
        mimeType: segment.mimeType,
        container: segment.container,
        output: `${segment.outputWidth}x${segment.outputHeight}@${segment.outputFps}`,
        requestedVideoBitrateMbps: Number(
          (segment.targetVideoBitrate / 1_000_000).toFixed(2)
        ),
        firstSegmentBitrateMbps: Number(
          (
            (segment.bytes * 8_000) /
            (segment.endedAt - segment.startedAt) /
            1_000_000
          ).toFixed(2)
        ),
        firstSegmentEncodedFps:
          segment.encodedVideoFrames === null
            ? null
            : Number(
                (
                  (segment.encodedVideoFrames * 1_000) /
                  (segment.endedAt - segment.startedAt)
                ).toFixed(2)
              ),
        gpuVideoEncodeCapability: app.getGPUFeatureStatus().video_encode,
      });
    }
    this.segments.push(segment);
    this.captureFailureCount = 0;
    this.captureRetryAfter = 0;
    if (
      this.recordingStartedAt !== null &&
      segment.endedAt >= this.recordingStartedAt
    ) {
      this.recordingSegments.push(segment);
    }

    await this.trimRollingSegments();
    if (this.captureActive) {
      this.errorMessage = null;
      this.statusMessage = null;
    }
    this.publishState();

    const pending = this.pendingSave;
    if (pending && segment.endedAt >= pending.requestedAt) {
      clearTimeout(pending.timeout);
      this.pendingSave = null;
      const finalize =
        pending.kind === "recording"
          ? this.finalizeRecording()
          : this.finalizeReplay();
      void finalize.then(pending.resolve);
    }
  }

  public static async commitPcmChunk(
    senderId: number,
    metadata: GameRecorderPcmChunkMetadata,
    payload: ArrayBuffer | Uint8Array
  ) {
    const captureWindow = this.captureWindow;
    const session = this.nativeSession;
    if (
      !captureWindow ||
      captureWindow.isDestroyed() ||
      captureWindow.webContents.id !== senderId ||
      !session ||
      metadata.captureSessionId !== session.captureSessionId
    ) {
      throw new Error("Recorder PCM rejected from an inactive session.");
    }
    await session.writePcmChunk(metadata, payload);
  }

  private static async commitNativeSegment(
    captureSessionId: number,
    completed: NativeRecorderCompletedSegment
  ) {
    const session = this.nativeSession;
    const foregroundPid = NativeAddon.getForegroundProcessId();
    if (
      !session ||
      session.captureSessionId !== captureSessionId ||
      !this.activeGame ||
      !this.targetPid ||
      foregroundPid !== this.targetPid
    ) {
      logger.info("Dropping native recorder segment outside the active game", {
        captureSessionId,
        gamePid: this.targetPid,
        foregroundPid,
      });
      await fs.promises
        .rm(completed.path, { force: true })
        .catch(() => undefined);
      return;
    }

    await this.acceptSegment({
      path: completed.path,
      startedAt: completed.startedAt,
      endedAt: completed.endedAt,
      mimeType: session.hasAudio
        ? 'video/mp4;codecs="avc1.640034,mp4a.40.2"'
        : 'video/mp4;codecs="avc1.640034"',
      bytes: completed.bytes,
      hasAudio: session.hasAudio,
      outputWidth: session.dimensions.width,
      outputHeight: session.dimensions.height,
      outputFps: session.outputFps,
      targetVideoBitrate: session.targetVideoBitrate,
      encodedVideoFrames: completed.encodedVideoFrames,
      container: "mp4",
      backend:
        process.platform === "linux"
          ? "native_ffmpeg_x11"
          : "native_ffmpeg_nvenc",
      encoderName: session.encoder,
    });
  }

  private static async handleNativeCaptureFailure(
    captureSessionId: number,
    message: string
  ) {
    const session = this.nativeSession;
    if (!session || session.captureSessionId !== captureSessionId) return;
    logger.warn(
      "Native gameplay capture failed; switching to compatibility capture",
      { message, captureSessionId, target: this.currentTargetKey() }
    );
    const failedTarget = this.currentTargetKey();
    const trySoftware =
      process.platform === "linux" && this.linuxEncoder?.hardware === true;
    this.linuxEncoderFallbackPending = trySoftware;
    this.nativeFailureTargetKey = failedTarget;
    await this.stopCaptureEngine(true);
    if (trySoftware) {
      const fallback = await selectLinuxRecorderEncoder(
        this.resolveFfmpegPath(),
        { softwareOnly: true }
      );
      this.linuxEncoderFallbackPending = false;
      if (this.currentTargetKey() !== failedTarget) {
        await this.reconcileCapture();
        return;
      }
      if (fallback && this.currentTargetKey() === failedTarget) {
        this.linuxEncoder = fallback;
        this.nativeEncoderAvailable = true;
        this.nativeFailureTargetKey = null;
        this.errorMessage = null;
        this.statusMessage =
          "Hardware encoder unavailable; continuing X11 capture with software encoding…";
        await this.reconcileCapture();
        return;
      }
    }
    this.errorMessage = null;
    this.statusMessage =
      process.platform === "linux"
        ? "Native X11 capture unavailable; using video-only compatibility capture…"
        : "Native encoder unavailable; using compatibility capture…";
    await this.reconcileCapture().catch((error) => {
      this.errorMessage = `Gameplay capture could not start: ${String(error)}`;
      this.publishState();
    });
  }

  public static handleCaptureError(senderId: number, message: string) {
    if (this.captureWindow?.webContents.id !== senderId) return;
    if (this.nativeSession) {
      void this.handleNativeCaptureFailure(
        this.nativeSession.captureSessionId,
        message
      );
      return;
    }
    this.sendCaptureCommand({ type: "stop", discardPending: true });
    this.captureActive = false;
    this.captureBackend = null;
    this.captureFailureCount += 1;
    const retryDelay = getGameRecorderCaptureRetryDelay(
      this.captureFailureCount
    );
    this.captureRetryAfter = Date.now() + retryDelay;
    this.errorMessage = `Gameplay capture could not start: ${message}`;
    logger.error("Game recorder capture renderer failed", {
      message,
      retryDelayMs: retryDelay,
      consecutiveFailures: this.captureFailureCount,
    });
    this.publishState();
  }

  public static handleCaptureReady(senderId: number) {
    if (this.captureWindow?.webContents.id !== senderId) return;
    this.captureRendererReady = true;
    // A renderer reload can report readiness while native video is already
    // active. Do not clear that session flag and accidentally spawn a second
    // FFmpeg process; the initial load already starts with captureActive=false.
    void this.reconcileCapture().catch((error) => {
      this.errorMessage = `Gameplay capture could not start: ${String(error)}`;
      this.publishState();
    });
  }

  private static waitForSegmentBoundary(
    kind: PendingSave["kind"]
  ): Promise<GameRecorderSaveResult> {
    this.saving = true;
    this.statusMessage =
      kind === "recording" ? "Finishing recording…" : "Saving instant replay…";
    this.publishState();

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (this.pendingSave?.resolve !== resolve) return;
        this.pendingSave = null;
        this.saving = false;
        const message = "The recorder did not finish its current segment.";
        this.errorMessage = message;
        this.publishState();
        resolve(failedSave(message));
      }, SAVE_FLUSH_TIMEOUT_MS);

      this.pendingSave = {
        kind,
        requestedAt: Date.now(),
        resolve,
        timeout,
      };
      if (this.captureBackend === "media_recorder") {
        this.sendCaptureCommand({ type: "flush" });
      }
    });
  }

  private static async finalizeRecording(): Promise<GameRecorderSaveResult> {
    const startedAt = this.recordingStartedAt;
    const selected = this.recordingSegments.filter(
      (segment) => startedAt === null || segment.endedAt >= startedAt
    );
    this.recordingStartedAt = null;
    this.recordingSegments = [];
    this.saving = true;
    this.statusMessage = "Joining recorded gameplay…";
    this.publishState();

    const result = await this.trackSave(selected, "Recording");
    this.saving = false;
    await this.trimRollingSegments().catch((error) =>
      logger.warn("Could not trim recorder segments after saving", error)
    );
    await this.reconcileCapture().catch((error) =>
      logger.warn("Could not resume gameplay capture after saving", error)
    );
    this.publishState(result.ok ? "Recording saved." : result.error);
    return result;
  }

  private static async finalizeReplay(): Promise<GameRecorderSaveResult> {
    const durationMs = this.preferences.replayDurationSeconds * 1_000;
    const cutoff = Date.now() - durationMs;
    const selected = this.segments.filter(
      (segment) => segment.endedAt >= cutoff
    );
    this.saving = true;
    this.statusMessage = `Saving the last ${this.preferences.replayDurationSeconds} seconds…`;
    this.publishState();

    const result = await this.trackSave(selected, "Replay");
    this.saving = false;
    this.publishState(result.ok ? "Instant replay saved." : result.error);
    return result;
  }

  private static async trackSave(
    selected: RecorderSegment[],
    kind: "Recording" | "Replay"
  ) {
    const operation = this.saveSegments(selected, kind);
    this.saveInFlight = operation;
    try {
      return await operation;
    } finally {
      if (this.saveInFlight === operation) this.saveInFlight = null;
    }
  }

  /**
   * Segments are concatenated with `-c:v copy`, which silently produces a
   * corrupt file when the encoded geometry changes mid-list. A non-normalized
   * capture follows the game window, so its dimensions can change without any
   * preference change. Keep the newest contiguous run that shares geometry and
   * drop the older, incompatible tail.
   */
  private static selectCompatibleSegments(selected: RecorderSegment[]) {
    const newest = selected[selected.length - 1];
    if (!newest?.outputWidth || !newest?.outputHeight) return selected;

    let firstCompatible = selected.length - 1;
    while (firstCompatible > 0) {
      const candidate = selected[firstCompatible - 1];
      const matches =
        candidate.outputWidth === newest.outputWidth &&
        candidate.outputHeight === newest.outputHeight &&
        candidate.outputFps === newest.outputFps &&
        candidate.hasAudio === newest.hasAudio &&
        candidate.container === newest.container &&
        candidate.backend === newest.backend &&
        candidate.encoderName === newest.encoderName;
      if (!matches) break;
      firstCompatible -= 1;
    }

    if (firstCompatible === 0) return selected;

    logger.warn(
      `Dropping ${firstCompatible} recorder segment(s) recorded at a different output geometry than ${newest.outputWidth}×${newest.outputHeight}@${newest.outputFps}.`
    );
    return selected.slice(firstCompatible);
  }

  private static async saveSegments(
    inputSegments: RecorderSegment[],
    kind: "Recording" | "Replay"
  ): Promise<GameRecorderSaveResult> {
    const selected = this.selectCompatibleSegments(inputSegments);
    if (!selected.length) {
      const error =
        kind === "Replay"
          ? "The replay buffer does not have any gameplay yet."
          : "No gameplay frames were recorded.";
      this.errorMessage = error;
      return failedSave(error);
    }

    const selectedPaths = new Set(selected.map((segment) => segment.path));
    for (const selectedPath of selectedPaths) {
      this.protectedSegmentPaths.add(selectedPath);
    }

    let outputPath: string | null = null;
    let listPath: string | null = null;
    try {
      const ffmpegPath = this.resolveFfmpegPath();
      if (!fs.existsSync(ffmpegPath)) {
        throw new Error(
          "GameHub's media tool is missing. Reinstall or repair GameHub and try again."
        );
      }

      const outputRoot =
        this.preferences.outputDirectory ??
        path.join(app.getPath("videos"), "GameHub");
      const gameTitle = sanitizeFilePart(this.activeGame?.title ?? "Gameplay");
      const gameDirectory = path.join(outputRoot, gameTitle);
      await fs.promises.mkdir(gameDirectory, { recursive: true });
      await this.assertDiskHeadroom(
        gameDirectory,
        selected.reduce((total, segment) => total + segment.bytes, 0)
      );

      const container = selected[0]?.container ?? "webm";
      outputPath = path.join(
        gameDirectory,
        `${gameTitle} ${kind} ${timestampForFile()}-${crypto
          .randomBytes(3)
          .toString("hex")}.${container}`
      );
      const directory = await this.ensureSegmentDirectory();
      listPath = path.join(
        directory,
        `concat-${crypto.randomBytes(8).toString("hex")}.ffconcat`
      );
      const concatText = buildGameRecorderConcatManifest(selected);
      await fs.promises.writeFile(listPath, concatText, "utf8");

      const hasAudio = selected[0]?.hasAudio ?? false;
      // Chromium's MP4 path already produced AAC. Copy it instead of applying
      // a second lossy encode; the WebM fallback still needs async resampling
      // while joining independently restarted Opus streams.
      const audioArguments =
        container === "mp4"
          ? ["-c:a", "copy"]
          : [
              "-c:a",
              "libopus",
              "-b:a",
              String(GAME_RECORDER_AUDIO_BITRATE),
              "-ar",
              String(GAME_RECORDER_AUDIO_SAMPLE_RATE),
              "-ac",
              String(GAME_RECORDER_AUDIO_CHANNELS),
              "-vbr",
              "on",
              "-compression_level",
              "10",
              "-af",
              `aresample=${GAME_RECORDER_AUDIO_SAMPLE_RATE}:async=1000:first_pts=0`,
            ];
      await this.runFfmpeg(ffmpegPath, [
        "-hide_banner",
        "-loglevel",
        "error",
        "-fflags",
        "+genpts",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listPath,
        "-map",
        "0:v:0",
        ...(hasAudio ? ["-map", "0:a:0?"] : []),
        "-c:v",
        "copy",
        ...(hasAudio ? audioArguments : []),
        // Players should be able to open the clip before the whole file is
        // read; without this an MP4's index sits at the end of the file.
        ...(container === "mp4" ? ["-movflags", "+faststart"] : []),
        "-n",
        outputPath,
      ]);
      this.lastSavedClipPath = outputPath;
      this.errorMessage = null;
      return successfulSave(outputPath);
    } catch (error) {
      const message = `Could not save the gameplay clip: ${
        error instanceof Error ? error.message : String(error)
      }`;
      this.errorMessage = message;
      logger.error("Failed to join game recorder segments", error);
      if (outputPath) {
        await fs.promises
          .rm(outputPath, { force: true })
          .catch(() => undefined);
      }
      return failedSave(message);
    } finally {
      if (listPath) {
        await fs.promises.rm(listPath, { force: true }).catch(() => undefined);
      }
      for (const selectedPath of selectedPaths) {
        this.protectedSegmentPaths.delete(selectedPath);
      }
    }
  }

  private static runFfmpeg(executable: string, args: string[]) {
    return new Promise<void>((resolve, reject) => {
      const child = spawn(executable, args, {
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"],
      });
      let diagnostic = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        diagnostic = (diagnostic + chunk).slice(-4_000);
      });
      child.once("error", reject);
      child.once("exit", (code) => {
        if (code === 0) resolve();
        else
          reject(
            new Error(
              diagnostic.trim() || `media tool exited with code ${String(code)}`
            )
          );
      });
    });
  }

  private static async assertDiskHeadroom(
    directory: string,
    bytesRequired: number
  ) {
    const stats = await fs.promises
      .statfs(directory, { bigint: true })
      .catch((error) => {
        logger.warn("Could not inspect recorder disk capacity", {
          directory,
          error,
        });
        return null;
      });
    if (!stats) return;
    const available = stats.bavail * stats.bsize;
    const required =
      BigInt(Math.max(0, Math.ceil(bytesRequired))) +
      BigInt(MINIMUM_CAPTURE_DISK_RESERVE_BYTES);
    if (available < required) {
      throw new Error(
        "The recording drive is nearly full. Free at least 512 MB or choose another capture folder."
      );
    }
  }

  private static resolveFfmpegPath() {
    return resolveMediaToolPath({
      platform: process.platform,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
      isPackaged: app.isPackaged,
    });
  }

  private static startTargetPolling() {
    this.stopTargetPolling();
    this.targetPoll = setInterval(
      () =>
        void this.refreshTarget().catch((error) =>
          logger.warn("Could not refresh the game recorder target", error)
        ),
      TARGET_POLL_INTERVAL_MS
    );
    this.foregroundPrivacyPoll = setInterval(() => {
      if (
        this.captureActive &&
        this.targetPid > 0 &&
        NativeAddon.getForegroundProcessId() !== this.targetPid
      ) {
        // Kill the unfinished native/MediaRecorder slice quickly on Alt+Tab.
        // Only previously closed, game-only segments remain eligible to save.
        this.stopCaptureEngine(true);
      }
    }, FOREGROUND_PRIVACY_POLL_INTERVAL_MS);
  }

  private static stopTargetPolling() {
    if (this.targetPoll) clearInterval(this.targetPoll);
    if (this.foregroundPrivacyPoll) clearInterval(this.foregroundPrivacyPoll);
    this.targetPoll = null;
    this.foregroundPrivacyPoll = null;
    this.targetRefreshPending = false;
  }

  private static async refreshTarget() {
    const game = this.activeGame;
    if (!game || this.targetRefreshPending) return;
    this.targetRefreshPending = true;
    try {
      const candidates = await findOverlayGameProcesses(
        game,
        this.targetPid,
        Boolean(this.targetPid)
      );
      if (
        !this.activeGame ||
        this.activeGame.objectId !== game.objectId ||
        this.activeGame.shop !== game.shop
      ) {
        return;
      }

      const targetPid = candidates[0]?.pid ?? 0;
      const bounds = targetPid
        ? NativeAddon.getProcessWindowBounds(targetPid)
        : null;
      const targetWindowId = bounds?.windowId ?? bounds?.window_id ?? null;
      const targetChanged =
        targetPid !== this.targetPid || targetWindowId !== this.targetWindowId;

      if (targetChanged && this.captureActive) {
        await this.stopCaptureEngine(true);
      }
      this.targetPid = targetPid;
      this.targetWindowId = targetWindowId;
      if (
        targetChanged &&
        this.nativeFailureTargetKey !== this.currentTargetKey()
      ) {
        this.nativeFailureTargetKey = null;
      }
      await this.reconcileCapture();
      this.publishState();
    } finally {
      this.targetRefreshPending = false;
    }
  }

  /**
   * Coalesce every event that can change capture state. Native capability
   * probing, hidden-renderer startup and disk checks all yield; without a
   * single reconciliation lane, two callers can both observe captureActive as
   * false and start competing FFmpeg/MediaRecorder sessions for one window.
   */
  private static reconcileCapture(): Promise<void> {
    this.captureReconcileRequested = true;
    if (this.captureReconcile) return this.captureReconcile;

    const operation = (async () => {
      while (this.captureReconcileRequested) {
        this.captureReconcileRequested = false;
        await this.reconcileCaptureOnce();
      }
    })();
    const tracked = operation.finally(() => {
      if (this.captureReconcile === tracked) this.captureReconcile = null;
    });
    this.captureReconcile = tracked;
    return tracked;
  }

  private static canCaptureCurrentForegroundTarget() {
    const wantsCapture =
      this.preferences.enabled &&
      (this.preferences.instantReplayEnabled ||
        this.recordingStartedAt !== null);
    const gameIsForeground =
      !["win32", "linux"].includes(process.platform) ||
      (this.targetPid > 0 &&
        NativeAddon.getForegroundProcessId() === this.targetPid);
    return (
      wantsCapture &&
      supportsDesktopGameCapture(process.platform) &&
      !this.linuxEncoderFallbackPending &&
      // Windows can capture the game-occupied display. Linux always requires
      // the exact X11 client: never substitute the root desktop or coordinates.
      Boolean(this.activeGame && this.targetPid) &&
      (process.platform !== "linux" || Boolean(this.targetWindowId)) &&
      gameIsForeground &&
      Date.now() >= this.captureRetryAfter
    );
  }

  private static async reconcileCaptureOnce() {
    const gameIsForeground =
      !["win32", "linux"].includes(process.platform) ||
      (this.targetPid > 0 &&
        NativeAddon.getForegroundProcessId() === this.targetPid);
    const canCapture = this.canCaptureCurrentForegroundTarget();

    if (!canCapture) {
      if (this.captureActive) this.stopCaptureEngine(!gameIsForeground);
      return;
    }
    if (this.captureActive) return;

    const useNativeCapture = await this.shouldUseNativeCapture();
    if (!this.canCaptureCurrentForegroundTarget() || this.captureActive) return;

    if (useNativeCapture) {
      if (process.platform === "win32" && this.preferences.captureGameAudio) {
        const captureWindow = await this.ensureCaptureWindow();
        if (captureWindow.isDestroyed()) return;
        if (!this.captureRendererReady) {
          this.statusMessage = "Preparing high-quality system-audio capture…";
          this.publishState();
          return;
        }
      }
      await this.startNativeCapture();
      return;
    }

    const captureWindow = await this.ensureCaptureWindow();
    if (captureWindow.isDestroyed()) return;
    if (!this.captureRendererReady) {
      this.statusMessage = "Preparing the game recorder…";
      this.publishState();
      return;
    }
    if (!this.canCaptureCurrentForegroundTarget() || this.captureActive) return;
    this.captureBackend = "media_recorder";
    this.captureActive = true;
    this.errorMessage = null;
    this.statusMessage =
      process.platform === "linux"
        ? "Starting video-only compatibility game-window capture…"
        : "Starting compatibility game-window capture…";
    this.sendCaptureCommand({
      type: "start",
      backend: "media_recorder",
      configuration:
        process.platform === "linux"
          ? { ...this.preferences, captureGameAudio: false }
          : this.preferences,
    });
    this.publishState();
  }

  private static currentTargetKey() {
    return `${this.targetPid}:${this.targetWindowId ?? ""}`;
  }

  public static async probeCaptureCapabilities() {
    await this.probeNativeEncoder();
    return this.getState();
  }

  /** Capture a foreground game frame without ever falling back to the desktop. */
  public static async captureActiveGameFrame(game: Game): Promise<NativeImage> {
    if (!supportsDesktopGameCapture(process.platform)) {
      throw new Error(desktopCaptureUnavailableMessage(process.platform));
    }

    const candidates = await findOverlayGameProcesses(
      game,
      this.targetPid,
      Boolean(this.targetPid)
    );
    const foregroundPid = ["win32", "linux"].includes(process.platform)
      ? NativeAddon.getForegroundProcessId()
      : (candidates[0]?.pid ?? 0);
    const target = candidates.find(
      (candidate) => candidate.pid === foregroundPid
    );
    if (!target) throw new Error("achievement_souvenir_game_not_foreground");

    const bounds = NativeAddon.getProcessWindowBounds(target.pid);
    if (!bounds) throw new Error("achievement_souvenir_window_unavailable");
    const targetWindowId = bounds.windowId ?? bounds.window_id ?? null;
    const display = screen.getDisplayMatching({
      x: bounds.x,
      y: bounds.y,
      width: Math.max(1, bounds.width),
      height: Math.max(1, bounds.height),
    });
    const thumbnailSize = {
      width: Math.max(1, Math.min(display.size.width, 3_840)),
      height: Math.max(1, Math.min(display.size.height, 2_160)),
    };

    if (process.platform === "win32") {
      const windows = await desktopCapturer.getSources({
        types: ["window"],
        thumbnailSize: { width: 0, height: 0 },
        fetchWindowIcons: false,
      });
      const windowSource = targetWindowId
        ? (windows.find((candidate) =>
            sourceMatchesWindow(candidate, targetWindowId)
          ) ?? null)
        : null;
      if (!windowSource) {
        throw new Error("achievement_souvenir_borderless_window_required");
      }

      return captureWindowsGameWindowFrame(windowSource.id);
    }

    if (process.platform === "linux") {
      const windows = await desktopCapturer.getSources({
        types: ["window"],
        thumbnailSize,
        fetchWindowIcons: false,
      });
      const source = targetWindowId
        ? windows.find((candidate) =>
            sourceMatchesWindow(candidate, targetWindowId)
          )
        : null;
      // Never photograph the user's desktop if an X11 window vanished, was
      // minimized, or changed foreground during the asynchronous capture.
      if (
        !source ||
        source.thumbnail.isEmpty() ||
        NativeAddon.getForegroundProcessId() !== target.pid
      ) {
        throw new Error("achievement_souvenir_capture_unavailable");
      }
      return source.thumbnail;
    }

    const [screens, windows] = await Promise.all([
      desktopCapturer.getSources({ types: ["screen"], thumbnailSize }),
      desktopCapturer.getSources({
        types: ["window"],
        thumbnailSize,
        fetchWindowIcons: false,
      }),
    ]);
    const windowSource = targetWindowId
      ? (windows.find((candidate) =>
          sourceMatchesWindow(candidate, targetWindowId)
        ) ?? null)
      : null;
    const screenSource =
      screens.find(
        (candidate) => candidate.display_id === String(display.id)
      ) ?? null;
    const source =
      windowSource && !isGameWindowDisplaySized(bounds, display)
        ? windowSource
        : (screenSource ?? windowSource);

    if (!source || source.thumbnail.isEmpty()) {
      throw new Error("achievement_souvenir_capture_unavailable");
    }
    return source.thumbnail;
  }

  private static async probeNativeEncoder() {
    if (process.platform === "linux") {
      if (!supportsDesktopGameCapture(process.platform)) return false;
      if (!this.nativeProbe) {
        this.nativeProbe = probeLinuxRecorder(this.resolveFfmpegPath()).then(
          async (capability) => {
            this.nativeEncoderAvailable = capability.available;
            this.linuxEncoder = capability.encoder;
            this.linuxPulseInputAvailable =
              capability.available && capability.pulse;
            this.linuxPulseMonitor = this.linuxPulseInputAvailable
              ? await linuxAudioMixer.getMonitorSource()
              : null;
            return capability.available;
          }
        );
      }
      return this.nativeProbe;
    }
    if (process.platform !== "win32") {
      this.nativeEncoderAvailable = false;
      return false;
    }
    const ffmpegPath = this.resolveFfmpegPath();
    if (!fs.existsSync(ffmpegPath)) {
      this.nativeEncoderAvailable = false;
      return false;
    }
    if (this.nativeEncoderAvailable !== null) {
      return this.nativeEncoderAvailable;
    }
    if (!this.nativeProbe) {
      this.nativeProbe = probeNativeRecorderEncoder(ffmpegPath).then(
        (available) => {
          this.nativeEncoderAvailable = available;
          return available;
        }
      );
    }
    return this.nativeProbe;
  }

  private static async shouldUseNativeCapture() {
    if (
      !["win32", "linux"].includes(process.platform) ||
      !this.targetWindowId ||
      this.nativeFailureTargetKey === this.currentTargetKey()
    ) {
      return false;
    }
    if (this.nativeEncoderAvailable === null) {
      this.statusMessage =
        process.platform === "linux"
          ? "Checking the X11 video encoder and system-output monitor…"
          : "Checking the hardware video encoder…";
      this.publishState();
    }
    return this.probeNativeEncoder();
  }

  private static async startNativeCapture() {
    if (!this.targetWindowId || !this.targetPid || !this.activeGame) return;
    const targetPid = this.targetPid;
    const targetWindowId = this.targetWindowId;
    const bounds = NativeAddon.getProcessWindowBounds(targetPid);
    if (!bounds) return;
    const directory = await this.ensureSegmentDirectory();
    await this.assertDiskHeadroom(directory, 0);
    if (
      this.captureActive ||
      this.targetPid !== targetPid ||
      this.targetWindowId !== targetWindowId ||
      !this.canCaptureCurrentForegroundTarget()
    ) {
      return;
    }
    const linuxMonitor =
      process.platform === "linux" && this.linuxPulseInputAvailable
        ? await linuxAudioMixer.getMonitorSource()
        : null;
    const linux =
      process.platform === "linux"
        ? {
            display: process.env.DISPLAY ?? "",
            encoder: this.linuxEncoder ?? undefined,
            pulseMonitor: this.preferences.captureGameAudio
              ? linuxMonitor
              : null,
          }
        : undefined;
    if (linux) this.linuxPulseMonitor = linuxMonitor;
    // An audio-server lookup is asynchronous: revalidate the active game after it.
    if (
      this.targetPid !== targetPid ||
      this.targetWindowId !== targetWindowId ||
      !this.canCaptureCurrentForegroundTarget()
    )
      return;
    const captureSessionId = ++this.captureSessionSequence;
    const session = new NativeRecorderSession({
      ffmpegPath: this.resolveFfmpegPath(),
      encoder: "h264_nvenc",
      linux,
      configuration: this.preferences,
      captureSessionId,
      windowHandle: targetWindowId,
      sourceWidth: bounds.width,
      sourceHeight: bounds.height,
      segmentDirectory: directory,
      onSegment: (segment) =>
        this.commitNativeSegment(captureSessionId, segment),
      onFatalError: (message) =>
        this.handleNativeCaptureFailure(captureSessionId, message),
    });
    this.nativeSession = session;
    this.captureBackend = linux ? "native_ffmpeg_x11" : "native_ffmpeg_nvenc";
    this.captureActive = true;
    this.errorMessage = null;
    this.statusMessage = linux
      ? session.hasAudio
        ? "Recording the X11 game window and system-output monitor…"
        : "Recording the X11 game window (video only)…"
      : "Recording through NVIDIA NVENC…";
    session.start();
    if (!linux && this.preferences.captureGameAudio) {
      this.sendCaptureCommand({
        type: "start",
        backend: "native_ffmpeg_nvenc",
        captureSessionId,
        configuration: this.preferences,
      });
    }
    this.publishState();
  }

  /**
   * Pick what the recorder captures, using display capture only for fullscreen.
   *
   * Window capture was the only option here, and it is the wrong one for a
   * fullscreen DirectX game on Windows: it frequently exposes no per-window
   * source at all for an exclusive swap chain. Electron can use Windows'
   * accelerated desktop-capture backends for a screen source, while windowed
   * games retain the privacy of exact-window capture.
   *
   * For a fullscreen game the display and the window show the same pixels, so
   * this costs nothing. A windowed game must use its exact window source to
   * keep the desktop and other apps out of the recording.
   */
  private static async resolveCaptureSource(): Promise<DesktopCapturerSource | null> {
    const windowId = this.targetWindowId;
    const bounds = this.targetPid
      ? NativeAddon.getProcessWindowBounds(this.targetPid)
      : null;

    if (process.platform === "linux") {
      if (!supportsDesktopGameCapture(process.platform) || !windowId || !bounds)
        return null;
      const windows = await desktopCapturer
        .getSources({
          types: ["window"],
          thumbnailSize: { width: 0, height: 0 },
          fetchWindowIcons: false,
        })
        .catch(() => []);
      return (
        windows.find((candidate) => sourceMatchesWindow(candidate, windowId)) ??
        null
      );
    }

    const [screens, windows] = await Promise.all([
      desktopCapturer
        .getSources({
          types: ["screen"],
          thumbnailSize: { width: 0, height: 0 },
        })
        .catch(() => [] as DesktopCapturerSource[]),
      desktopCapturer
        .getSources({
          types: ["window"],
          thumbnailSize: { width: 0, height: 0 },
          fetchWindowIcons: false,
        })
        .catch(() => [] as DesktopCapturerSource[]),
    ]);

    const windowSource = windowId
      ? (windows.find((candidate) =>
          sourceMatchesWindow(candidate, windowId)
        ) ?? null)
      : null;

    // Match the display the game occupies; fall back to the first screen only
    // when per-window capture is unavailable (for example, an exclusive swap
    // chain that does not appear in desktopCapturer's window list).
    const display = bounds
      ? screen.getDisplayMatching({
          x: bounds.x,
          y: bounds.y,
          width: Math.max(1, bounds.width),
          height: Math.max(1, bounds.height),
        })
      : null;
    const screenSource =
      (display
        ? screens.find(
            (candidate) => candidate.display_id === String(display.id)
          )
        : null) ??
      screens[0] ??
      null;

    if (windowSource && !isGameWindowDisplaySized(bounds, display)) {
      return windowSource;
    }
    return screenSource ?? windowSource;
  }

  private static async ensureCaptureWindow() {
    if (this.captureWindowReady) return this.captureWindowReady;
    if (this.captureWindow && !this.captureWindow.isDestroyed()) {
      return this.captureWindow;
    }

    const ready = new Promise<BrowserWindow>((resolve, reject) => {
      const captureWindow = new BrowserWindow({
        width: 1,
        height: 1,
        show: false,
        frame: false,
        skipTaskbar: true,
        webPreferences: {
          preload: path.join(__dirname, "../preload/index.mjs"),
          sandbox: false,
          backgroundThrottling: false,
          partition: `gamehub-recorder-${process.pid}`,
        },
      });
      this.captureWindow = captureWindow;
      this.captureRendererReady = false;
      captureWindow.removeMenu();

      captureWindow.webContents.session.setDisplayMediaRequestHandler(
        async (_request, callback) => {
          try {
            const source = await this.resolveCaptureSource();
            if (!source) {
              logger.error(
                "Recorder found no capture source for the game window",
                { pid: this.targetPid, windowId: this.targetWindowId }
              );
              callback({});
              return;
            }
            logger.info("Game recorder capture source", {
              id: source.id,
              name: source.name,
              kind: source.id.startsWith("screen") ? "screen" : "window",
            });
            callback({
              video: source,
              ...(process.platform === "win32" &&
              this.preferences.captureGameAudio
                ? { audio: "loopback" as const }
                : {}),
            });
          } catch (error) {
            logger.error("Failed to resolve recorder desktop source", error);
            callback({});
          }
        },
        { useSystemPicker: false }
      );

      captureWindow.once("closed", () => {
        if (this.captureWindow === captureWindow) {
          this.captureWindow = null;
          this.captureRendererReady = false;
          // A hidden renderer owns native loopback audio. If it closes, leaving
          // FFmpeg alive would stall its pipe and a later reconciliation could
          // overwrite the still-running child with a second session.
          this.stopCaptureEngine(true);
          reject(new Error("Recorder renderer closed before it became ready."));
        }
      });
      captureWindow.webContents.on(
        "did-start-navigation",
        (_event, _url, _isInPlace, isMainFrame) => {
          if (
            !isMainFrame ||
            this.captureWindow !== captureWindow ||
            !this.captureRendererReady
          ) {
            return;
          }
          // A reload tears down WebAudio even though the BrowserWindow and its
          // webContents id survive. Restart both sides as one fresh session
          // when the renderer reports ready again.
          this.captureRendererReady = false;
          this.stopCaptureEngine(true);
        }
      );
      captureWindow.webContents.once(
        "render-process-gone",
        (_event, details) => {
          if (this.captureWindow !== captureWindow) return;
          this.captureWindow = null;
          this.captureRendererReady = false;
          this.stopCaptureEngine(true);
          const message = `Gameplay capture renderer stopped: ${details.reason}`;
          this.errorMessage = message;
          if (!captureWindow.isDestroyed()) captureWindow.destroy();
          this.publishState();
          reject(new Error(message));
        }
      );
      captureWindow.webContents.once("did-finish-load", () => {
        resolve(captureWindow);
      });
      captureWindow.webContents.once(
        "did-fail-load",
        (_event, code, description) => {
          if (this.captureWindow === captureWindow) {
            this.captureWindow = null;
            this.captureRendererReady = false;
            this.stopCaptureEngine(true);
          }
          captureWindow.destroy();
          reject(
            new Error(
              `Recorder renderer failed to load (${code}): ${description}`
            )
          );
        }
      );
      WindowManager.loadWindowURL(captureWindow, "game-recorder-capture");

      if (
        (!app.isPackaged || isStaging) &&
        process.env.HYDRA_RECORDER_DEVTOOLS
      ) {
        captureWindow.webContents.openDevTools({ mode: "detach" });
      }
    });
    const tracked = ready.finally(() => {
      if (this.captureWindowReady === tracked) this.captureWindowReady = null;
    });
    this.captureWindowReady = tracked;
    return tracked;
  }

  private static stopCaptureEngine(discardPending = false): Promise<void> {
    if (!this.captureActive && !this.nativeSession) return Promise.resolve();
    this.captureActive = false;
    const nativeSession = this.nativeSession;
    this.nativeSession = null;
    const completion = nativeSession?.stop() ?? Promise.resolve();
    this.sendCaptureCommand({ type: "stop", discardPending });
    this.captureBackend = null;
    this.publishState();
    return completion;
  }

  private static sendCaptureCommand(command: GameRecorderCaptureCommand) {
    const captureWindow = this.captureWindow;
    if (!captureWindow || captureWindow.isDestroyed()) return;
    captureWindow.webContents.send("on-game-recorder-capture-command", command);
  }

  private static async ensureSegmentDirectory() {
    if (this.segmentDirectory) return this.segmentDirectory;
    const root = path.join(app.getPath("temp"), "GameHub", "recorder");
    const directory = path.join(
      root,
      `session-${Date.now()}-${crypto.randomBytes(5).toString("hex")}`
    );
    await fs.promises.mkdir(directory, { recursive: true });
    this.segmentDirectory = directory;
    return directory;
  }

  private static getBufferedSeconds() {
    if (!this.segments.length) return 0;
    const cutoff = Date.now() - this.preferences.replayDurationSeconds * 1_000;
    return Math.min(
      this.preferences.replayDurationSeconds,
      Math.max(
        0,
        this.segments
          .filter((segment) => segment.endedAt >= cutoff)
          .reduce(
            (sum, segment) =>
              sum + Math.max(0, segment.endedAt - segment.startedAt),
            0
          ) / 1_000
      )
    );
  }

  private static async trimRollingSegments() {
    const keepAfter =
      Date.now() -
      this.preferences.replayDurationSeconds * 1_000 -
      SEGMENT_RETENTION_MARGIN_MS;
    const recordingPaths = new Set(
      this.recordingSegments.map((segment) => segment.path)
    );
    const retained: RecorderSegment[] = [];
    const expired: RecorderSegment[] = [];

    for (const segment of this.segments) {
      if (
        segment.endedAt >= keepAfter ||
        recordingPaths.has(segment.path) ||
        this.protectedSegmentPaths.has(segment.path)
      ) {
        retained.push(segment);
      } else {
        expired.push(segment);
      }
    }
    this.segments = retained;
    await Promise.all(
      expired.map((segment) =>
        fs.promises.rm(segment.path, { force: true }).catch(() => undefined)
      )
    );
  }

  private static async clearRollingSegments(includeRecordingSegments = true) {
    const recordingPaths = new Set(
      this.recordingSegments.map((segment) => segment.path)
    );
    const removable = this.segments.filter(
      (segment) =>
        !this.protectedSegmentPaths.has(segment.path) &&
        (includeRecordingSegments || !recordingPaths.has(segment.path))
    );
    this.segments = this.segments.filter(
      (segment) => !removable.includes(segment)
    );
    await Promise.all(
      removable.map((segment) =>
        fs.promises.rm(segment.path, { force: true }).catch(() => undefined)
      )
    );
  }

  private static async endCurrentGameSession() {
    this.stopTargetPolling();
    await this.stopCaptureEngine(true);
    this.activeGame = null;
    this.targetPid = 0;
    this.targetWindowId = null;
    this.captureRetryAfter = 0;
    this.captureFailureCount = 0;
    this.recordingStartedAt = null;
    this.recordingSegments = [];
    if (this.pendingSave) {
      clearTimeout(this.pendingSave.timeout);
      this.pendingSave.resolve(
        failedSave("The game closed before the clip could be saved.")
      );
      this.pendingSave = null;
    }
    if (this.saveInFlight) {
      await this.saveInFlight.catch((error) =>
        logger.warn("Gameplay clip save failed while ending session", error)
      );
    }
    this.saving = false;
    await this.removeSegmentDirectory();
  }

  private static async removeSegmentDirectory() {
    const directory = this.segmentDirectory;
    this.segmentDirectory = null;
    this.segmentSequence = 0;
    this.segments = [];
    this.protectedSegmentPaths.clear();
    if (!directory) return;

    const root = path.resolve(
      path.join(app.getPath("temp"), "GameHub", "recorder")
    );
    const resolved = path.resolve(directory);
    if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
      logger.error("Refused to remove recorder directory outside temp root", {
        directory,
      });
      return;
    }
    await fs.promises
      .rm(resolved, { recursive: true, force: true })
      .catch((error) =>
        logger.warn("Could not remove recorder temp directory", error)
      );
  }

  private static publishState(message?: string | null) {
    if (message !== undefined) this.statusMessage = message;
    const state = this.getState();
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send("on-game-recorder-state", state);
      }
    }
  }
}
