import { registerEvent } from "../register-event";
import type { GameShop } from "@types";
import { Ludusavi, logger } from "@main/services";
import { gamesSublevel, gamesShopAssetsSublevel, levelKeys } from "@main/level";
import path from "node:path";

const getGameSaveFolder = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
): Promise<string | null> => {
  try {
    const gameKey = levelKeys.game(shop, objectId);

    const game = await gamesSublevel.get(gameKey).catch(() => null);
    const assets = await gamesShopAssetsSublevel.get(gameKey).catch(() => null);
    const gameTitle = game?.title ?? assets?.title ?? null;

    if (!gameTitle) {
      logger.warn(
        `[getGameSaveFolder] No title for ${shop}:${objectId}`
      );
      return null;
    }

    // Fast path: read manifest.yaml directly (no ludusavi binary unless title
    // doesn't match exactly). Returns only fully-expanded paths.
    const paths = await Ludusavi.findSavePathsFast(shop, gameTitle, objectId);

    if (paths.length > 0) {
      const first = paths[0];
      return first.endsWith(path.sep) || first.endsWith("/")
        ? first.replace(/[/\\]+$/, "")
        : path.dirname(first);
    }

    logger.info(
      `[getGameSaveFolder] No expanded save path found for ${shop}:${objectId}`
    );
    return null;
  } catch (error) {
    logger.error("[getGameSaveFolder] Error:", error);
    return null;
  }
};

registerEvent("getGameSaveFolder", getGameSaveFolder);
