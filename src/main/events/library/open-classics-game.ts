import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import { emulators, logger } from "@main/services";
import { existsSync } from "node:fs";
import type { EmulatorSystem, GameShop } from "@types";
import { launchClassicsGame } from "@main/helpers/launch-classics-game";

const codedLaunchError = (code: string, message: string, context?: unknown) => {
  const err = new Error(message) as Error & { code: string; context: unknown };
  err.code = code;
  err.context = context;
  logger.error(message, context);
  return err;
};

const openClassicsGame = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop,
  discPath: string,
  system: EmulatorSystem
) => {
  const key = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(key).catch(() => null);
  if (!game) throw codedLaunchError("GAME_NOT_FOUND", `Game not found: ${objectId}`);

  if (!existsSync(discPath)) {
    throw codedLaunchError("DISC_NOT_FOUND", `Disc not found: ${discPath}`, { discPath });
  }

  const config = await emulators.getEmulatorConfig(system);
  if (!config.executablePath || !existsSync(config.executablePath)) {
    throw codedLaunchError(
      "EMULATOR_NOT_CONFIGURED",
      `Emulator not configured for ${system}`,
      { system }
    );
  }

  await launchClassicsGame({ shop: game.shop, objectId, discPath, system });
};

registerEvent("openClassicsGame", openClassicsGame);
