import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";

import { app } from "electron";
import type { ProcessPayload } from "./download/types";
import type {
  BuildLocalGameSnapshotPipelineInput,
  BuildSnapshotAggregateHashInput,
  CheckCloudSaveCustomPathOverlapInput,
  CheckCloudSaveCustomPathOverlapResult,
  DeleteLocalSaveTarget,
  DeleteLocalSaveTargetsResult,
  GameSaveRules,
  GetSaveRulesForGameInput,
  NativeLocalGameSnapshotPipelineResult,
  ReplaceRestoreTarget,
  ReplaceRestoreTargetsResult,
  ResolveRestoreTargetsInput,
  ResolveRestoreTargetsResult,
  ShouldSkipRestoreFileInput,
  VerifyDownloadedRestoreFileResult,
} from "@types";

import { logger } from "./logger";
import type { OverlayInputGateNativeStatus } from "./overlay-input-gate";

type NativeProcessProfileImageResponse = {
  imagePath?: string;
  image_path?: string;
  mimeType?: string;
  mime_type?: string;
};

type HydraNativeModule = {
  processProfileImage: (
    imagePath: string,
    targetExtension?: string
  ) => NativeProcessProfileImageResponse;
  listProcesses: () => ProcessPayload[];
  buildLocalGameSnapshotPipeline: (
    input: BuildLocalGameSnapshotPipelineInput
  ) => Promise<NativeLocalGameSnapshotPipelineResult>;
  getSaveRulesForGame: (
    input: GetSaveRulesForGameInput
  ) => Promise<GameSaveRules>;
  buildSnapshotAggregateHash: (
    input: BuildSnapshotAggregateHashInput
  ) => string;
  checkCloudSaveCustomPathOverlap: (
    input: CheckCloudSaveCustomPathOverlapInput
  ) => CheckCloudSaveCustomPathOverlapResult;
  uploadLocalSaveBlob: (
    absolutePath: string,
    uploadUrl: string,
    contentLength: string,
    checksumSha256: string
  ) => Promise<void>;
  resolveRestoreTargets: (
    input: ResolveRestoreTargetsInput
  ) => Promise<ResolveRestoreTargetsResult>;
  downloadRestoreBlobToTemp: (
    snapshotId: string,
    hash: string,
    expectedSizeBytes: number,
    downloadUrl: string,
    tempRoot: string
  ) => Promise<string>;
  verifyDownloadedRestoreFile: (
    tempPath: string,
    expectedHash: string
  ) => Promise<VerifyDownloadedRestoreFileResult>;
  shouldSkipRestoreFile: (
    localPath: string,
    expectedHash: string
  ) => Promise<boolean>;
  replaceRestoreTargets: (
    files: ReplaceRestoreTarget[]
  ) => Promise<ReplaceRestoreTargetsResult>;
  deleteLocalSaveTargets: (
    files: DeleteLocalSaveTarget[],
    cleanupRootPaths?: string[]
  ) => Promise<DeleteLocalSaveTargetsResult>;
  cleanupRestoreTempSnapshot: (
    snapshotId: string,
    tempRoot: string
  ) => Promise<void>;
  // In-game overlay natives (Windows-only; no-op fallbacks elsewhere).
  startOverlayKeyboardWatcher: () => boolean;
  getOverlayKeyboardEventCount: () => number;
  getOverlayGamepadButtons: () => number;
  getForegroundProcessId: () => number;
  isCurrentProcessElevated: () => boolean;
  getProcessAccessStatus: (pid: number) => {
    canInject?: boolean;
    can_inject?: boolean;
    errorCode?: number;
    error_code?: number;
  };
  launchElevated: (
    executable: string,
    parameters: string,
    workingDirectory: string
  ) => boolean;
  launchElevatedPresentmon: (
    executable: string,
    outputFile: string,
    targetPid: number,
    sessionName: string
  ) => Promise<boolean>;
  stopElevatedPresentmon: () => Promise<boolean>;
  controlProcessTree: (
    rootPid: number,
    action: "suspend" | "resume" | "terminate"
  ) => {
    succeededPids?: number[];
    succeeded_pids?: number[];
    failedPids?: number[];
    failed_pids?: number[];
    unsupported: boolean;
    error?: string | null;
  };
  // BrowserWindow overlay placement (Windows-only; no-op fallbacks elsewhere).
  getProcessWindowBounds: (pid: number) => NativeWindowBounds | null;
  placeOverlayWindow: (windowHandle: Buffer, pid: number) => boolean;
  focusProcessWindow: (pid: number) => boolean;
  forceForegroundWindow: (windowHandle: number) => boolean;
  createOverlayInputGate: () => boolean;
  setOverlayInputBlock: (blocked: boolean) => boolean;
  setOverlayInputGate: (targetPid: number, blocked: boolean) => boolean;
  getOverlayInputGateStatus: (targetPid: number) => {
    ready: boolean;
    ownerPid?: number;
    owner_pid?: number;
    targetPid?: number;
    target_pid?: number;
    blocked: boolean;
    generation: number;
    readyPid?: number;
    ready_pid?: number;
    readyGeneration?: number;
    ready_generation?: number;
    capabilityMask?: number;
    capability_mask?: number;
    unsupportedModuleMask?: number;
    unsupported_module_mask?: number;
    hookStatus?: number;
    hook_status?: number;
  };
  injectInputHook: (
    pid: number,
    dllPath: string
  ) => { injected: boolean; stage: string; errorCode: number };
  // Per-app volume mixer (Windows Core Audio; empty/no-op elsewhere).
  getAudioSessions: () => NativeAudioSession[];
  setAudioSessionVolume: (pid: number, volume: number) => boolean;
  setAudioSessionMute: (pid: number, muted: boolean) => boolean;
};

export type NativeAudioSession = {
  pid: number;
  name: string;
  volume: number;
  muted: boolean;
};

export type NativeWindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
  windowId?: string;
  window_id?: string;
};

export type NativeProcessControlResult = {
  succeededPids: number[];
  failedPids: number[];
  unsupported: boolean;
  error: string | null;
};

export type SystemProcessMap = {
  processMap: Record<string, string[]>;
  winePrefixMap: Record<string, string>;
  linuxProcesses: Array<{
    name: string;
    cwd: string;
    exe: string;
    pid: number;
    appImagePath: string | null;
    steamCompatDataPath: string | null;
  }>;
};

// Runs in the worker thread (CJS context).
// "list"  → posts back the raw ProcessPayload array (used by close-game, launch-game)
// "map"   → posts back compact pre-built maps (used by the main loop's watchProcesses)
const WORKER_CODE = `
const { workerData, parentPort } = require('worker_threads');
const path = require('path');
if (process.platform === 'linux' && workerData.addonDir) {
  process.env.LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH
    ? workerData.addonDir + ':' + process.env.LD_LIBRARY_PATH
    : workerData.addonDir;
}
const addon = require(workerData.addonPath);
const platform = process.platform;

function buildMaps(processes) {
  const processMap = Object.create(null);
  const winePrefixMap = Object.create(null);
  const linuxProcesses = [];

  for (const proc of processes) {
    const key = proc.name && proc.name.toLowerCase();
    const value = platform === 'win32'
      ? proc.exe
      : path.join(proc.cwd || '', proc.name || '');

    if (!key || !value) continue;

    const steamCompatDataPath = proc.environ && proc.environ.STEAM_COMPAT_DATA_PATH;
    if (steamCompatDataPath) winePrefixMap[value] = steamCompatDataPath;

    if (platform === 'linux') {
      const appImagePath = proc.environ && proc.environ.APPIMAGE;
      linuxProcesses.push({
        name: key,
        cwd: (proc.cwd || '').toLowerCase(),
        exe: (proc.exe || '').toLowerCase(),
        pid: proc.pid,
        appImagePath: appImagePath ? appImagePath.toLowerCase() : null,
        steamCompatDataPath: steamCompatDataPath ? steamCompatDataPath.toLowerCase() : null,
      });
    }

    if (!processMap[key]) processMap[key] = [];
    processMap[key].push(value);
  }

  return { processMap, winePrefixMap, linuxProcesses };
}

parentPort.on('message', (type) => {
  try {
    const processes = addon.listProcesses();
    if (type === 'map') {
      parentPort.postMessage({ type: 'map', result: buildMaps(processes) });
    } else {
      parentPort.postMessage({ type: 'list', result: processes });
    }
  } catch (_) {
    if (type === 'map') {
      parentPort.postMessage({ type: 'map', result: { processMap: {}, winePrefixMap: {}, linuxProcesses: [] } });
    } else {
      parentPort.postMessage({ type: 'list', result: [] });
    }
  }
});
`;

type PendingResolver =
  | { type: "list"; resolve: (p: ProcessPayload[]) => void }
  | { type: "map"; resolve: (m: SystemProcessMap) => void };

export class NativeAddon {
  private static nativeModule: HydraNativeModule | null = null;
  private static worker: Worker | null = null;
  private static pendingResolvers: PendingResolver[] = [];

  private static resolveAddonPath() {
    if (app.isPackaged) {
      return path.join(
        process.resourcesPath,
        "hydra-native",
        "hydra-native.node"
      );
    }

    return path.join(app.getAppPath(), "hydra-native", "hydra-native.node");
  }

  private static load() {
    if (this.nativeModule) return this.nativeModule;

    const addonPath = this.resolveAddonPath();
    const addonDir = path.dirname(addonPath);

    if (!fs.existsSync(addonPath)) {
      throw new Error(`GameHub native addon not found at ${addonPath}`);
    }

    if (process.platform === "linux") {
      process.env.LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH
        ? `${addonDir}:${process.env.LD_LIBRARY_PATH}`
        : addonDir;
    }

    const require = createRequire(import.meta.url);
    const nativeModule = require(addonPath) as HydraNativeModule;

    this.nativeModule = nativeModule;

    return nativeModule;
  }

  private static getWorker(): Worker {
    if (this.worker) return this.worker;

    const addonPath = this.resolveAddonPath();
    const addonDir = path.dirname(addonPath);

    if (!fs.existsSync(addonPath)) {
      throw new Error(`GameHub native addon not found at ${addonPath}`);
    }

    this.worker = new Worker(WORKER_CODE, {
      eval: true,
      workerData: { addonPath, addonDir },
    });

    this.worker.on("message", ({ result }) => {
      const pending = this.pendingResolvers.shift();
      if (!pending) return;
      if (pending.type === "list") {
        (pending.resolve as (p: ProcessPayload[]) => void)(
          (result as ProcessPayload[]).filter(
            (p): p is ProcessPayload =>
              typeof p?.pid === "number" &&
              typeof p?.name === "string" &&
              p.name.length > 0
          )
        );
      } else {
        (pending.resolve as (m: SystemProcessMap) => void)(
          result as SystemProcessMap
        );
      }
    });

    this.worker.on("error", (error) => {
      logger.error("Process list worker error", error);
      this.drainResolvers();
    });

    this.worker.on("exit", (code) => {
      if (code !== 0)
        logger.error(`Process list worker exited with code ${code}`);
      this.worker = null;
      this.drainResolvers();
    });

    return this.worker;
  }

  public static processProfileImage(
    imagePath: string,
    targetExtension = "webp"
  ) {
    try {
      const response = this.load().processProfileImage(
        imagePath,
        targetExtension
      );

      const normalizedImagePath = response.imagePath ?? response.image_path;
      const normalizedMimeType = response.mimeType ?? response.mime_type;

      if (!normalizedImagePath || !normalizedMimeType) {
        throw new Error("GameHub native addon returned an invalid payload");
      }

      return {
        imagePath: normalizedImagePath,
        mimeType: normalizedMimeType,
      };
    } catch (error) {
      logger.error("Failed to process profile image via native addon", error);
      throw error;
    }
  }

  private static drainResolvers() {
    const drained = this.pendingResolvers.splice(0);
    for (const pending of drained) {
      if (pending.type === "list") pending.resolve([]);
      else
        pending.resolve({
          processMap: {},
          winePrefixMap: {},
          linuxProcesses: [],
        });
    }
  }

  public static listProcesses(): Promise<ProcessPayload[]> {
    return new Promise((resolve) => {
      try {
        const worker = this.getWorker();
        this.pendingResolvers.push({ type: "list", resolve });
        worker.postMessage("list");
      } catch {
        resolve([]);
      }
    });
  }

  public static getSystemProcessMap(): Promise<SystemProcessMap> {
    return new Promise((resolve) => {
      try {
        const worker = this.getWorker();
        this.pendingResolvers.push({ type: "map", resolve });
        worker.postMessage("map");
      } catch {
        resolve({ processMap: {}, winePrefixMap: {}, linuxProcesses: [] });
      }
    });
  }

  // ── In-game overlay natives (ported from Hydra PR #2579) ──────────────────
  // Run on the main thread (they touch process-global state: the Raw Input
  // window, this process's elevation token, the foreground window). Every call
  // is guarded so a platform without the native (or an older addon) degrades to
  // a safe default instead of throwing.

  public static startOverlayKeyboardWatcher(): boolean {
    try {
      return this.load().startOverlayKeyboardWatcher();
    } catch {
      return false;
    }
  }

  public static getOverlayKeyboardEventCount(): number {
    try {
      return this.load().getOverlayKeyboardEventCount();
    } catch {
      return 0;
    }
  }

  public static getOverlayGamepadButtons(): number {
    try {
      return this.load().getOverlayGamepadButtons();
    } catch {
      return 0;
    }
  }

  public static getForegroundProcessId(): number {
    try {
      return this.load().getForegroundProcessId();
    } catch {
      return 0;
    }
  }

  public static isCurrentProcessElevated(): boolean {
    try {
      return this.load().isCurrentProcessElevated();
    } catch {
      return false;
    }
  }

  public static getProcessAccessStatus(pid: number) {
    try {
      const status = this.load().getProcessAccessStatus(pid);
      return {
        canInject: status.canInject ?? status.can_inject ?? false,
        errorCode: status.errorCode ?? status.error_code ?? 0,
      };
    } catch {
      return { canInject: false, errorCode: 0 };
    }
  }

  public static launchElevated(
    executable: string,
    parameters: string,
    workingDirectory: string
  ) {
    try {
      return this.load().launchElevated(
        executable,
        parameters,
        workingDirectory
      );
    } catch (error) {
      logger.error("Failed to request elevated GameHub process", error);
      return false;
    }
  }

  public static launchElevatedPresentMon(
    executable: string,
    outputFile: string,
    targetPid: number,
    sessionName: string
  ): Promise<boolean> {
    try {
      return this.load().launchElevatedPresentmon(
        executable,
        outputFile,
        targetPid,
        sessionName
      );
    } catch (error) {
      logger.error("Failed to launch elevated PresentMon", error);
      return Promise.resolve(false);
    }
  }

  public static stopElevatedPresentMon(): Promise<boolean> {
    try {
      return this.load()
        .stopElevatedPresentmon()
        .catch((error) => {
          logger.error("Failed to stop elevated PresentMon", error);
          return false;
        });
    } catch (error) {
      logger.error("Failed to stop elevated PresentMon", error);
      return Promise.resolve(false);
    }
  }

  public static controlProcessTree(
    rootPid: number,
    action: "suspend" | "resume" | "terminate"
  ): NativeProcessControlResult {
    try {
      const result = this.load().controlProcessTree(rootPid, action);
      return {
        succeededPids: result.succeededPids ?? result.succeeded_pids ?? [],
        failedPids: result.failedPids ?? result.failed_pids ?? [],
        unsupported: result.unsupported,
        error: result.error ?? null,
      };
    } catch (error) {
      logger.error("Failed to control active game process tree", error);
      return {
        succeededPids: [],
        failedPids: rootPid > 0 ? [rootPid] : [],
        unsupported: process.platform !== "win32",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ── BrowserWindow overlay window placement (Windows only) ─────────────────
  // Find the game window for a given PID and get its client-area bounds, or
  // place the overlay window over it. Non-Windows builds return safe defaults.

  public static getProcessWindowBounds(pid: number): NativeWindowBounds | null {
    try {
      const bounds = this.load().getProcessWindowBounds(pid);
      if (!bounds) return null;
      return {
        ...bounds,
        windowId: bounds.windowId ?? bounds.window_id,
      };
    } catch {
      return null;
    }
  }

  public static placeOverlayWindow(windowHandle: Buffer, pid: number): boolean {
    try {
      return this.load().placeOverlayWindow(windowHandle, pid);
    } catch {
      return false;
    }
  }

  public static focusProcessWindow(pid: number): boolean {
    try {
      return this.load().focusProcessWindow(pid);
    } catch {
      return false;
    }
  }

  /**
   * Take the foreground for the overlay window, so keystrokes and clicks route
   * to the overlay's own widgets. Electron's focus() is not sufficient over a
   * fullscreen game because of Windows' foreground lock.
   *
   * This does NOT stop the game reading input, which was the original claim
   * here. Logging proved otherwise: the overlay wins the foreground on the
   * first attempt (`overlayHasForeground: true`) and games keep responding,
   * because XInput 1.3 does no focus gating, `GetAsyncKeyState` is global, and
   * `RIDEV_INPUTSINK` raw input is a request for background delivery. Gating
   * those is what setOverlayInputBlock + injectInputHook are for.
   */
  public static forceForegroundWindow(windowHandle: number): boolean {
    try {
      return this.load().forceForegroundWindow(windowHandle);
    } catch {
      return false;
    }
  }

  // ── In-game input gate ────────────────────────────────────────────────────
  // A DLL injected into the game answers XInput / GetAsyncKeyState / raw input
  // with neutral state while a shared flag is set, which is the only way to
  // take input off a game that does not honour focus. Every entry point below
  // can fail (a protected process, a bitness mismatch, an antivirus block).
  // An injection result only means LoadLibrary completed; callers must require
  // getOverlayInputGateStatus().ready before exposing an interactive overlay.

  private static resolveInputHookPath() {
    const root = app.isPackaged ? process.resourcesPath : app.getAppPath();
    return path.join(root, "hydra-native", "gamehub-inputhook.dll");
  }

  /** Create the shared flag. Idempotent; call before injecting. */
  public static createOverlayInputGate(): boolean {
    try {
      return this.load().createOverlayInputGate();
    } catch {
      return false;
    }
  }

  /** Gate or ungate the game's input. Takes effect on the game's next poll. */
  public static setOverlayInputBlock(blocked: boolean): boolean {
    try {
      return this.load().setOverlayInputBlock(blocked);
    } catch {
      return false;
    }
  }

  /** Gate input only inside the selected render process. */
  public static setOverlayInputGate(
    targetPid: number,
    blocked: boolean
  ): boolean {
    try {
      return this.load().setOverlayInputGate(targetPid, blocked);
    } catch {
      return false;
    }
  }

  /**
   * Read the worker-published hook handshake for exactly one target PID. The
   * generation fields prevent a late reply from a previous render process
   * (for example Khazan's loader before its BBQ render child) being accepted.
   */
  public static getOverlayInputGateStatus(
    targetPid: number
  ): OverlayInputGateNativeStatus {
    const empty: OverlayInputGateNativeStatus = {
      ready: false,
      ownerPid: 0,
      targetPid: 0,
      blocked: false,
      generation: 0,
      readyPid: 0,
      readyGeneration: 0,
      capabilityMask: 0,
      unsupportedModuleMask: 0,
      hookStatus: 0,
    };
    if (process.platform !== "win32" || targetPid <= 0) return empty;
    try {
      const status = this.load().getOverlayInputGateStatus(targetPid);
      return {
        ready: status.ready,
        ownerPid: status.ownerPid ?? status.owner_pid ?? 0,
        targetPid: status.targetPid ?? status.target_pid ?? 0,
        blocked: status.blocked,
        generation: status.generation,
        readyPid: status.readyPid ?? status.ready_pid ?? 0,
        readyGeneration: status.readyGeneration ?? status.ready_generation ?? 0,
        capabilityMask: status.capabilityMask ?? status.capability_mask ?? 0,
        unsupportedModuleMask:
          status.unsupportedModuleMask ?? status.unsupported_module_mask ?? 0,
        hookStatus: status.hookStatus ?? status.hook_status ?? 0,
      };
    } catch {
      return empty;
    }
  }

  /**
   * Inject the input gate into `pid`. Safe to call repeatedly: loading the same
   * DLL twice returns the existing module without starting a second worker.
   */
  public static injectInputHook(pid: number): {
    injected: boolean;
    stage: string;
    errorCode: number;
  } {
    if (process.platform !== "win32" || !pid) {
      return { injected: false, stage: "unsupported", errorCode: 0 };
    }
    try {
      const dllPath = this.resolveInputHookPath();
      // Distinguished from an injection refusal on purpose: a missing file
      // means the DLL was not packaged, which is a build problem, not a
      // permissions one.
      if (!fs.existsSync(dllPath)) {
        return { injected: false, stage: "not-packaged", errorCode: 0 };
      }
      return this.load().injectInputHook(pid, dllPath);
    } catch (error) {
      return {
        injected: false,
        stage: `threw: ${error instanceof Error ? error.message : String(error)}`,
        errorCode: 0,
      };
    }
  }

  // ── Cloud Saves V2 native pipeline ───────────────────────────────────────

  public static buildLocalGameSnapshotPipeline(
    input: BuildLocalGameSnapshotPipelineInput
  ) {
    return this.load().buildLocalGameSnapshotPipeline(input);
  }

  public static getSaveRulesForGame(input: GetSaveRulesForGameInput) {
    return this.load().getSaveRulesForGame(input);
  }

  public static checkCloudSaveCustomPathOverlap(
    input: CheckCloudSaveCustomPathOverlapInput
  ) {
    return this.load().checkCloudSaveCustomPathOverlap(input);
  }

  public static buildSnapshotAggregateHash(
    input: BuildSnapshotAggregateHashInput
  ) {
    return this.load().buildSnapshotAggregateHash(input);
  }

  public static uploadLocalSaveBlob(
    absolutePath: string,
    uploadUrl: string,
    contentLength: string,
    checksumSha256: string
  ) {
    return this.load().uploadLocalSaveBlob(
      absolutePath,
      uploadUrl,
      contentLength,
      checksumSha256
    );
  }

  public static resolveRestoreTargets(input: ResolveRestoreTargetsInput) {
    return this.load().resolveRestoreTargets(input);
  }

  public static downloadRestoreBlobToTemp(
    snapshotId: string,
    hash: string,
    expectedSizeBytes: number,
    downloadUrl: string,
    tempRoot: string
  ) {
    return this.load().downloadRestoreBlobToTemp(
      snapshotId,
      hash,
      expectedSizeBytes,
      downloadUrl,
      tempRoot
    );
  }

  public static verifyDownloadedRestoreFile(
    tempPath: string,
    expectedHash: string
  ) {
    return this.load().verifyDownloadedRestoreFile(tempPath, expectedHash);
  }

  public static shouldSkipRestoreFile(input: ShouldSkipRestoreFileInput) {
    return this.load().shouldSkipRestoreFile(
      input.localPath,
      input.expectedHash
    );
  }

  public static replaceRestoreTargets(files: ReplaceRestoreTarget[]) {
    return this.load().replaceRestoreTargets(files);
  }

  public static deleteLocalSaveTargets(
    files: DeleteLocalSaveTarget[],
    cleanupRootPaths?: string[]
  ) {
    return this.load().deleteLocalSaveTargets(files, cleanupRootPaths);
  }

  public static cleanupRestoreTempSnapshot(
    snapshotId: string,
    tempRoot: string
  ) {
    return this.load().cleanupRestoreTempSnapshot(snapshotId, tempRoot);
  }

  // ── Per-app volume mixer (Windows Core Audio) ─────────────────────────────
  // The overlay's "volume mixer" widget reads and writes each running app's
  // audio session. Non-Windows builds (and older addons) return an empty list
  // and treat writes as no-ops.

  public static getAudioSessions(): NativeAudioSession[] {
    try {
      const sessions = this.load().getAudioSessions();
      return Array.isArray(sessions) ? sessions : [];
    } catch {
      return [];
    }
  }

  public static setAudioSessionVolume(pid: number, volume: number): boolean {
    try {
      return this.load().setAudioSessionVolume(pid, volume);
    } catch {
      return false;
    }
  }

  public static setAudioSessionMute(pid: number, muted: boolean): boolean {
    try {
      return this.load().setAudioSessionMute(pid, muted);
    } catch {
      return false;
    }
  }
}
