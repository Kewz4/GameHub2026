import { registerEvent } from "../register-event";
import { gamesSublevel, gamesShopAssetsSublevel, levelKeys } from "@main/level";
import {
  RIOT_GAMES,
  getRiotClientPath,
  getRiotLaunchOptions,
} from "@main/services/riot";
import { createGame } from "@main/services/library-sync";
import { logger } from "@main/services";
import { fetchBestAssets } from "@main/helpers/fetch-best-assets";
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
    if (existing && !existing.isDeleted) continue;

    const assets = await fetchBestAssets("riot", productId, def.title, {});

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
