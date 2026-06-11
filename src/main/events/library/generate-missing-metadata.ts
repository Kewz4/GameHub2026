import { registerEvent } from "../register-event";
import { gamesSublevel, gamesShopAssetsSublevel, levelKeys } from "@main/level";
import { fetchBestAssets } from "@main/helpers/fetch-best-assets";
import { logger, WindowManager } from "@main/services";

export interface MetadataGameResult {
  title: string;
  coverUrl: string | null;
  what: string;
}

const generateMissingMetadata = async (
  _event: Electron.IpcMainInvokeEvent
): Promise<{
  updated: number;
  skipped: number;
  results: MetadataGameResult[];
}> => {
  const allGames = await gamesSublevel.values().all();
  const games = allGames.filter((g) => !g.isDeleted);

  let updated = 0;
  let skipped = 0;
  const total = games.length;
  let current = 0;
  const results: MetadataGameResult[] = [];

  WindowManager.sendToAppWindows("on-metadata-progress", {
    current,
    total,
    title: null,
  });

  for (const game of games) {
    current++;
    WindowManager.sendToAppWindows("on-metadata-progress", {
      current,
      total,
      title: game.title,
    });
    const cacheKey = levelKeys.game(game.shop, game.objectId);
    const assets = await gamesShopAssetsSublevel
      .get(cacheKey)
      .catch(() => null);

    // Only skip if we have an actual cover or hero image — icon alone is not sufficient
    const hasCover = assets?.coverImageUrl || assets?.libraryHeroImageUrl;

    if (hasCover) {
      skipped++;
      continue;
    }

    try {
      const best = await fetchBestAssets(game.shop, game.objectId, game.title, {
        iconUrl: assets?.iconUrl ?? null,
        coverImageUrl: assets?.coverImageUrl ?? null,
        libraryImageUrl: assets?.libraryImageUrl ?? null,
        libraryHeroImageUrl: assets?.libraryHeroImageUrl ?? null,
        logoImageUrl: assets?.logoImageUrl ?? null,
        logoPosition: assets?.logoPosition ?? null,
        downloadSources: assets?.downloadSources ?? [],
      });

      await gamesShopAssetsSublevel.put(cacheKey, {
        ...(assets ?? {}),
        objectId: game.objectId,
        shop: game.shop,
        title: game.title,
        ...best,
        updatedAt: Date.now(),
      });

      const coverUrl =
        best.coverImageUrl ?? best.libraryHeroImageUrl ?? best.iconUrl ?? null;
      const found: string[] = [];
      if (best.coverImageUrl) found.push("cover");
      if (best.libraryHeroImageUrl) found.push("hero image");
      if (best.iconUrl) found.push("icon");
      if (best.logoImageUrl) found.push("logo");

      results.push({
        title: game.title,
        coverUrl,
        what:
          found.length > 0 ? `Found: ${found.join(", ")}` : "Updated metadata",
      });

      updated++;
    } catch (err) {
      logger.warn(`generateMissingMetadata: failed for "${game.title}"`, err);
      skipped++;
    }
  }

  WindowManager.sendToAppWindows("on-metadata-progress", {
    current: total,
    total,
    title: null,
    done: true,
  });
  logger.log(`generateMissingMetadata: ${updated} updated, ${skipped} skipped`);
  return { updated, skipped, results };
};

registerEvent("generateMissingMetadata", generateMissingMetadata);

export const generateMissingMetadataInternal = () =>
  generateMissingMetadata({} as Electron.IpcMainInvokeEvent);
