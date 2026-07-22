import updater, {
  UpdateInfo,
  ProgressInfo,
  UpdateCheckResult,
} from "electron-updater";
import { app } from "electron";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { spawn } from "node:child_process";
import { logger } from "./logger";

const { autoUpdater } = updater;

/** Read-only GitHub token injected at build time (see vite-env.d.ts). Required
 *  because the release repo is private. */
const UPDATER_TOKEN = import.meta.env.MAIN_VITE_UPDATER_GH_TOKEN;

/** Headers for GitHub API / asset requests. When downloading a private-repo
 *  asset, the API redirects to a signed CDN URL on another origin; per the
 *  fetch spec the Authorization header is dropped on that cross-origin
 *  redirect, so the token never leaks to the CDN. */
function githubHeaders(
  extra: Record<string, string> = {}
): Record<string, string> {
  return {
    "User-Agent": "GameHub-Updater/2.0",
    ...(UPDATER_TOKEN ? { Authorization: `Bearer ${UPDATER_TOKEN}` } : {}),
    ...extra,
  };
}

export type UpdateCheckerEvent =
  | { type: "checking"; currentVersion: string }
  | { type: "not-available"; currentVersion: string }
  | { type: "available"; version: string }
  | {
      type: "downloading";
      percent: number;
      bytesPerSecond: number;
      transferred: number;
      total: number;
    }
  | { type: "downloaded"; version: string }
  | { type: "applying" }
  | { type: "error"; message: string };

export class UpdateCheckerManager {
  private static sendEventFn: ((event: UpdateCheckerEvent) => void) | null =
    null;
  private static portableExtractDir = "";

  /**
   * Events emitted before the splash renderer has subscribed are buffered and
   * replayed once it signals ready. Without this, a post-update relaunch — where
   * the GitHub check resolves almost instantly because electron-updater's feed
   * is already warm — fires "checking"/"not-available" before the freshly
   * created splash window has mounted its listener, so the splash stays stuck on
   * "Checking for updates…". (A manual reopen's slower cold check wins the race,
   * which is why it looked fine.)
   */
  private static eventBuffer: UpdateCheckerEvent[] = [];
  private static rendererReady = false;

  /** Called by the splash renderer (via IPC) once its event listener is set up:
   *  flush anything that was emitted before it could hear it. */
  static markRendererReady() {
    this.rendererReady = true;
    if (this.sendEventFn) {
      for (const event of this.eventBuffer) this.sendEventFn(event);
    }
    this.eventBuffer = [];
  }

  /**
   * True while the startup splash is actively checking. The periodic
   * UpdateManager check (main-loop) shares the same global autoUpdater and calls
   * removeAllListeners(); it stands down while this is set so it can't stomp the
   * splash's in-flight check.
   */
  static splashInProgress = false;

  /**
   * Set to true while an update is being applied (NSIS install or portable
   * batch). The before-quit handler in index.ts checks this so it doesn't
   * preventDefault + do async cleanup — which races the NSIS installer and
   * leaves the old exe locked ("file in use" dialog / old version reopens).
   */
  static isApplyingUpdate = false;

  /** Reject a promise if it hasn't settled within `ms`. */
  private static withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error("Update check timed out")), ms)
      ),
    ]);
  }

  static readonly isPortable = (() => {
    if (
      process.env.PORTABLE_EXECUTABLE_DIR ||
      process.env.PORTABLE_EXECUTABLE_FILE
    )
      return true;
    if (process.platform === "win32" && app.isPackaged) {
      try {
        const exeDir = path.dirname(process.execPath);
        // Explicit portable marker written by the in-app wizard
        if (fs.existsSync(path.join(exeDir, "portable"))) return true;
        // Has the setup marker → definitely an installed (NSIS or wizard-installed) build
        if (fs.existsSync(path.join(exeDir, ".gamehub-setup"))) return false;
        // No marker yet — could be: (a) ZIP extract on first run, (b) NSIS staging
        // folder before the wizard completes.
        // Distinguish them: NSIS always drops an uninstaller next to the exe.
        // If we find it, we're in the staging folder → not portable.
        const uninstaller = path.join(exeDir, "Uninstall GameHub.exe");
        if (fs.existsSync(uninstaller)) return false;
        // No marker, no uninstaller → genuine ZIP-extracted portable run
        return true;
      } catch {
        // ignore
      }
    }
    return false;
  })();

  static setSendEvent(fn: (event: UpdateCheckerEvent) => void) {
    this.sendEventFn = fn;
  }

  private static sendEvent(event: UpdateCheckerEvent) {
    // Until the renderer says it's listening, buffer (don't drop) events so a
    // fast post-update check can't fire before anyone hears it.
    if (!this.rendererReady) {
      this.eventBuffer.push(event);
      return;
    }
    this.sendEventFn?.(event);
  }

  static async checkAndUpdate(): Promise<void> {
    this.sendEvent({ type: "checking", currentVersion: app.getVersion() });

    logger.log(
      `[updater] checking for updates — current v${app.getVersion()}, feed github:Kewz4/GameHub2026, portable=${this.isPortable}`
    );

    if (!app.isPackaged) {
      await new Promise((r) => setTimeout(r, 800));
      this.sendEvent({
        type: "not-available",
        currentVersion: app.getVersion(),
      });
      return;
    }

    autoUpdater.autoDownload = false;

    // electron-updater reaches GitHub through Electron's own `net` stack on a
    // dedicated session — NOT the path a browser or PowerShell uses. That
    // session honours the Windows "Automatically detect settings" proxy option
    // (WPAD), which is on by default. On a network where WPAD discovery stalls,
    // the request hangs while every other app works. Force a direct connection
    // so the check never waits on proxy auto-detection. (General app traffic
    // uses the default session and is unaffected.)
    try {
      await autoUpdater.netSession.setProxy({ mode: "direct" });
    } catch (err) {
      logger.warn("[updater] could not force direct proxy:", err);
    }

    // Route electron-updater's own verbose logs into our logger so the in-app
    // Console shows exactly where a check stalls.
    autoUpdater.logger = {
      info: (m?: unknown) => logger.log("[updater:eu]", m),
      warn: (m?: unknown) => logger.warn("[updater:eu]", m),
      error: (m?: unknown) => logger.error("[updater:eu]", m),
      debug: (m?: unknown) => logger.log("[updater:eu:debug]", m),
    };

    // CRITICAL: decide from the *promise result* of checkForUpdates(), not from
    // event listeners. The periodic UpdateManager check (main-loop) shares this
    // same global autoUpdater and calls removeAllListeners(), so if we relied on
    // the update-not-available/update-available events it would steal them — the
    // splash would then never hear back and hit its timeout, showing "no
    // response from GitHub" even though the shared check actually succeeded in a
    // couple of seconds (logged as "in-app check: up to date"). The promise
    // resolves for THIS call regardless of listener churn. We also flag that the
    // splash owns the updater so the periodic check stands down meanwhile.
    this.splashInProgress = true;

    let result: UpdateCheckResult | null = null;
    try {
      result = await this.withTimeout(autoUpdater.checkForUpdates(), 15_000);
    } catch (err) {
      logger.error("[updater] check failed:", err);
      this.sendEvent({
        type: "error",
        message:
          "Couldn't reach GitHub to check for updates — continuing without checking.",
      });
      return;
    } finally {
      this.splashInProgress = false;
    }

    const latestVersion = result?.updateInfo?.version ?? null;
    const updateAvailable =
      (result?.isUpdateAvailable ?? false) &&
      latestVersion != null &&
      latestVersion !== app.getVersion();

    if (!updateAvailable) {
      logger.log(`[updater] up to date (v${app.getVersion()})`);
      this.sendEvent({
        type: "not-available",
        currentVersion: app.getVersion(),
      });
      return;
    }

    logger.log(`[updater] update available: v${latestVersion}`);
    this.sendEvent({ type: "available", version: latestVersion! });

    if (this.isPortable && process.platform === "win32") {
      this.downloadPortableUpdate(latestVersion!).catch((err) => {
        logger.error("Portable update download failed:", err);
        this.sendEvent({ type: "error", message: String(err) });
      });
      return;
    }

    // NSIS install path — attach transient listeners just for the download.
    autoUpdater.removeAllListeners();
    autoUpdater
      .on("download-progress", (progress: ProgressInfo) => {
        this.sendEvent({
          type: "downloading",
          percent: progress.percent,
          bytesPerSecond: progress.bytesPerSecond,
          transferred: progress.transferred,
          total: progress.total,
        });
      })
      .on("update-downloaded", (info: UpdateInfo) => {
        this.sendEvent({ type: "downloaded", version: info.version });
      })
      .on("error", (err: Error) => {
        logger.error("[updater] download error:", err);
        this.sendEvent({ type: "error", message: String(err) });
      });
    autoUpdater.downloadUpdate().catch((err) => {
      logger.error("downloadUpdate failed:", err);
      this.sendEvent({ type: "error", message: String(err) });
    });
  }

  static applyNsisUpdate(): void {
    this.sendEvent({ type: "applying" });
    this.isApplyingUpdate = true;
    // Delay before quitting to let the renderer flush — avoids ERROR 32.
    setTimeout(() => {
      // Silent install (isSilent=true) so no NSIS UI window appears.
      // Force run after (isForceRunAfter=true) relaunches the new version.
      // isApplyingUpdate is set so the before-quit handler in index.ts
      // doesn't preventDefault + do async cleanup, which races the installer
      // and leaves the old exe locked (the "old launcher reopens / terminal
      // asks to close it" bug).
      autoUpdater.quitAndInstall(true, true);
    }, 1500);
  }

  private static async downloadPortableUpdate(version: string): Promise<void> {
    const apiUrl = `https://api.github.com/repos/Kewz4/GameHub2026/releases/tags/v${version}`;
    const apiRes = await fetch(apiUrl, {
      headers: githubHeaders({ Accept: "application/vnd.github+json" }),
    });

    if (!apiRes.ok) throw new Error(`GitHub API returned ${apiRes.status}`);

    const release = (await apiRes.json()) as {
      // `url` is the API asset endpoint (works for private repos with the
      // token); `browser_download_url` needs an authenticated browser session.
      assets: Array<{
        name: string;
        url: string;
        browser_download_url: string;
      }>;
    };

    const zipAsset = release.assets.find(
      (a) =>
        a.name.toLowerCase().endsWith(".zip") &&
        (a.name.toLowerCase().includes("win") ||
          a.name.toLowerCase().includes("x64"))
    );

    if (!zipAsset) throw new Error("No Windows ZIP asset found in release");

    const tmpDir = os.tmpdir();
    const zipPath = path.join(tmpDir, "gamehub-update.zip");
    const extractDir = path.join(tmpDir, "gamehub-update");

    // Download via the asset API endpoint (not browser_download_url) so the
    // request is authenticated for the private repo. `Accept: octet-stream`
    // makes GitHub return the binary (302 → signed CDN URL).
    const zipRes = await fetch(zipAsset.url, {
      headers: githubHeaders({ Accept: "application/octet-stream" }),
    });
    const total = parseInt(zipRes.headers.get("content-length") ?? "0", 10);
    const reader = zipRes.body!.getReader();
    const chunks: Buffer[] = [];
    let downloaded = 0;
    const startTime = Date.now();
    let lastBytes = 0;
    let lastTime = startTime;
    // Keep the last calculated speed so events between 500ms recalculations
    // don't send 0 (which made the renderer's speed display flicker to "0 B/s"
    // every other update).
    let lastBytesPerSecond = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
      downloaded += value.length;
      const now = Date.now();
      const elapsedSinceLast = (now - lastTime) / 1000;
      // Recalculate speed at most every 500 ms to smooth the display
      if (elapsedSinceLast >= 0.5) {
        lastBytesPerSecond = (downloaded - lastBytes) / elapsedSinceLast;
        lastBytes = downloaded;
        lastTime = now;
      }
      this.sendEvent({
        type: "downloading",
        percent: total ? (downloaded / total) * 80 : 0,
        bytesPerSecond: lastBytesPerSecond,
        transferred: downloaded,
        total,
      });
    }
    void startTime;

    fs.writeFileSync(zipPath, Buffer.concat(chunks));

    if (fs.existsSync(extractDir)) {
      fs.rmSync(extractDir, { recursive: true });
    }

    // Use 7z to extract
    const { SevenZip } = await import("./7zip");
    await SevenZip.extractFile(
      { filePath: zipPath, outputPath: extractDir },
      (p) => {
        this.sendEvent({
          type: "downloading",
          percent: 80 + p.percent * 0.2,
          bytesPerSecond: 0, // extraction phase — no meaningful speed
          transferred: 0,
          total: 0,
        });
      }
    );

    try {
      fs.unlinkSync(zipPath);
    } catch {
      // ignore
    }

    this.portableExtractDir = extractDir;
    this.sendEvent({ type: "downloaded", version });
  }

  static applyPortableUpdate(): void {
    this.sendEvent({ type: "applying" });
    this.isApplyingUpdate = true;

    const exeDir =
      process.env.PORTABLE_EXECUTABLE_DIR ?? path.dirname(process.execPath);
    const exePath = process.env.PORTABLE_EXECUTABLE_FILE ?? process.execPath;
    const exeName = path.basename(exePath);
    const srcDir = this.portableExtractDir;
    const batPath = path.join(os.tmpdir(), "gamehub-apply-update.bat");

    // Find the actual unpacked dir inside the extracted archive
    // electron-builder zip typically puts files in a "win-unpacked" subdir
    const winUnpacked = path.join(srcDir, "win-unpacked");
    const realSrc = fs.existsSync(winUnpacked) ? winUnpacked : srcDir;

    const bat = [
      "@echo off",
      "timeout /t 6 /nobreak >nul",
      `robocopy "${realSrc}" "${exeDir}" /E /IS /IT /NFL /NDL /NJH /NJS /NC /NS >nul`,
      `start "" "${path.join(exeDir, exeName)}"`,
      `rd /s /q "${srcDir}" >nul 2>&1`,
      `del "%~f0" >nul 2>&1`,
    ].join("\r\n");

    fs.writeFileSync(batPath, bat, "latin1");

    spawn("cmd.exe", ["/c", batPath], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();

    // Force-exit (bypasses before-quit's preventDefault + async cleanup which
    // would race the batch file's robocopy — the old exe stays locked and
    // the "start" command reopens the old version). The batch file waits 6s
    // before copying, which is plenty for the process to exit.
    app.exit(0);
  }
}
