import { levelKeys, gamesSublevel, gamesShopAssetsSublevel } from "@main/level";
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

  public static async uploadSaveGame(
    objectId: string,
    shop: GameShop,
    downloadOptionTitle: string | null,
    label?: string,
    userId?: string
  ) {
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
        userId: userId ?? "anonymous",
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
