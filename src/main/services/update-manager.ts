import updater, { UpdateInfo } from "electron-updater";
import { logger, WindowManager } from "@main/services";
import { AppUpdaterEvent, UserPreferences } from "@types";
import { app } from "electron";
import { publishNotificationUpdateReadyToInstall } from "@main/services/notifications";
import { db, levelKeys } from "@main/level";
import { UpdateCheckerManager } from "./update-checker-manager";

const { autoUpdater } = updater;
const sendEventsForDebug = false;

export class UpdateManager {
  private static hasNotified = false;
  private static newVersion = "";
  private static pendingUpdateInfo: UpdateInfo | null = null;
  private static updateDownloaded = false;

  private static mockValuesForDebug() {
    this.sendEvent({ type: "update-available", info: { version: "3.3.1" } });
    this.sendEvent({ type: "update-downloaded" });
  }

  private static sendEvent(event: AppUpdaterEvent) {
    WindowManager.mainWindow?.webContents.send("autoUpdaterEvent", event);
  }

  private static async isAutoInstallEnabled() {
    if (process.platform === "darwin") return false;
    if (process.platform === "win32") {
      return process.env.PORTABLE_EXECUTABLE_FILE == null;
    }

    if (process.platform === "linux") {
      const userPreferences = await db.get<string, UserPreferences | null>(
        levelKeys.userPreferences,
        {
          valueEncoding: "json",
        }
      );

      return userPreferences?.enableAutoInstall === true;
    }

    return false;
  }

  public static async checkForUpdates() {
    // The startup splash (UpdateCheckerManager) shares this same global
    // autoUpdater. While it's actively checking, stand down — calling
    // removeAllListeners()/checkForUpdates() here would stomp its in-flight
    // check (the cause of the splash timing out with "no response from GitHub"
    // while this periodic check happily reported "up to date").
    if (UpdateCheckerManager.splashInProgress) {
      return this.isAutoInstallEnabled();
    }

    autoUpdater
      .removeAllListeners()
      .on("update-available", (info: UpdateInfo) => {
        if (info.version === app.getVersion()) return;
        this.pendingUpdateInfo = info;
        this.newVersion = info.version;
        this.sendEvent({ type: "update-available", info });
      })
      .on("update-downloaded", () => {
        this.updateDownloaded = true;
        this.sendEvent({ type: "update-downloaded" });

        if (!this.hasNotified) {
          this.hasNotified = true;
          publishNotificationUpdateReadyToInstall(this.newVersion);
        }
      })
      .on("update-not-available", () => {
        logger.log(`[updater] in-app check: up to date (v${app.getVersion()})`);
      })
      .on("error", (err: Error) => {
        // Log instead of swallowing — a periodic check that silently errors is
        // why updates appeared to never arrive.
        logger.error("[updater] in-app check error:", err);
      });

    const isAutoInstallAvailable = await this.isAutoInstallEnabled();

    // Re-emit cached events so the renderer never misses them due to timing
    if (this.pendingUpdateInfo) {
      this.sendEvent({
        type: "update-available",
        info: this.pendingUpdateInfo,
      });
    }
    if (this.updateDownloaded) {
      this.sendEvent({ type: "update-downloaded" });
    }

    if (app.isPackaged) {
      autoUpdater.autoDownload = isAutoInstallAvailable;
      autoUpdater.checkForUpdates().then((result) => {
        logger.log(`Check for updates result: ${result}`);
      });
    } else if (sendEventsForDebug) {
      this.mockValuesForDebug();
    }

    return isAutoInstallAvailable;
  }
}
