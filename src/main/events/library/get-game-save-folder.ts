import { registerEvent } from "../register-event";
import type { GameShop } from "@types";
import { Ludusavi, logger } from "@main/services";
import { resolveEmulatorGameSaveFolder } from "@main/services/emulators/emulator-save-dirs";
import { gamesSublevel, gamesShopAssetsSublevel, levelKeys } from "@main/level";
import { createGameSaveFolderResolver } from "@main/services/game-save-folder";

const resolveGameSaveFolder = createGameSaveFolderResolver({
  resolveEmulatorGameSaveFolder,
  getManualSaveMapping: (shop, objectId) =>
    Ludusavi.getManualCustomGame(shop, objectId),
  getGame: (shop, objectId) =>
    gamesSublevel
      .get(levelKeys.game(shop, objectId))
      .then((game) => game ?? null),
  getGameTitleFallback: (shop, objectId) =>
    gamesShopAssetsSublevel
      .get(levelKeys.game(shop, objectId))
      .then((assets) => assets?.title ?? null),
  findManifestSavePaths: (shop, title, objectId, executablePath) =>
    Ludusavi.findSavePathsFast(shop, title, objectId, executablePath),
});

const getGameSaveFolder = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
): Promise<string | null> => {
  try {
    const result = await resolveGameSaveFolder(shop, objectId);
    if (result)
      logger.info(`[getGameSaveFolder] ${shop}:${objectId} → ${result}`);
    else
      logger.info(`[getGameSaveFolder] No save path for ${shop}:${objectId}`);
    return result;
  } catch (error) {
    logger.error("[getGameSaveFolder] Error:", error);
    return null;
  }
};

registerEvent("getGameSaveFolder", getGameSaveFolder);
