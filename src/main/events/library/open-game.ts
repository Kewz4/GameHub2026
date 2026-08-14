import { registerEvent } from "../register-event";
import { shell } from "electron";
import { spawn } from "node:child_process";
import { GameShop } from "@types";
import { launchGame } from "@main/helpers";
import { WindowManager, logger, NativeAddon } from "@main/services";
import { findLegendaryBinary } from "@main/services/legendary";
import { db, gamesSublevel, levelKeys } from "@main/level";
import type { UserPreferences } from "@types";
import { parseExecutablePath } from "../helpers/parse-executable-path";
import {
  clearCloudSaveLaunchGuard,
  clearPendingCloudSaveLaunchSession,
} from "@main/services/cloud-save/launch-guard";
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

// shell.openPath can report success even when a game immediately crashes
// before the two-second process watcher observes it. Do not let that abandoned
// attempt reserve Cloud Saves V2 forever and block every later launch/sync.
const LOCAL_LAUNCH_DETECTION_TIMEOUT_MS = 30_000;

const schedulePendingLocalLaunchExpiry = (
  shop: GameShop,
  objectId: string,
  sessionToken: string | null
) => {
  if (!sessionToken) return;
  const timer = setTimeout(() => {
    if (!clearPendingCloudSaveLaunchSession(objectId, shop, sessionToken)) {
      return;
    }
    WindowManager.closeGameLauncherWindow();
    logger.warn("Game process did not appear after launch", {
      shop,
      objectId,
      timeoutMs: LOCAL_LAUNCH_DETECTION_TIMEOUT_MS,
    });
  }, LOCAL_LAUNCH_DETECTION_TIMEOUT_MS);
  timer.unref();
};

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

export const prepareGameCloudSaveLaunch = (
  shop: GameShop,
  objectId: string,
  executablePath?: string,
  launchOptions?: string | null
) =>
  prepareAutomaticCloudSaveLaunch(
    objectId,
    shop,
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
    // Await V2 preparation before any branch can spawn the game.
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
      schedulePendingLocalLaunchExpiry(
        shop,
        objectId,
        preparation.sessionToken
      );
    } catch (error) {
      clearExternalGameLaunch(levelKeys.game(shop, objectId));
      clearCloudSaveLaunchGuard(
        objectId,
        shop,
        preparation.sessionToken ?? undefined
      );
      WindowManager.closeGameLauncherWindow();
      logger.error("Game launch failed", {
        shop,
        objectId,
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: error instanceof Error ? error.message : String(error),
        errorCode:
          error && typeof error === "object" && "code" in error
            ? error.code
            : undefined,
      });
      throw error;
    }
  });
};

registerEvent("openGame", openGame);
