import path from "node:path";
import { GameShop } from "@types";
import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import { logger } from "@main/services";
import {
  crackGame,
  detectCrackStatus,
  isCrackToolAvailable,
  ensureCrackConfig,
  type CrackDetection,
  type CrackResult,
} from "@main/services/crack/steam-auto-crack";

const getGameDirectory = async (
  shop: GameShop,
  objectId: string
): Promise<string | null> => {
  const game = await gamesSublevel
    .get(levelKeys.game(shop, objectId))
    .catch(() => null);

  const executablePath = game?.nativeExecutablePath ?? game?.executablePath;
  if (!executablePath) return null;

  // Only local paths point at a real install folder worth cracking.
  if (/^[a-z]+:\/\//i.test(executablePath)) return null;

  const gameDir = path.dirname(executablePath);
  return gameDir;
};

export const getCrackStatus = async (
  _event: Electron.IpcMainInvokeEvent | null,
  shop: GameShop,
  objectId: string
): Promise<CrackDetection | null> => {
  const gameDir = await getGameDirectory(shop, objectId);
  if (!gameDir) {
    return {
      status: "not-installed",
      reason: "Game executable not bound",
    };
  }

  return detectCrackStatus(gameDir);
};

export const crackGameWithSteamAutoCrack = async (
  _event: Electron.IpcMainInvokeEvent | null,
  shop: GameShop,
  objectId: string
): Promise<CrackResult> => {
  const gameDir = await getGameDirectory(shop, objectId);
  if (!gameDir) {
    return {
      success: false,
      exitCode: null,
      output: "Game executable not bound",
    };
  }

  if (!isCrackToolAvailable()) {
    return {
      success: false,
      exitCode: null,
      output: "SteamAutoCrack CLI is not bundled with this build",
    };
  }

  logger.log("Manual crack requested", { shop, objectId, gameDir });
  return crackGame(gameDir, objectId);
};

export const checkCrackToolAvailability = async () => {
  if (!isCrackToolAvailable()) return false;
  return (await ensureCrackConfig()) !== null;
};

registerEvent("getCrackStatus", getCrackStatus);
registerEvent("crackGame", crackGameWithSteamAutoCrack);
registerEvent("checkCrackToolAvailability", checkCrackToolAvailability);
