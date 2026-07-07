import {
  db,
  levelKeys,
  gamesSublevel,
  gamesShopAssetsSublevel,
} from "@main/level";
import type { UserPreferences } from "@types";
import path from "node:path";
import * as tar from "tar";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import type { GameShop } from "@types";
import { backupsPath } from "@main/constants";
import { normalizePath, parseRegFile } from "@main/helpers";
import { logger } from "./logger";
import { WindowManager } from "./window-manager";
import { Ludusavi } from "./ludusavi";
import { formatDate } from "@shared";
import { UploadcareSync } from "./uploadcare-sync";
import i18next, { t } from "i18next";
import { SystemPath } from "./system-path";
import { Wine } from "./wine";
import { resolveEmulatorSaveLocation } from "./emulators/emulator-save-dirs";
import { invalidateCachedArtifacts } from "./cloud-artifacts-cache";

export class CloudSync {
  public static getWindowsLikeUserProfilePath(winePrefixPath?: string | null) {
    if (process.platform === "linux") {
      if (!winePrefixPath) {
        throw new Error("Wine prefix path is required");
      }

      const userReg = fs.readFileSync(
        path.join(winePrefixPath, "user.reg"),
        "utf8"
      );

      const entries = parseRegFile(userReg);
      const volatileEnvironment = entries.find(
        (entry) => entry.path === "Volatile Environment"
      );

      if (!volatileEnvironment) {
        throw new Error("Volatile environment not found in user.reg");
      }

      const { values } = volatileEnvironment;
      const userProfile = String(values["USERPROFILE"]);

      if (userProfile) {
        return normalizePath(userProfile);
      } else {
        throw new Error("User profile not found in user.reg");
      }
    }

    return normalizePath(SystemPath.getPath("home"));
  }

  public static getBackupLabel(automatic: boolean) {
    const language = i18next.language;

    const date = formatDate(new Date(), language);

    if (automatic) {
      return t("automatic_backup_from", {
        ns: "game_details",
        date,
      });
    }

    return t("backup_from", {
      ns: "game_details",
      date,
    });
  }

  private static async resolveGameTitle(
    shop: GameShop,
    objectId: string
  ): Promise<string | null> {
    const gameKey = levelKeys.game(shop, objectId);
    const game = await gamesSublevel.get(gameKey).catch(() => null);
    const assets = await gamesShopAssetsSublevel.get(gameKey).catch(() => null);
    return game?.title ?? assets?.title ?? null;
  }

  private static async bundleBackup(
    shop: GameShop,
    objectId: string,
    winePrefix: string | null
  ) {
    const backupPath = path.join(backupsPath, `${shop}-${objectId}`);

    // Remove existing backup
    if (fs.existsSync(backupPath)) {
      try {
        await fs.promises.rm(backupPath, { recursive: true });
      } catch (error) {
        logger.error("Failed to remove backup path", { backupPath, error });
      }
    }

    // Ludusavi's manifest is indexed by game title, not objectId
    const gameTitle = await this.resolveGameTitle(shop, objectId);
    if (!gameTitle) {
      throw new Error(
        `Cannot backup ${shop}:${objectId} — game title not found`
      );
    }

    // Resolve the canonical manifest name (exact-title matching is fragile)
    const canonicalName =
      (await Ludusavi.findCanonicalName(shop, gameTitle, objectId)) ??
      gameTitle;

    // Console/emulated games aren't in Ludusavi's manifest — their saves live in
    // the (portable) emulator's save tree. Register those folders as a Ludusavi
    // custom game keyed by the same name we back up under, so the existing
    // backup → tar → cloud pipeline captures and restores them unchanged.
    try {
      const location = await resolveEmulatorSaveLocation(shop, objectId);
      if (location) {
        await Ludusavi.addCustomGame(canonicalName, location.folders);
      }
    } catch (error) {
      logger.error("Failed to register emulator save folders", {
        shop,
        objectId,
        error,
      });
    }

    await Ludusavi.backupGame(shop, canonicalName, backupPath, winePrefix);

    const tarLocation = path.join(backupsPath, `${crypto.randomUUID()}.tar`);

    await tar.create(
      {
        gzip: false,
        file: tarLocation,
        cwd: backupPath,
      },
      ["."]
    );

    return tarLocation;
  }

  /**
   * The stable per-install cloud-sync user id (created on first use). All
   * upload paths — manual and automatic — must use this so artifacts land
   * under the same user prefix and are visible in the cloud-saves UI.
   */
  public static async getOrCreateUserId(): Promise<string> {
    const prefs = await db
      .get<
        string,
        UserPreferences
      >(levelKeys.userPreferences, { valueEncoding: "json" })
      .catch(() => ({}) as UserPreferences);

    let userId = prefs?.cloudSyncUserId;
    if (!userId) {
      userId = UploadcareSync.generateUserId();
      await db.put(
        levelKeys.userPreferences,
        { ...prefs, cloudSyncUserId: userId },
        { valueEncoding: "json" }
      );
    }
    return userId;
  }

  public static async uploadSaveGame(
    objectId: string,
    shop: GameShop,
    downloadOptionTitle: string | null,
    label?: string,
    userId?: string
  ) {
    // Automatic (watcher-triggered) uploads don't pass a userId — resolve the
    // same stable id manual uploads use, so the artifact is visible in the UI.
    const effectiveUserId = userId ?? (await this.getOrCreateUserId());
    const game = await gamesSublevel.get(levelKeys.game(shop, objectId));
    const effectiveWinePrefixPath = Wine.getEffectivePrefixPath(
      game?.winePrefixPath,
      objectId
    );

    const bundleLocation = await this.bundleBackup(
      shop,
      objectId,
      effectiveWinePrefixPath
    );

    try {
      await UploadcareSync.uploadFile(bundleLocation, {
        userId: effectiveUserId,
        shop,
        objectId,
        ...(game?.title ? { gameName: game.title } : {}),
        hostname: os.hostname(),
        ...(downloadOptionTitle ? { downloadOptionTitle } : {}),
        ...(label ? { label } : {}),
        homeDir: this.getWindowsLikeUserProfilePath(effectiveWinePrefixPath),
        winePrefixPath: effectiveWinePrefixPath
          ? fs.existsSync(effectiveWinePrefixPath)
            ? fs.realpathSync(effectiveWinePrefixPath)
            : effectiveWinePrefixPath
          : "",
        platform: process.platform,
      });

      // Stamp the last cloud save time on the game record
      const gameKey = levelKeys.game(shop, objectId);
      const saved = await gamesSublevel.get(gameKey).catch(() => null);
      if (saved) {
        await gamesSublevel.put(gameKey, {
          ...saved,
          lastCloudSaveAt: new Date(),
        });
      }

      // New artifact exists — drop the cached sidebar list so it recomputes.
      await invalidateCachedArtifacts();

      WindowManager.mainWindow?.webContents.send(
        `on-upload-complete-${objectId}-${shop}`,
        true
      );
    } finally {
      try {
        await fs.promises.unlink(bundleLocation);
      } catch (error) {
        logger.error("Failed to remove tar file", { bundleLocation, error });
      }
    }
  }
}
