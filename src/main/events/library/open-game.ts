import { registerEvent } from "../register-event";
import { shell } from "electron";
import { spawn } from "node:child_process";
import { GameShop } from "@types";
import { launchGame } from "@main/helpers";
import { WindowManager, logger } from "@main/services";
import { findLegendaryBinary } from "@main/services/legendary";
import { db, levelKeys } from "@main/level";
import type { UserPreferences } from "@types";

const EXTERNAL_URL_SCHEMES = [
  "steam://",
  "goggalaxy://",
  "battlenet://",
  "msxbox://",
  "uplay://",
  "origin://",
  "origin2://",
];

const openGame = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  executablePath: string,
  launchOptions?: string | null
) => {
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
