import { useEffect, useState } from "react";
import { orderBy } from "lodash-es";

import type {
  CatalogueSearchResult,
  DownloadSource,
  LibraryGame,
  ShopAssets,
  TrendingGame,
} from "@types";
import { CatalogueCategory } from "@shared";
import { levelDBService } from "@renderer/services/leveldb.service";
import { buildGameDetailsPath, ensureArray } from "@renderer/helpers";
import { buildTasteProfile, rankRecommendations } from "./recommender";

export interface HomeCatalogue {
  featured: TrendingGame[];
  recommended: ShopAssets[];
  hot: ShopAssets[];
  weekly: ShopAssets[];
  achievements: ShopAssets[];
  classics: ShopAssets[];
}

const EMPTY_CATALOGUE: HomeCatalogue = {
  featured: [],
  recommended: [],
  hot: [],
  weekly: [],
  achievements: [],
  classics: [],
};

/**
 * The classics browse endpoint returns `CatalogueSearchResult`, which only
 * carries a subset of `ShopAssets`. We widen it to `ShopAssets` (filling the
 * missing artwork slots with `null`) so the same `<GameCard>` used by every
 * other row can render it without a bespoke card.
 */
const classicsResultToShopAssets = (
  result: CatalogueSearchResult
): ShopAssets => ({
  objectId: result.objectId,
  shop: result.shop,
  title: result.title,
  iconUrl: null,
  libraryHeroImageUrl: null,
  libraryImageUrl: result.libraryImageUrl ?? null,
  logoImageUrl: null,
  logoPosition: null,
  coverImageUrl: null,
  downloadSources: result.downloadSources ?? [],
});

async function getCategory(
  category: CatalogueCategory,
  downloadSourceIds: string[]
): Promise<ShopAssets[]> {
  const response = await window.electron.hydraApi.get<ShopAssets[]>(
    `/catalogue/${category}`,
    {
      params: { take: 24, skip: 0, downloadSourceIds },
      needsAuth: false,
    }
  );

  return ensureArray<ShopAssets>(response, `/catalogue/${category}`);
}

async function getFeatured(language: string): Promise<TrendingGame[]> {
  const response = await window.electron.hydraApi.get<TrendingGame[]>(
    "/catalogue/featured",
    {
      params: { language },
      needsAuth: false,
    }
  );

  return ensureArray<TrendingGame>(response, "/catalogue/featured");
}

/**
 * Derive hero slides from an already-fetched category (Hot/Weekly) when
 * `/catalogue/featured` comes back empty — which it has done repeatedly on this
 * fork's backend. Catalogue list responses reliably carry only `libraryImageUrl`
 * (the cover) — `libraryHeroImageUrl`/`logoImageUrl` are per-game detail-time
 * SteamGridDB fetches and are usually absent here. So we require only *some*
 * usable image and fall back hero → library → cover for the background; the
 * carousel already degrades to a title heading when the logo is missing, so
 * slides are never blank.
 */
function heroFallbackFrom(games: ShopAssets[]): TrendingGame[] {
  return games
    .filter(
      (g) => g.libraryHeroImageUrl || g.libraryImageUrl || g.coverImageUrl
    )
    .slice(0, 5)
    .map((g) => ({
      ...g,
      libraryHeroImageUrl:
        g.libraryHeroImageUrl ?? g.libraryImageUrl ?? g.coverImageUrl,
      description: null,
      uri: buildGameDetailsPath({
        shop: g.shop,
        objectId: g.objectId,
        title: g.title,
      }),
    }));
}

async function getClassics(): Promise<ShopAssets[]> {
  // Randomized, mixed-platform, artwork-only console games — a fresh shuffle
  // each load. The row hides itself when this is empty (see category-row).
  const response = await window.electron.getRandomClassics(24);

  return ensureArray<CatalogueSearchResult>(response, "getRandomClassics").map(
    classicsResultToShopAssets
  );
}

/**
 * "Recommended for you": learn a genre taste profile from the user's library
 * (playtime + recency + favorites), fetch popular catalogue games in those
 * genres, and rank them by similarity — excluding games they already own. Empty
 * (row hides) when the library has no genre signal yet, so new users aren't
 * shown a meaningless row.
 */
async function getRecommended(
  downloadSourceIds: string[],
  language: string
): Promise<ShopAssets[]> {
  const library = (await window.electron
    .getLibrary()
    .catch(() => [])) as LibraryGame[];
  if (!library.length) return [];

  // Many library games (esp. Steam-synced) don't store genres, which would
  // leave the taste profile empty. Backfill genres for the most-played games
  // from their shop details (cached in main) so the recommender always has a
  // signal. Only the top-played handful are backfilled to keep home load fast.
  const topPlayed = [...library]
    .sort(
      (a, b) =>
        (b.playTimeInMilliseconds ?? 0) - (a.playTimeInMilliseconds ?? 0)
    )
    .slice(0, 12);

  const enriched = await Promise.all(
    topPlayed.map(async (game) => {
      if (game.genres?.length) return game;
      const details = await window.electron
        .getGameShopDetails(game.objectId, game.shop, language)
        .catch(() => null);
      const genres = (details?.genres ?? [])
        .map((g) => g.name)
        .filter(Boolean);
      return { ...game, genres };
    })
  );

  // Merge backfilled genres into the full library so the taste weights use them
  // while ownedIds still covers EVERY owned game (not just the top 12).
  const enrichedById = new Map(
    enriched.map((g) => [`${g.shop}:${g.objectId}`, g])
  );
  const fullLibrary = library.map(
    (g) => enrichedById.get(`${g.shop}:${g.objectId}`) ?? g
  );

  const profile = buildTasteProfile(fullLibrary);
  if (profile.topGenres.length === 0) return [];

  // `/catalogue/search` ANDs its genres filter, so passing all top genres at
  // once matches almost nothing. Query the top few genres SEPARATELY (each a
  // broad single-genre pool), merge, then rank by the full taste vector so games
  // that hit MORE of the user's genres rise to the top.
  const searchGenre = (genre: string) =>
    window.electron.hydraApi
      .post<{ edges: CatalogueSearchResult[]; count: number }>(
        "/catalogue/search",
        {
          data: {
            title: "",
            genres: [genre],
            tags: [],
            publishers: [],
            developers: [],
            downloadSourceFingerprints: [],
            protondbSupportBadges: [],
            deckCompatibility: [],
            sortBy: "popularity",
            sortOrder: "desc",
            take: 30,
            skip: 0,
            downloadSourceIds,
          },
          needsAuth: false,
        }
      )
      .then((r) => r.edges)
      .catch(() => [] as CatalogueSearchResult[]);

  const pools = await Promise.all(
    profile.topGenres.slice(0, 3).map(searchGenre)
  );
  const candidates = pools.flat();

  return rankRecommendations(
    candidates,
    profile,
    24,
    classicsResultToShopAssets
  );
}

/**
 * Single source of truth for the home screen. Every list is fetched exactly
 * once (in parallel) so the hero carousel and the category rows never request
 * the same dataset twice. The hero consumes `/catalogue/featured`, which is a
 * distinct dataset from `/catalogue/hot`, so the hero and the Hot row do not
 * overlap.
 */
export function useHomeCatalogue(language: string) {
  const [catalogue, setCatalogue] = useState<HomeCatalogue>(EMPTY_CATALOGUE);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function loadCatalogue() {
      setIsLoading(true);

      const sources = (await levelDBService.values(
        "downloadSources"
      )) as DownloadSource[];
      const downloadSourceIds = orderBy(sources, "createdAt", "desc").map(
        (source) => source.id
      );

      const [featured, recommended, hot, weekly, achievements, classics] =
        await Promise.all([
          getFeatured(language).catch(() => [] as TrendingGame[]),
          getRecommended(downloadSourceIds, language).catch(
            () => [] as ShopAssets[]
          ),
          getCategory(CatalogueCategory.Hot, downloadSourceIds).catch(
            () => [] as ShopAssets[]
          ),
          getCategory(CatalogueCategory.Weekly, downloadSourceIds).catch(
            () => [] as ShopAssets[]
          ),
          getCategory(CatalogueCategory.Achievements, downloadSourceIds).catch(
            () => [] as ShopAssets[]
          ),
          getClassics().catch(() => [] as ShopAssets[]),
        ]);

      // Keep the hero alive even when `/catalogue/featured` returns empty by
      // seeding it from the Hot (then Weekly) row, which shares the same
      // artwork fields the hero needs.
      const resolvedFeatured = featured.length
        ? featured
        : heroFallbackFrom(hot.length ? hot : weekly);

      if (isMounted) {
        setCatalogue({
          featured: resolvedFeatured,
          recommended,
          hot,
          weekly,
          achievements,
          classics,
        });
      }
    }

    loadCatalogue()
      .catch(() => {
        if (isMounted) setCatalogue(EMPTY_CATALOGUE);
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [language]);

  return { catalogue, isLoading };
}
