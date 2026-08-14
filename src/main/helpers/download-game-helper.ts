import {
  downloadsSublevel,
  gamesShopAssetsSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import type { GameShop } from "@types";
import { DownloadOrchestrator } from "@main/services/download-orchestrator";
import { discardDownloadEntryIfSafe } from "@main/services/download/download-entry-retention";

interface PrepareGameEntryParams {
  gameKey: string;
  title: string;
  objectId: string;
  shop: GameShop;
  libraryOrigin?: "sync" | "catalog" | "custom";
}

export const clearFinishedDownload = async (
  shop: GameShop,
  objectId: string
): Promise<void> => {
  const downloadKey = levelKeys.game(shop, objectId);

  await discardDownloadEntryIfSafe(
    downloadKey,
    { shop, objectId },
    {
      read: (key) => downloadsSublevel.get(key),
      remove: async (key) => {
        await downloadsSublevel.del(key).catch(() => {});
      },
      afterRemove: (identity) =>
        DownloadOrchestrator.syncAfterDownloadRemoved(identity).catch(() => {}),
    }
  );
};

export const prepareGameEntry = async ({
  gameKey,
  title,
  objectId,
  shop,
  libraryOrigin,
}: PrepareGameEntryParams): Promise<void> => {
  const game = await gamesSublevel.get(gameKey);
  const gameAssets = await gamesShopAssetsSublevel.get(gameKey);

  if (game) {
    await gamesSublevel.put(gameKey, {
      ...game,
      isDeleted: false,
      libraryOrigin: game.libraryOrigin ?? libraryOrigin,
    });
  } else {
    await gamesSublevel.put(gameKey, {
      title,
      iconUrl: gameAssets?.iconUrl ?? null,
      libraryHeroImageUrl: gameAssets?.libraryHeroImageUrl ?? null,
      logoImageUrl: gameAssets?.logoImageUrl ?? null,
      objectId,
      shop,
      remoteId: null,
      playTimeInMilliseconds: 0,
      lastTimePlayed: null,
      addedToLibraryAt: new Date(),
      isDeleted: false,
      libraryOrigin,
    });
  }

  // Apply any cached Exophase achievements for this freshly-added repack.
  void import("@main/services/achievements/exophase")
    .then((m) => m.applyCacheToLibrary())
    .catch(() => {});
};
