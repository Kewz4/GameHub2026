import path from "node:path";
import { GameShop } from "@types";
import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import { logger } from "@main/services";
import {
  applySteamEmulator,
  detectSteamEmulatorStatus,
  isEmulatorToolAvailable,
  ensureEmulatorToolConfig,
  isOfflinePlaySetupEligible,
  type SteamEmulatorDetection,
  type SteamEmulatorResult,
} from "@main/services/steam-emulator/steam-emulator";

const getGameDirectory = async (
  shop: GameShop,
  objectId: string
): Promise<string | null> => {
  const game = await gamesSublevel
    .get(levelKeys.game(shop, objectId))
    .catch(() => null);

  const executablePath = game?.nativeExecutablePath ?? game?.executablePath;
  if (!executablePath) return null;

  // Only local paths point at a real install folder worth setting up.
  if (/^[a-z]+:\/\//i.test(executablePath)) return null;

  const gameDir = path.dirname(executablePath);
  return gameDir;
};

export const getSteamEmulatorStatus = async (
  _event: Electron.IpcMainInvokeEvent | null,
  shop: GameShop,
  objectId: string
): Promise<SteamEmulatorDetection | null> => {
  const gameDir = await getGameDirectory(shop, objectId);
  if (!gameDir) {
    return {
      status: "not-installed",
      reason: "Game executable not bound",
    };
  }

  return detectSteamEmulatorStatus(gameDir);
};

export const applySteamEmulatorToGame = async (
  _event: Electron.IpcMainInvokeEvent | null,
  shop: GameShop,
  objectId: string
): Promise<SteamEmulatorResult> => {
  const game = await gamesSublevel
    .get(levelKeys.game(shop, objectId))
    .catch(() => null);

  // Offline-play setup is only for manually added games (custom games and
  // repacks). Platform-synced games are owned installs and must never be
  // modified.
  if (game && !isOfflinePlaySetupEligible(game)) {
    return {
      success: false,
      exitCode: null,
      output: "Library-synced games are not eligible for offline-play setup",
    };
  }

  const gameDir = await getGameDirectory(shop, objectId);
  if (!gameDir) {
    return {
      success: false,
      exitCode: null,
      output: "Game executable not bound",
    };
  }

  if (!isEmulatorToolAvailable()) {
    return {
      success: false,
      exitCode: null,
      output: "Steam emulator CLI is not bundled with this build",
    };
  }

  logger.log("Manual offline-play setup requested", {
    shop,
    objectId,
    gameDir,
  });
  return applySteamEmulator(gameDir, objectId);
};

export const checkSteamEmulatorToolAvailability = async () => {
  if (!isEmulatorToolAvailable()) return false;
  return (await ensureEmulatorToolConfig()) !== null;
};

registerEvent("getSteamEmulatorStatus", getSteamEmulatorStatus);
registerEvent("applySteamEmulator", applySteamEmulatorToGame);
registerEvent(
  "checkSteamEmulatorToolAvailability",
  checkSteamEmulatorToolAvailability
);
