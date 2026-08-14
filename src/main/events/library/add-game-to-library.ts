import { registerEvent } from "../register-event";
import type { GameShop } from "@types";
import { createGame } from "@main/services/library-sync";
import { gamesShopAssetsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { clearFinishedDownload } from "@main/helpers";
import { AchievementWatcherManager } from "@main/services/achievements/achievement-watcher-manager";
import {
  findPlayniteCacheEntryForGame,
  removePlayniteCacheEntriesForGame,
} from "@main/services/playnite-playtime-cache";
import { decidePlaynitePlaytimeImport } from "@main/services/playnite-playtime-policy";

const addGameToLibrary = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  title: string
) => {
  const gameKey = levelKeys.game(shop, objectId);
  let game = await gamesSublevel.get(gameKey);

  const gameAssets = await gamesShopAssetsSublevel.get(gameKey);

  // Apply any Playnite-imported playtime cached for this game (cached when the
  // user ran a Playnite import while the game was NOT yet in their library).
  const playniteIdentity = { shop, objectId, title };
  const cachedPlaytimeRecord =
    await findPlayniteCacheEntryForGame(playniteIdentity);
  const cachedPlaytime = cachedPlaytimeRecord?.[1] ?? null;

  if (game) {
    await clearFinishedDownload(shop, objectId);

    game.isDeleted = false;
    game.addedToLibraryAt ??= new Date();
    game.libraryOrigin ??= "catalog";

    if (cachedPlaytime) {
      const decision = decidePlaynitePlaytimeImport(
        game.playTimeInMilliseconds,
        cachedPlaytime.playTimeInMilliseconds
      );
      if (decision.action === "replace") {
        game.playTimeInMilliseconds = decision.nextPlaytimeMs;
        game.hasManuallyUpdatedPlaytime = true;
        game.unsyncedDeltaPlayTimeInMilliseconds = 0;
        game.pendingAbsolutePlayTimeInMilliseconds = decision.nextPlaytimeMs;
      }
    }

    await gamesSublevel.put(gameKey, game);
  } else {
    game = {
      title,
      iconUrl: gameAssets?.iconUrl ?? null,
      libraryHeroImageUrl: gameAssets?.libraryHeroImageUrl ?? null,
      logoImageUrl: gameAssets?.logoImageUrl ?? null,
      objectId,
      shop,
      remoteId: null,
      isDeleted: false,
      playTimeInMilliseconds: cachedPlaytime?.playTimeInMilliseconds ?? 0,
      pendingAbsolutePlayTimeInMilliseconds: cachedPlaytime
        ? cachedPlaytime.playTimeInMilliseconds
        : null,
      lastTimePlayed: null,
      addedToLibraryAt: new Date(),
      automaticCloudSync: true,
      libraryOrigin: "catalog" as const,
    };

    await gamesSublevel.put(gameKey, game);
  }

  // The cached playtime has now been applied to the real library record.
  if (cachedPlaytime) {
    await removePlayniteCacheEntriesForGame(playniteIdentity);
  }

  if (game) {
    await createGame(game).catch(() => {});

    AchievementWatcherManager.firstSyncWithRemoteIfNeeded(
      game.shop,
      game.objectId
    );
  }
};

registerEvent("addGameToLibrary", addGameToLibrary);
