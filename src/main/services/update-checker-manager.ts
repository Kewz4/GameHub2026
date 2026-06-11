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
    if (process.env.PORTABLE_EXECUTABLE_DIR || process.env.PORTABLE_EXECUTABLE_FILE)
      return true;
    // ZIP portable: packaged win32 build with no .gamehub-setup marker means
    // the user extracted the ZIP and is running directly (never went through the
    // NSIS installer), so we must use the portable update path.
    if (process.platform === "win32" && app.isPackaged) {
      try {
        const exeDir = path.dirname(process.execPath);
        if (fs.existsSync(path.join(exeDir, "portable"))) return true;
        if (!fs.existsSync(path.join(exeDir, ".gamehub-setup"))) return true;
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

    autoUpdater
      .on("update-not-available", () => {
        this.sendEvent({
          type: "not-available",
          currentVersion: app.getVersion(),
        });
      })
      .on("update-available", (info: UpdateInfo) => {
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
        logger.error("Auto-updater error:", err);
        this.sendEvent({ type: "error", message: err.message });
      });

    autoUpdater.checkForUpdates().catch((err) => {
      logger.error("checkForUpdates failed:", err);
      this.sendEvent({ type: "error", message: String(err) });
    });
  }

  static applyNsisUpdate(): void {
    this.sendEvent({ type: "applying" });
    autoUpdater.quitAndInstall(true, true);
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

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
      downloaded += value.length;
      this.sendEvent({
        type: "downloading",
        percent: total ? (downloaded / total) * 80 : 0,
        bytesPerSecond: 0,
        transferred: downloaded,
        total,
      });
    }

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
          bytesPerSecond: 0,
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
      "timeout /t 3 /nobreak >nul",
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
