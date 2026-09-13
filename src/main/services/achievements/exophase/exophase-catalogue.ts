import { HydraApi } from "@main/services";
import { achievementsLogger } from "@main/services/logger";
import type { GameShop } from "@types";
import {
  normalizeCatalogueMatchTitle,
  selectBestCatalogueMatch,
} from "./catalogue-title-match";

export interface CatalogueEntry {
  objectId: string;
  title: string;
  shop: GameShop;
}

const SEARCH_CACHE_TTL_MS = 10 * 60_000;
const SEARCH_RETRY_DELAY_MS = 175;
const catalogueSearchCache = new Map<
  string,
  { expiresAt: number; promise: Promise<CatalogueEntry | null> }
>();

/**
 * Search the Hydra API catalogue for a game by title. Results are ranked with
 * conservative edition/store-suffix handling and cached briefly so the full
 * maintenance pass never repeats the same network lookup.
 */
export function searchCatalogueForAchievements(
  title: string
): Promise<CatalogueEntry | null> {
  const cacheKey = normalizeCatalogueMatchTitle(title);
  const cached = catalogueSearchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const promise = searchCatalogueForAchievementsUncached(title)
    .catch(async (firstError) => {
      achievementsLogger.warn(
        `[Catalogue] first lookup failed for "${title}"; retrying once`,
        firstError
      );
      await new Promise((resolve) =>
        setTimeout(resolve, SEARCH_RETRY_DELAY_MS)
      );
      return searchCatalogueForAchievementsUncached(title);
    })
    .catch((error) => {
      catalogueSearchCache.delete(cacheKey);
      throw error;
    });
  catalogueSearchCache.set(cacheKey, {
    expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
    promise,
  });
  return promise;
}

async function searchCatalogueForAchievementsUncached(
  title: string
): Promise<CatalogueEntry | null> {
  achievementsLogger.log(`[Catalogue] searching for "${title}"…`);
  const response = await HydraApi.post<{
    edges: CatalogueEntry[];
    count: number;
  }>(
    "/catalogue/search",
    {
      title,
      sortBy: "popularity",
      sortOrder: "desc",
      downloadSourceFingerprints: [],
      tags: [],
      publishers: [],
      genres: [],
      developers: [],
      protondbSupportBadges: [],
      deckCompatibility: [],
      // Exact older/niche games can land well below popularity-ranked
      // sequels. The live catalogue puts Football Manager 2021 Touch at the
      // 26th result, so 25 still produced a false "catalogue not found".
      take: 50,
      skip: 0,
    },
    { needsAuth: false }
  );

  const edges = response?.edges ?? [];
  const match = selectBestCatalogueMatch(title, edges);
  if (match) {
    achievementsLogger.log(
      `[Catalogue] match: "${title}" → ${match.shop}:${match.objectId} ("${match.title}")`
    );
    return match;
  }

  achievementsLogger.log(
    `[Catalogue] no safe match for "${title}" (${edges.length} candidates inspected, ${response?.count ?? edges.length} reported)`
  );
  return null;
}
