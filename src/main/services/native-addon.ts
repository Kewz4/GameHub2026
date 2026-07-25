import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";

import { app } from "electron";
import type { ProcessPayload } from "./download/types";

import { logger } from "./logger";

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
  stopElevatedPresentmon: () => boolean;
  // BrowserWindow overlay placement (Windows-only; no-op fallbacks elsewhere).
  getProcessWindowBounds: (pid: number) => NativeWindowBounds | null;
  placeOverlayWindow: (windowHandle: Buffer, pid: number) => boolean;
  focusProcessWindow: (pid: number) => boolean;
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

  public static stopElevatedPresentMon(): boolean {
    try {
      return this.load().stopElevatedPresentmon();
    } catch {
      return false;
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
