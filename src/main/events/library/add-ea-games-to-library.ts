import { registerEvent } from "../register-event";
import { gamesSublevel, gamesShopAssetsSublevel, levelKeys } from "@main/level";
import { detectInstalledEaGames, getEaLaunchUri } from "@main/services/ea";
import { createGame } from "@main/services/library-sync";
import { logger } from "@main/services";
import { fetchBestAssets } from "@main/helpers/fetch-best-assets";
import { deduplicateTitle } from "@main/helpers/deduplicate-title";
import { getExcludedGames, isGameExcluded } from "@main/helpers/exclusion-list";

/** Offer ids contain characters unsafe for level keys ("OFB-EAST:123") —
 * use a sanitized id, falling back to a slug of the title. */
const toObjectId = (offerId: string | null, title: string): string =>
  (offerId ?? title).replace(/[^a-zA-Z0-9._-]+/g, "-").toLowerCase();

const addEaGamesToLibrary = async (
  _event: Electron.IpcMainInvokeEvent,
  titles: string[]
) => {
  const detected = await detectInstalledEaGames();
  const excludedGames = await getExcludedGames();
  let added = 0;

  for (const title of titles) {
    const def = detected.find((g) => g.title === title);
    if (!def) continue;

    const objectId = toObjectId(def.offerId, def.title);

    if (isGameExcluded(excludedGames, "ea", objectId, def.title)) continue;

    const gameKey = levelKeys.game("ea", objectId);

    const existing = await gamesSublevel.get(gameKey).catch(() => null);
    if (existing && !existing.isDeleted) continue;

    const assets = await fetchBestAssets("ea", objectId, def.title, {});

    const game = {
      title: def.title,
      iconUrl: assets.iconUrl,
      libraryHeroImageUrl: assets.libraryHeroImageUrl,
      logoImageUrl: assets.logoImageUrl,
      objectId,
      shop: "ea" as const,
      remoteId: null,
      isDeleted: false,
      playTimeInMilliseconds: 0,
      lastTimePlayed: null,
      addedToLibraryAt: new Date(),
      automaticCloudSync: true,
      libraryOrigin: "sync" as const,
      executablePath: getEaLaunchUri(def),
    };

    await gamesSublevel.put(gameKey, game);
    await gamesShopAssetsSublevel
      .put(gameKey, {
        objectId,
        shop: "ea" as const,
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

  logger.log(`EA app: ${added} games added to library`);
  return { added };
};

registerEvent("addEaGamesToLibrary", addEaGamesToLibrary);
