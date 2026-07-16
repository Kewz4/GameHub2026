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
import {
  resolveEmulatorBackupFolders,
  fingerprintSaveFolders,
} from "./emulators/emulator-save-dirs";
import { invalidateCachedArtifacts } from "./cloud-artifacts-cache";

/** Upload guardrails — a single game's save should never exceed these. */
const MAX_SAVE_FILES = 50;
const MAX_SAVE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

export class CloudSync {
  /** Recursively total the file count and bytes of a backup directory. */
  private static measureBackup(dir: string): {
    fileCount: number;
    totalBytes: number;
  } {
    let fileCount = 0;
    let totalBytes = 0;
    const walk = (current: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile()) {
          // The mapping.yaml + drive metadata aren't user save files; count
          // only the actual backed-up payload.
          if (entry.name === "mapping.yaml") continue;
          fileCount += 1;
          try {
            totalBytes += fs.statSync(full).size;
          } catch {
            /* ignore unreadable entries */
          }
        }
      }
    };
    walk(dir);
    return { fileCount, totalBytes };
  }

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
      const folders = await resolveEmulatorBackupFolders(shop, objectId);
      if (folders.length > 0) {
        await Ludusavi.addCustomGame(canonicalName, folders);
      }
    } catch (error) {
      logger.error("Failed to register emulator save folders", {
        shop,
        objectId,
        error,
      });
    }

    await Ludusavi.backupGame(shop, canonicalName, backupPath, winePrefix);

    // Guardrails (adopted from PR #2538): a mis-scoped save folder — e.g. an
    // emulator save dir pointed at something huge — shouldn't balloon into an
    // unbounded upload. Abort loudly before tarring if the backup blows past
    // the caps rather than silently pushing gigabytes to the cloud.
    const { fileCount, totalBytes } = CloudSync.measureBackup(backupPath);
    if (fileCount > MAX_SAVE_FILES || totalBytes > MAX_SAVE_BYTES) {
      throw new Error(
        `Refusing to upload ${shop}:${objectId} — save is too large ` +
          `(${fileCount} files, ${(totalBytes / 1024 / 1024).toFixed(0)} MB; ` +
          `limits ${MAX_SAVE_FILES} files / ${MAX_SAVE_BYTES / 1024 / 1024} MB). ` +
          `Check the game's save-folder configuration.`
      );
    }

    const tarLocation = path.join(backupsPath, `${crypto.randomUUID()}.tar`);

    // Fast gzip (level 1): save data compresses well, so uploads shrink
    // several-fold for near-zero CPU cost. Restore is unaffected — tar.x
    // auto-detects gzip, and older plain-tar artifacts still extract fine.
    await tar.create(
      {
        gzip: { level: 1 },
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

  /**
   * Automatic (close-triggered) upload with a change check: for emulated games
   * whose save folders we can resolve, a cheap fingerprint (file count + bytes
   * + newest mtime) is compared against the last uploaded one — when nothing
   * changed, the entire backup pipeline (ludusavi scan → copy → tar → upload)
   * is skipped, making the common "closed without new progress" case instant.
   * PC games (no resolvable folder set pre-ludusavi) always upload, as before.
   */
  public static async uploadSaveGameIfChanged(
    objectId: string,
    shop: GameShop,
    label?: string
  ) {
    const gameKey = levelKeys.game(shop, objectId);
    const game = await gamesSublevel.get(gameKey).catch(() => null);

    let fingerprint: string | null = null;
    try {
      const folders = await resolveEmulatorBackupFolders(shop, objectId);
      if (folders.length > 0) {
        fingerprint = fingerprintSaveFolders(folders);
        if (fingerprint && fingerprint === game?.lastCloudSaveFingerprint) {
          logger.info(
            `[cloud-sync] skipping automatic backup for ${shop}:${objectId} — saves unchanged`
          );
          return;
        }
      }
    } catch {
      /* fingerprinting is best-effort — fall through to a normal upload */
    }

    await this.uploadSaveGame(objectId, shop, null, label);

    if (fingerprint) {
      const saved = await gamesSublevel.get(gameKey).catch(() => null);
      if (saved) {
        await gamesSublevel.put(gameKey, {
          ...saved,
          lastCloudSaveFingerprint: fingerprint,
        });
      }
    }
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
