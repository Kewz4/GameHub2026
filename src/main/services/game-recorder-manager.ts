import { isStaging } from "@main/constants";
import { db, levelKeys } from "@main/level";
import {
  DEFAULT_GAME_RECORDER_PREFERENCES,
  GAME_RECORDER_AUDIO_BITRATE,
  GAME_RECORDER_AUDIO_CHANNELS,
  GAME_RECORDER_AUDIO_SAMPLE_RATE,
  resolveGameRecorderPreferences,
} from "@shared";
import type {
  Game,
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
  shell,
  type DesktopCapturerSource,
} from "electron";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { findOverlayGameProcesses } from "./overlay-game-process";
import { logger } from "./logger";
import { NativeAddon } from "./native-addon";
import { WindowManager } from "./window-manager";

const TARGET_POLL_INTERVAL_MS = 750;
const CAPTURE_RETRY_DELAY_MS = 5_000;
// A capped 4K/120 segment can still be tens of megabytes. Give Chromium IPC
// and slower recording drives enough time to commit the boundary before
// declaring a save failure.
const SAVE_FLUSH_TIMEOUT_MS = 15_000;
const SEGMENT_RETENTION_MARGIN_MS = 6_000;

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
  private static targetRefreshPending = false;
  private static captureWindow: BrowserWindow | null = null;
  private static captureWindowReady: Promise<BrowserWindow> | null = null;
  private static captureRendererReady = false;
  private static captureActive = false;
  private static captureRetryAfter = 0;
  private static segmentDirectory: string | null = null;
  private static segmentSequence = 0;
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
      this.sendCaptureCommand({ type: "stop" });
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
      this.stopCaptureEngine();
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
      if (this.captureActive) this.stopCaptureEngine();
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
    const platformSupported = process.platform === "win32";

    let status: GameRecorderState["status"];
    if (!platformSupported) status = "unavailable";
    else if (!this.preferences.enabled) status = "disabled";
    else if (this.errorMessage) status = "error";
    else if (this.saving) status = "saving";
    else if (this.recordingStartedAt !== null) status = "recording";
    else if (!this.activeGame || !this.targetPid) status = "waiting";
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
      configuration: { ...this.preferences },
      resolvedOutputDirectory:
        this.preferences.outputDirectory ?? defaultOutput,
      recordingStartedAt: this.recordingStartedAt,
      bufferedSeconds,
      captureActive: this.captureActive,
      gameTitle: this.activeGame?.title ?? null,
      lastSavedClipPath: this.lastSavedClipPath,
      statusMessage:
        this.statusMessage ??
        (!platformSupported
          ? "Gameplay capture is currently available on Windows."
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

    const bytes =
      payload instanceof Uint8Array
        ? Buffer.from(payload)
        : Buffer.from(new Uint8Array(payload));
    if (!bytes.length) return;

    const directory = await this.ensureSegmentDirectory();
    const fileName = `segment-${String(this.segmentSequence++).padStart(
      8,
      "0"
    )}.webm`;
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
    };
    this.segments.push(segment);
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

  public static handleCaptureError(senderId: number, message: string) {
    if (this.captureWindow?.webContents.id !== senderId) return;
    this.sendCaptureCommand({ type: "stop" });
    this.captureActive = false;
    this.captureRetryAfter = Date.now() + CAPTURE_RETRY_DELAY_MS;
    this.errorMessage = `Gameplay capture could not start: ${message}`;
    logger.error("Game recorder capture renderer failed", message);
    this.publishState();
  }

  public static handleCaptureReady(senderId: number) {
    if (this.captureWindow?.webContents.id !== senderId) return;
    this.captureRendererReady = true;
    this.captureActive = false;
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
      this.sendCaptureCommand({ type: "flush" });
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
        candidate.hasAudio === newest.hasAudio;
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

      outputPath = path.join(
        gameDirectory,
        `${gameTitle} ${kind} ${timestampForFile()}-${crypto
          .randomBytes(3)
          .toString("hex")}.webm`
      );
      const directory = await this.ensureSegmentDirectory();
      listPath = path.join(
        directory,
        `concat-${crypto.randomBytes(8).toString("hex")}.ffconcat`
      );
      const concatText = [
        "ffconcat version 1.0",
        ...selected.map((segment) => {
          const normalized = segment.path
            .replaceAll("\\", "/")
            .replaceAll("'", "'\\''");
          return `file '${normalized}'`;
        }),
        "",
      ].join("\n");
      await fs.promises.writeFile(listPath, concatText, "utf8");

      const hasAudio = selected[0]?.hasAudio ?? false;
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
        ...(hasAudio
          ? [
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
            ]
          : []),
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

  private static resolveFfmpegPath() {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, "ffmpeg", "ffmpeg.exe");
    }
    return path.join(app.getAppPath(), "ffmpeg", "ffmpeg.exe");
  }

  private static startTargetPolling() {
    this.stopTargetPolling();
    this.targetPoll = setInterval(
      () => void this.refreshTarget(),
      TARGET_POLL_INTERVAL_MS
    );
  }

  private static stopTargetPolling() {
    if (this.targetPoll) clearInterval(this.targetPoll);
    this.targetPoll = null;
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

      if (targetChanged && this.captureActive) this.stopCaptureEngine();
      this.targetPid = targetPid;
      this.targetWindowId = targetWindowId;
      await this.reconcileCapture();
      this.publishState();
    } finally {
      this.targetRefreshPending = false;
    }
  }

  private static async reconcileCapture() {
    const wantsCapture =
      this.preferences.enabled &&
      (this.preferences.instantReplayEnabled ||
        this.recordingStartedAt !== null);
    const gameIsForeground =
      process.platform !== "win32" ||
      (this.targetPid > 0 &&
        NativeAddon.getForegroundProcessId() === this.targetPid);
    const canCapture =
      wantsCapture &&
      process.platform === "win32" &&
      Boolean(this.activeGame && this.targetPid && this.targetWindowId) &&
      gameIsForeground &&
      Date.now() >= this.captureRetryAfter;

    if (!canCapture) {
      if (this.captureActive) this.stopCaptureEngine();
      return;
    }
    if (this.captureActive) return;

    const captureWindow = await this.ensureCaptureWindow();
    if (
      !this.activeGame ||
      !this.targetWindowId ||
      captureWindow.isDestroyed()
    ) {
      return;
    }
    if (!this.captureRendererReady) {
      this.statusMessage = "Preparing the game recorder…";
      this.publishState();
      return;
    }
    this.captureActive = true;
    this.errorMessage = null;
    this.statusMessage = "Starting game-window capture…";
    this.sendCaptureCommand({
      type: "start",
      configuration: this.preferences,
    });
    this.publishState();
  }

  private static async ensureCaptureWindow() {
    if (this.captureWindowReady) return this.captureWindowReady;
    if (this.captureWindow && !this.captureWindow.isDestroyed()) {
      return this.captureWindow;
    }

    this.captureWindowReady = new Promise<BrowserWindow>((resolve, reject) => {
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
            const windowId = this.targetWindowId;
            if (!windowId) {
              callback({});
              return;
            }
            const sources = await desktopCapturer.getSources({
              types: ["window"],
              thumbnailSize: { width: 0, height: 0 },
              fetchWindowIcons: false,
            });
            const source = sources.find((candidate) =>
              sourceMatchesWindow(candidate, windowId)
            );
            if (!source) {
              callback({});
              return;
            }
            callback({
              video: source,
              ...(this.preferences.captureGameAudio
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
          this.captureWindowReady = null;
          this.captureRendererReady = false;
          this.captureActive = false;
          this.publishState();
        }
      });
      captureWindow.webContents.once("did-finish-load", () => {
        resolve(captureWindow);
      });
      captureWindow.webContents.once(
        "did-fail-load",
        (_event, code, description) => {
          if (this.captureWindow === captureWindow) {
            this.captureWindow = null;
            this.captureRendererReady = false;
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
    }).finally(() => {
      this.captureWindowReady = null;
    });

    return this.captureWindowReady;
  }

  private static stopCaptureEngine() {
    if (!this.captureActive) return;
    this.captureActive = false;
    this.sendCaptureCommand({ type: "stop" });
    this.publishState();
  }

  private static sendCaptureCommand(command: {
    type: "start" | "stop" | "flush";
    configuration?: GameRecorderPreferences;
  }) {
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
    this.stopCaptureEngine();
    this.activeGame = null;
    this.targetPid = 0;
    this.targetWindowId = null;
    this.captureRetryAfter = 0;
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
