import { registerEvent } from "../register-event";
import { gamesSublevel, gamesShopAssetsSublevel, levelKeys } from "@main/level";
import { detectInstalledUbisoftGames } from "@main/services/ubisoft";
import { createGame } from "@main/services/library-sync";
import { logger } from "@main/services";
import { fetchBestAssets } from "@main/helpers/fetch-best-assets";
import { deduplicateTitle } from "@main/helpers/deduplicate-title";
import { getExcludedGames, isGameExcluded } from "@main/helpers/exclusion-list";

const addUbisoftGamesToLibrary = async (
  _event: Electron.IpcMainInvokeEvent,
  installIds: string[]
) => {
  const detected = await detectInstalledUbisoftGames();
  const excludedGames = await getExcludedGames();
  let added = 0;

  for (const installId of installIds) {
    const def = detected.find((g) => g.installId === installId);
    if (!def) continue;

    if (isGameExcluded(excludedGames, "ubisoft", installId, def.title)) {
      continue;
    }

    const gameKey = levelKeys.game("ubisoft", installId);

    const existing = await gamesSublevel.get(gameKey).catch(() => null);
    if (existing && !existing.isDeleted) continue;

    const assets = await fetchBestAssets("ubisoft", installId, def.title, {});

    const game = {
      title: def.title,
      iconUrl: assets.iconUrl,
      libraryHeroImageUrl: assets.libraryHeroImageUrl,
      logoImageUrl: assets.logoImageUrl,
      objectId: installId,
      shop: "ubisoft" as const,
      remoteId: null,
      isDeleted: false,
      playTimeInMilliseconds: 0,
      lastTimePlayed: null,
      addedToLibraryAt: new Date(),
      automaticCloudSync: true,
      libraryOrigin: "sync" as const,
      executablePath: def.launchUri,
    };

    await gamesSublevel.put(gameKey, game);
    await gamesShopAssetsSublevel
      .put(gameKey, {
        objectId: installId,
        shop: "ubisoft" as const,
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
    await deduplicateTitle(def.title).catch(() => {});
    added++;
  }

  logger.log(`Ubisoft Connect: ${added} games added to library`);
  return { added };
};

registerEvent("addUbisoftGamesToLibrary", addUbisoftGamesToLibrary);
