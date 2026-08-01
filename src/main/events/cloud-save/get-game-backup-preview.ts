import { registerEvent } from "../register-event";
import type { GameShop } from "@types";
import { getSaveBackupPreview, Wine } from "@main/services";
import { gamesSublevel, levelKeys } from "@main/level";

const getGameBackupPreview = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop
) => {
  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey).catch(() => null);
  const winePrefix = Wine.getEffectivePrefixPath(
    game?.winePrefixPath,
    objectId
  );

  return getSaveBackupPreview(shop, objectId, winePrefix);
};

registerEvent("getGameBackupPreview", getGameBackupPreview);
