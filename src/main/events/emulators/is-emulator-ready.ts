import { existsSync } from "node:fs";
import type { GameShop } from "@types";
import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import { getEmulatorConfig } from "@main/services/emulators/emulators-repository";
import { platformToSystem, systemFromObjectId } from "@main/helpers";

/**
 * True when the emulator for a console (launchbox) game is installed and its
 * executable still exists on disk. The renderer uses this to show "Set up the
 * emulator" instead of a "Play" button that would fail for a downloaded ROM
 * whose emulator isn't ready yet. Returns false for non-launchbox games.
 */
const isEmulatorReady = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
): Promise<boolean> => {
  try {
    if (shop !== "launchbox") return false;

    const game = await gamesSublevel
      .get(levelKeys.game(shop, objectId))
      .catch(() => null);

    const system =
      systemFromObjectId(objectId) ?? platformToSystem(game?.platform);
    if (!system) return false;

    const config = await getEmulatorConfig(system);
    return Boolean(config.executablePath && existsSync(config.executablePath));
  } catch {
    return false;
  }
};

registerEvent("isEmulatorReady", isEmulatorReady);
