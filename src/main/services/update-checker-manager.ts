import updater, { UpdateInfo, ProgressInfo } from "electron-updater";
import { app } from "electron";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { spawn } from "node:child_process";
import { logger } from "./logger";

const { autoUpdater } = updater;

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
    this.sendEventFn?.(event);
  }

  static async checkAndUpdate(): Promise<void> {
    this.sendEvent({ type: "checking", currentVersion: app.getVersion() });

    logger.log(
      `[updater] checking for updates — current v${app.getVersion()}, feed github:Kewz4/hydra, portable=${this.isPortable}`
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
    autoUpdater.removeAllListeners();

    // electron-updater reaches GitHub through Electron's own `net` stack on a
    // dedicated session — NOT the path a browser or PowerShell uses. That
    // session honours the Windows "Automatically detect settings" proxy option
    // (WPAD), which is on by default. On a network where WPAD discovery stalls,
    // the request hangs with no response and no error (exactly the silent
    // timeout users hit) while every other app works. Force a direct
    // connection so the check never waits on proxy auto-detection. (General app
    // traffic uses the default session and is unaffected.)
    try {
      await autoUpdater.netSession.setProxy({ mode: "direct" });
    } catch (err) {
      logger.warn("[updater] could not force direct proxy:", err);
    }

    // Route electron-updater's own verbose logs into our logger so the in-app
    // Console shows exactly where a check stalls (DNS / connect / redirect)
    // instead of leaving us to guess from a silent timeout.
    autoUpdater.logger = {
      info: (m?: unknown) => logger.log("[updater:eu]", m),
      warn: (m?: unknown) => logger.warn("[updater:eu]", m),
      error: (m?: unknown) => logger.error("[updater:eu]", m),
      debug: (m?: unknown) => logger.log("[updater:eu:debug]", m),
    };

    // If GitHub doesn't respond within 20 s, assume no update and proceed.
    // Also remove all listeners so a late-arriving response doesn't fire
    // after the UI has already advanced.
    const fallbackTimer = setTimeout(() => {
      autoUpdater.removeAllListeners();
      logger.warn("[updater] no response within 20s — proceeding");
      this.sendEvent({
        type: "error",
        message: "Update check timed out (no response from GitHub).",
      });
    }, 20_000);
    const clearFallback = () => clearTimeout(fallbackTimer);

    autoUpdater
      .on("update-not-available", () => {
        clearFallback();
        logger.log(`[updater] up to date (v${app.getVersion()})`);
        this.sendEvent({
          type: "not-available",
          currentVersion: app.getVersion(),
        });
      })
      .on("update-available", (info: UpdateInfo) => {
        clearFallback();
        if (info.version === app.getVersion()) {
          this.sendEvent({
            type: "not-available",
            currentVersion: app.getVersion(),
          });
          return;
        }
        this.sendEvent({ type: "available", version: info.version });
        if (this.isPortable && process.platform === "win32") {
          this.downloadPortableUpdate(info.version).catch((err) => {
            logger.error("Portable update download failed:", err);
            this.sendEvent({ type: "error", message: String(err) });
          });
        } else {
          autoUpdater.downloadUpdate().catch((err) => {
            logger.error("downloadUpdate failed:", err);
            this.sendEvent({ type: "error", message: String(err) });
          });
        }
      })
      .on("download-progress", (progress: ProgressInfo) => {
        this.sendEvent({
          type: "downloading",
          percent: progress.percent,
          bytesPerSecond: progress.bytesPerSecond,
          transferred: progress.transferred,
          total: progress.total,
        });
      })
      .on("update-downloaded", (_info: UpdateInfo) => {
        this.sendEvent({ type: "downloaded", version: _info.version });
      })
      .on("error", (err: Error) => {
        clearFallback();
        // Surface the real failure instead of masking it as "up to date" — a
        // silently-failing check is exactly why updates looked broken. The
        // splash auto-proceeds after showing it, so startup isn't blocked.
        logger.error("[updater] auto-updater error:", err);
        this.sendEvent({
          type: "error",
          message: `Update check failed: ${err?.message ?? String(err)}`,
        });
      });

    autoUpdater.checkForUpdates().catch((err) => {
      clearFallback();
      logger.error("[updater] checkForUpdates failed:", err);
      this.sendEvent({
        type: "error",
        message: `Update check failed: ${err?.message ?? String(err)}`,
      });
    });
  }

  static applyNsisUpdate(): void {
    this.sendEvent({ type: "applying" });
    // Delay before quitting to let the renderer flush — avoids ERROR 32.
    setTimeout(() => {
      autoUpdater.quitAndInstall(false, true);
    }, 1500);
  }

  private static async downloadPortableUpdate(version: string): Promise<void> {
    const apiUrl = `https://api.github.com/repos/Kewz4/hydra/releases/tags/v${version}`;
    const apiRes = await fetch(apiUrl, {
      headers: { "User-Agent": "GameHub-Updater/2.0" },
    });

    if (!apiRes.ok) throw new Error(`GitHub API returned ${apiRes.status}`);

    const release = (await apiRes.json()) as {
      assets: Array<{ name: string; browser_download_url: string }>;
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

    const zipRes = await fetch(zipAsset.browser_download_url);
    const total = parseInt(zipRes.headers.get("content-length") ?? "0", 10);
    const reader = zipRes.body!.getReader();
    const chunks: Buffer[] = [];
    let downloaded = 0;
    const startTime = Date.now();
    let lastBytes = 0;
    let lastTime = startTime;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
      downloaded += value.length;
      const now = Date.now();
      const elapsedSinceLast = (now - lastTime) / 1000;
      // Recalculate speed at most every 500 ms to smooth the display
      let bytesPerSecond = 0;
      if (elapsedSinceLast >= 0.5) {
        bytesPerSecond = (downloaded - lastBytes) / elapsedSinceLast;
        lastBytes = downloaded;
        lastTime = now;
      }
      this.sendEvent({
        type: "downloading",
        percent: total ? (downloaded / total) * 80 : 0,
        bytesPerSecond,
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

    app.quit();
  }
}
