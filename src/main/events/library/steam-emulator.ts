import { app } from "electron";
import { GameShop } from "@types";
import { selectGameExecutablePath } from "@main/helpers/game-executable-path";
import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import { logger } from "@main/services";
import {
  applySteamEmulator,
  detectSteamEmulatorStatus,
  isEmulatorToolAvailable,
  ensureEmulatorToolConfig,
  type SteamEmulatorDetection,
  type SteamEmulatorResult,
} from "@main/services/steam-emulator/steam-emulator";
import { resolveSafeSteamEmulatorTarget } from "@main/services/steam-emulator/steam-emulator-target";

const getGameTarget = async (
  shop: GameShop,
  objectId: string
): Promise<
  | {
      gameDir: string;
      game: NonNullable<Awaited<ReturnType<typeof gamesSublevel.get>>>;
    }
  | { reason: string }
> => {
  const game = await gamesSublevel
    .get(levelKeys.game(shop, objectId))
    .catch(() => null);

  if (!game) return { reason: "Game was not found in the library" };
  const executablePath = selectGameExecutablePath(game);
  const target = await resolveSafeSteamEmulatorTarget(game, executablePath, [
    process.resourcesPath,
    app.getAppPath(),
    app.getPath("userData"),
  ]);
  if (!target.ok || !target.gameDir) return { reason: target.reason };
  return { gameDir: target.gameDir, game };
};

export const getSteamEmulatorStatus = async (
  _event: Electron.IpcMainInvokeEvent | null,
  shop: GameShop,
  objectId: string
): Promise<SteamEmulatorDetection | null> => {
  const target = await getGameTarget(shop, objectId);
  if (!("gameDir" in target)) {
    return {
      status: "not-installed",
      reason: target.reason,
    };
  }

  return detectSteamEmulatorStatus(target.gameDir);
};

export const applySteamEmulatorToGame = async (
  _event: Electron.IpcMainInvokeEvent | null,
  shop: GameShop,
  objectId: string
): Promise<SteamEmulatorResult> => {
  const target = await getGameTarget(shop, objectId);
  if (!("gameDir" in target)) {
    return {
      success: false,
      exitCode: null,
      output: target.reason,
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
    gameDir: target.gameDir,
  });
  return applySteamEmulator(target.gameDir, objectId, [
    process.resourcesPath,
    app.getAppPath(),
    app.getPath("userData"),
  ]);
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
