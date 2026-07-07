import { registerEvent } from "../register-event";
import { shell } from "electron";
import { spawn } from "node:child_process";
import { GameShop } from "@types";
import { launchGame } from "@main/helpers";
import { WindowManager, logger, CloudSync } from "@main/services";
import { UploadcareSync } from "@main/services/uploadcare-sync";
import { findLegendaryBinary } from "@main/services/legendary";
import { db, gamesSublevel, levelKeys } from "@main/level";
import type { UserPreferences } from "@types";
import { restoreGameArtifact } from "../cloud-save/download-game-artifact";

const EXTERNAL_URL_SCHEMES = [
  "steam://",
  "goggalaxy://",
  "battlenet://",
  "msxbox://",
  "uplay://",
  "origin://",
  "origin2://",
];

/**
 * When automatic cloud sync is enabled for a game, pull the newest cloud save
 * down and restore it BEFORE launch. Awaited by openGame so the game can never
 * start ahead of its restored save. Skips (rather than clobbers) when the
 * local machine played more recently than the newest cloud backup.
 */
const restoreLatestCloudSave = async (
  shop: GameShop,
  objectId: string
): Promise<void> => {
  try {
    const game = await gamesSublevel
      .get(levelKeys.game(shop, objectId))
      .catch(() => null);
    if (!game?.automaticCloudSync) return;

    const userId = await CloudSync.getOrCreateUserId();
    const artifacts = await UploadcareSync.listArtifacts(
      userId,
      shop,
      objectId,
      game.title
    );
    const latest = artifacts[0]; // newest first
    if (!latest) return;

    // If this machine played after the newest cloud backup was made, the local
    // save is at least as new — restoring would roll progress back.
    const artifactTime = new Date(latest.createdAt).getTime();
    const lastPlayed = game.lastTimePlayed
      ? new Date(game.lastTimePlayed).getTime()
      : 0;
    if (lastPlayed > artifactTime) {
      logger.info(
        `[cloud-sync] skipping pre-launch restore for ${shop}:${objectId} — local save is newer`
      );
      return;
    }

    logger.info(
      `[cloud-sync] restoring latest cloud save before launch: ${shop}:${objectId}`
    );
    await restoreGameArtifact(objectId, shop, latest.id);
  } catch (err) {
    // Never block a launch on a failed restore — log and continue.
    logger.error("[cloud-sync] pre-launch restore failed", err);
  }
};

const openGame = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  executablePath: string,
  launchOptions?: string | null
) => {
  // Automatic cloud sync: restore the newest cloud save BEFORE any launch
  // branch spawns the game (awaited — no race between restore and launch).
  await restoreLatestCloudSave(shop, objectId);

  // Handle URL-scheme launchers (Steam, GOG Galaxy, Battle.net)
  if (EXTERNAL_URL_SCHEMES.some((s) => executablePath.startsWith(s))) {
    await WindowManager.createGameLauncherWindow(shop, objectId);
    shell.openExternal(executablePath);
    return;
  }

  // Handle Legendary (Epic Games) launches
  if (executablePath.startsWith("legendary://run/")) {
    const appName = executablePath.slice("legendary://run/".length);
    const prefs = await db
      .get<string, UserPreferences | null>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null);

    const binary = prefs?.legendaryBinaryPath || findLegendaryBinary();
    if (!binary) {
      logger.error("legendary binary not found for launch", { appName });
      return;
    }

    await WindowManager.createGameLauncherWindow(shop, objectId);

    spawn(binary, ["launch", appName, "--skip-version-check"], {
      detached: true,
      stdio: "ignore",
    }).unref();
    return;
  }

  await launchGame({ shop, objectId, executablePath, launchOptions });
};

registerEvent("openGame", openGame);
