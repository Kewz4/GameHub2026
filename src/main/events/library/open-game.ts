import { registerEvent } from "../register-event";
import { shell } from "electron";
import { spawn } from "node:child_process";
import { GameShop } from "@types";
import { launchGame } from "@main/helpers";
import { WindowManager, logger, CloudSync, NativeAddon } from "@main/services";
import { UploadcareSync } from "@main/services/uploadcare-sync";
import { findLegendaryBinary } from "@main/services/legendary";
import { db, gamesSublevel, levelKeys } from "@main/level";
import type { UserPreferences } from "@types";
import { restoreGameArtifact } from "../cloud-save/download-game-artifact";
import { parseExecutablePath } from "../helpers/parse-executable-path";
import { clearCloudSaveLaunchGuard } from "@main/services/cloud-save/launch-guard";
import { prepareAutomaticCloudSaveLaunch } from "@main/services/cloud-save/automatic-sync-lifecycle";
import { runWithCloudSaveLaunchGate } from "@main/services/cloud-save/operation-gate";
import {
  beginExternalGameLaunch,
  clearExternalGameLaunch,
} from "@main/services/external-game-launch-tracker";

const EXTERNAL_URL_SCHEMES = [
  "steam://",
  "goggalaxy://",
  "goglauncher://",
  "com.epicgames.launcher://",
  "battlenet://",
  "msxbox://",
  "riotclient://",
  "uplay://",
  "origin://",
  "origin2://",
  "link2ea://",
];

const beginTrackedExternalLaunch = async (
  shop: GameShop,
  objectId: string,
  protocolUrl: string,
  cloudSaveSessionToken: string | null
) => {
  const gameKey = levelKeys.game(shop, objectId);
  const [game, baselineProcesses] = await Promise.all([
    gamesSublevel.get(gameKey).catch(() => null),
    NativeAddon.listProcesses(),
  ]);

  beginExternalGameLaunch({
    gameKey,
    shop,
    objectId,
    title: game?.title ?? objectId,
    protocolUrl,
    cloudSaveSessionToken,
    baselineProcesses,
    baselineForegroundPid: NativeAddon.getForegroundProcessId(),
  });
};

/**
 * When automatic cloud sync is enabled for a game, pull the newest cloud save
 * down and restore it BEFORE launch. Awaited by openGame so the game can never
 * start ahead of its restored save. Skips (rather than clobbers) when the
 * local machine played more recently than the newest cloud backup.
 */
const restoreLatestLegacyCloudSave = async (
  shop: GameShop,
  objectId: string
): Promise<void> => {
  try {
    const game = await gamesSublevel
      .get(levelKeys.game(shop, objectId))
      .catch(() => null);
    if (!game) return;

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

export const prepareGameCloudSaveLaunch = (
  shop: GameShop,
  objectId: string,
  executablePath?: string,
  launchOptions?: string | null
) =>
  prepareAutomaticCloudSaveLaunch(
    objectId,
    shop,
    () => restoreLatestLegacyCloudSave(shop, objectId),
    executablePath ? { executablePath } : undefined,
    executablePath
      ? { shop, objectId, executablePath, launchOptions }
      : undefined
  );

export const redirectBlockedGameCloudSaveLaunch = async (
  shop: GameShop,
  objectId: string,
  blockReason: "custom-path-approval" | "conflict" | "restore-failed" | null
) => {
  clearCloudSaveLaunchGuard(objectId, shop);
  WindowManager.closeGameLauncherWindow();
  if (!blockReason || blockReason === "restore-failed") return;

  const game = await gamesSublevel
    .get(levelKeys.game(shop, objectId))
    .catch(() => null);
  const searchParams = new URLSearchParams({
    title: game?.title ?? objectId,
    [blockReason === "conflict"
      ? "openCloudSaveConflict"
      : "openCloudSavePathApproval"]: "1",
  });
  WindowManager.redirect(`game/${shop}/${objectId}?${searchParams.toString()}`);
};

export const openGame = async (
  _event: Electron.IpcMainInvokeEvent | null,
  shop: GameShop,
  objectId: string,
  executablePath: string,
  launchOptions?: string | null
) => {
  return runWithCloudSaveLaunchGate(objectId, shop, async () => {
    // Await the selected backend before any branch can spawn the game. The
    // lifecycle router makes legacy and V2 mutually exclusive.
    const preparation = await prepareGameCloudSaveLaunch(
      shop,
      objectId,
      parseExecutablePath(executablePath),
      launchOptions
    );
    if (!preparation.shouldLaunch) {
      await redirectBlockedGameCloudSaveLaunch(
        shop,
        objectId,
        preparation.blockReason
      );
      return;
    }

    try {
      // Handle URL-scheme launchers (Steam, GOG Galaxy, Battle.net)
      if (
        EXTERNAL_URL_SCHEMES.some((scheme) =>
          executablePath.toLowerCase().startsWith(scheme)
        )
      ) {
        await WindowManager.createGameLauncherWindow(shop, objectId);
        // Take the baseline after our own launcher BrowserWindow exists so a
        // freshly-created Electron renderer can never be mistaken for the game.
        await beginTrackedExternalLaunch(
          shop,
          objectId,
          executablePath,
          preparation.sessionToken
        );
        await shell.openExternal(executablePath);
        return;
      }

      // Handle Legendary (Epic Games) launches
      if (executablePath.toLowerCase().startsWith("legendary://run/")) {
        const appName = executablePath.slice("legendary://run/".length);
        const prefs = await db
          .get<string, UserPreferences | null>(levelKeys.userPreferences, {
            valueEncoding: "json",
          })
          .catch(() => null);

        const binary = prefs?.legendaryBinaryPath || findLegendaryBinary();
        if (!binary) {
          clearCloudSaveLaunchGuard(
            objectId,
            shop,
            preparation.sessionToken ?? undefined
          );
          logger.error("legendary binary not found for launch", { appName });
          return;
        }

        await WindowManager.createGameLauncherWindow(shop, objectId);

        await beginTrackedExternalLaunch(
          shop,
          objectId,
          executablePath,
          preparation.sessionToken
        );

        const processRef = spawn(
          binary,
          ["launch", appName, "--skip-version-check"],
          {
            detached: true,
            stdio: "ignore",
          }
        );
        processRef.once("error", (error) => {
          clearExternalGameLaunch(levelKeys.game(shop, objectId));
          clearCloudSaveLaunchGuard(
            objectId,
            shop,
            preparation.sessionToken ?? undefined
          );
          logger.error("legendary launch failed", { appName, error });
        });
        processRef.unref();
        return;
      }

      await launchGame({ shop, objectId, executablePath, launchOptions });
    } catch (error) {
      clearExternalGameLaunch(levelKeys.game(shop, objectId));
      clearCloudSaveLaunchGuard(
        objectId,
        shop,
        preparation.sessionToken ?? undefined
      );
      throw error;
    }
  });
};

registerEvent("openGame", openGame);
