import { registerEvent } from "../register-event";
import { gamesSublevel, gamesShopAssetsSublevel, levelKeys } from "@main/level";
import {
  RIOT_GAMES,
  getRiotClientPath,
  getRiotLaunchOptions,
} from "@main/services/riot";
import { createGame } from "@main/services/library-sync";
import { logger } from "@main/services";
import { getSteamGridDbArtwork } from "@main/services/steamgriddb";
import { getExcludedGames, isGameExcluded } from "@main/helpers/exclusion-list";

const addRiotGamesToLibrary = async (
  _event: Electron.IpcMainInvokeEvent,
  productIds: string[]
) => {
  const clientPath = getRiotClientPath();
  const excludedGames = await getExcludedGames();
  let added = 0;

  for (const productId of productIds) {
    const def = RIOT_GAMES.find((g) => g.productId === productId);
    if (!def) continue;

    if (isGameExcluded(excludedGames, "riot", productId, def.title)) continue;

    const gameKey = levelKeys.game("riot", productId);

    const existing = await gamesSublevel.get(gameKey).catch(() => null);

    // Riot games are not on Steam and the Hydra API rejects the `riot` shop
    // type, while catalogue title-search returns wrong games (LoR → Minecraft
    // Legends). Go straight to SteamGridDB, which has exact-title entries for
    // every Riot title.
    const sgdb = await getSteamGridDbArtwork(def.title).catch(() => null);
    const assets = {
      iconUrl: sgdb?.gridUrl ?? null,
      coverImageUrl: sgdb?.gridUrl ?? null,
      libraryImageUrl: sgdb?.wideGridUrl ?? null,
      libraryHeroImageUrl: sgdb?.heroUrl ?? null,
      logoImageUrl: sgdb?.logoUrl ?? null,
      logoPosition: null,
      downloadSources: [] as string[],
    };

    // Re-adding an existing entry repairs any previously wrong metadata
    if (existing && !existing.isDeleted) {
      await gamesSublevel.put(gameKey, {
        ...existing,
        title: def.title,
        iconUrl: assets.iconUrl ?? existing.iconUrl,
        libraryHeroImageUrl:
          assets.libraryHeroImageUrl ?? existing.libraryHeroImageUrl,
        logoImageUrl: assets.logoImageUrl ?? existing.logoImageUrl,
        executablePath: clientPath ?? existing.executablePath,
        launchOptions: getRiotLaunchOptions(def),
      });
      await gamesShopAssetsSublevel
        .put(gameKey, {
          objectId: productId,
          shop: "riot" as const,
          title: def.title,
          iconUrl: assets.iconUrl,
          coverImageUrl: assets.coverImageUrl,
          libraryImageUrl: assets.libraryImageUrl,
          libraryHeroImageUrl: assets.libraryHeroImageUrl,
          logoImageUrl: assets.logoImageUrl,
          logoPosition: assets.logoPosition,
          downloadSources: assets.downloadSources ?? [],
          updatedAt: Date.now(),
        })
        .catch(() => {});
      continue;
    }

    const game = {
      title: def.title,
      iconUrl: assets.iconUrl,
      libraryHeroImageUrl: assets.libraryHeroImageUrl,
      logoImageUrl: assets.logoImageUrl,
      objectId: productId,
      shop: "riot" as const,
      remoteId: null,
      isDeleted: false,
      playTimeInMilliseconds: 0,
      lastTimePlayed: null,
      addedToLibraryAt: new Date(),
      automaticCloudSync: true,
      libraryOrigin: "sync" as const,
      executablePath: clientPath,
      launchOptions: getRiotLaunchOptions(def),
    };

    await gamesSublevel.put(gameKey, game);
    await gamesShopAssetsSublevel
      .put(gameKey, {
        objectId: productId,
        shop: "riot" as const,
        title: def.title,
        iconUrl: assets.iconUrl,
        coverImageUrl: assets.coverImageUrl,
        libraryImageUrl: assets.libraryImageUrl,
        libraryHeroImageUrl: assets.libraryHeroImageUrl,
        logoImageUrl: assets.logoImageUrl,
        logoPosition: assets.logoPosition,
        downloadSources: assets.downloadSources ?? [],
        updatedAt: Date.now(),
      })
      .catch(() => {});
    await createGame(game).catch(() => {});
    added++;
  }

  logger.log(`Riot Games: ${added} games added to library`);
  return { added };
};

registerEvent("addRiotGamesToLibrary", addRiotGamesToLibrary);
