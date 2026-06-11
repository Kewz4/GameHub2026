import { UploadcareSync } from "@main/services/uploadcare-sync";
import { registerEvent } from "../register-event";
import {
  db,
  gamesShopAssetsSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import type { GameShop, UserPreferences } from "@types";

const getGameArtifacts = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop
) => {
  const prefs = await db
    .get<
      string,
      UserPreferences
    >(levelKeys.userPreferences, { valueEncoding: "json" })
    .catch(() => ({}) as UserPreferences);

  const userId = prefs?.cloudSyncUserId ?? "anonymous";

  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey).catch(() => null);
  const assets = await gamesShopAssetsSublevel.get(gameKey).catch(() => null);
  const gameTitle = game?.title ?? assets?.title ?? null;

  return UploadcareSync.listArtifacts(userId, shop, objectId, gameTitle);
};

registerEvent("getGameArtifacts", getGameArtifacts);
