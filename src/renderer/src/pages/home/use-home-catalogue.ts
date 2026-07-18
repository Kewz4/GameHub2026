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
import type { EnrichedLibraryGame, RankableCandidate } from "./recommender";
import { buildTasteProfile, rankRecommendations } from "./recommender";
import {
  clusterTagIds,
  detectClusters,
  detectClustersFromTitle,
} from "./recommender-affinity";
import { getAllFeedback } from "./recommendation-feedback";
import { externalResourcesInstance } from "@renderer/hooks/use-catalogue";

/** A thumbs-up recommendation counts like a well-liked, moderately-played game. */
const LIKE_SYNTHETIC_HOURS = 8;

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
 * Steam tag name→id map (from steam-user-tags.json), used to translate a niche
 * playstyle cluster into the tag ids the catalogue search understands. Fetched
 * once per session and cached — it's a large static file.
 */
let tagNameToIdCache: Map<string, number> | null = null;

async function getTagNameToId(language: string): Promise<Map<string, number>> {
  if (tagNameToIdCache) return tagNameToIdCache;
  try {
    const { data } = await externalResourcesInstance.get<
      Record<string, Record<string, number>>
    >("/steam-user-tags.json");
    const dict = data[language] ?? data["en"] ?? {};
    const map = new Map<string, number>();
    for (const [name, id] of Object.entries(dict)) {
      const numeric = Number(id);
      if (name && Number.isFinite(numeric))
        map.set(name.toLowerCase(), numeric);
    }
    tagNameToIdCache = map;
  } catch {
    tagNameToIdCache = new Map();
  }
  return tagNameToIdCache;
}

/**
 * "Recommended for you": learn a taste profile from the user's library over
 * coarse genres AND niche playstyle clusters (roguelite, character-action,
 * souls-like…), fetch popular catalogue games in those genres and Steam tags,
 * then rank by similarity — excluding owned and heavily-online games. Each
 * result carries a "why" explanation. Empty (row hides) when the library has no
 * signal yet, so new users aren't shown a meaningless row.
 */
async function getRecommended(
  downloadSourceIds: string[],
  language: string
): Promise<ShopAssets[]> {
  const library = (await window.electron
    .getLibrary()
    .catch(() => [])) as LibraryGame[];
  if (!library.length) return [];

  // Many library games (esp. Steam-synced) don't store genres, and none store
  // the description text niche-cluster detection needs. Fetch full details for
  // the most-played handful (cached in main, so repeat loads are cheap) to
  // backfill genres and mine playstyle clusters from title + description.
  const topPlayed = [...library]
    .sort(
      (a, b) =>
        (b.playTimeInMilliseconds ?? 0) - (a.playTimeInMilliseconds ?? 0)
    )
    .slice(0, 16);

  const enriched = await Promise.all(
    topPlayed.map(async (game): Promise<EnrichedLibraryGame> => {
      const details = await window.electron
        .getGameShopDetails(game.objectId, game.shop, language)
        .catch(() => null);
      const genres = game.genres?.length
        ? game.genres
        : (details?.genres ?? []).map((g) => g.name).filter(Boolean);
      // Cap the mined text so the cluster regexes stay cheap on long HTML.
      const text = [
        game.title,
        details?.short_description,
        details?.about_the_game,
      ]
        .filter(Boolean)
        .join(" ")
        .slice(0, 2000);
      return { ...game, genres, clusters: detectClusters(text) };
    })
  );

  // Merge the enriched entries into the full library so the taste weights use
  // them while ownedIds still covers EVERY owned game (not just the top 16).
  const enrichedById = new Map(
    enriched.map((g) => [`${g.shop}:${g.objectId}`, g])
  );
  const fullLibrary: EnrichedLibraryGame[] = library.map(
    (g) => enrichedById.get(`${g.shop}:${g.objectId}`) ?? g
  );

  // Fold in the user's thumbs up/down feedback. A "like" becomes a synthetic
  // favorite (its genres/clusters strengthen the taste profile, and it won't be
  // re-recommended); a "dislike" is excluded from candidates. Liked games
  // already in the library are skipped so their weight isn't double-counted.
  const feedback = await getAllFeedback();
  const libraryKeys = new Set(library.map((g) => `${g.shop}:${g.objectId}`));
  const dislikedIds = new Set(
    feedback
      .filter((f) => f.feedback === "dislike")
      .map((f) => `${f.shop}:${f.objectId}`)
  );
  for (const record of feedback) {
    const key = `${record.shop}:${record.objectId}`;
    if (record.feedback !== "like" || libraryKeys.has(key)) continue;
    fullLibrary.push({
      shop: record.shop,
      objectId: record.objectId,
      title: record.title,
      genres: record.genres,
      clusters: detectClustersFromTitle(record.title),
      playTimeInMilliseconds: LIKE_SYNTHETIC_HOURS * 3_600_000,
      lastTimePlayed: new Date(record.updatedAt).toISOString(),
      favorite: true,
    });
  }

  const profile = buildTasteProfile(fullLibrary);
  if (profile.topGenres.length === 0 && profile.topClusters.length === 0) {
    return [];
  }

  // `/catalogue/search` ANDs each filter category, so passing many genres/tags
  // at once matches almost nothing. Query each top genre and each niche cluster
  // SEPARATELY (broad single-facet pools), tag every candidate with the feature
  // that produced it, then rank by the full taste vector so games hitting MORE
  // of the user's genres AND their niche interests rise to the top.
  const search = (
    body: { genres?: string[]; tags?: number[] },
    originFeature: string
  ): Promise<RankableCandidate[]> =>
    window.electron.hydraApi
      .post<{ edges: CatalogueSearchResult[]; count: number }>(
        "/catalogue/search",
        {
          data: {
            title: "",
            genres: body.genres ?? [],
            tags: body.tags ?? [],
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
      .then((r) =>
        r.edges.map((result) => ({
          result,
          originFeatures: new Set([originFeature]),
        }))
      )
      .catch(() => [] as RankableCandidate[]);

  const tagNameToId = await getTagNameToId(language);
  const clusterSearches = profile.topClusters
    .map((id) => ({ id, tagIds: clusterTagIds(id, tagNameToId) }))
    .filter((c) => c.tagIds.length > 0)
    // One representative tag id per cluster keeps the pool broad (an AND of
    // several tags would over-narrow) and the request count bounded.
    .map((c) => search({ tags: [c.tagIds[0]] }, `cluster:${c.id}`));

  const genreSearches = profile.topGenres
    .slice(0, 3)
    .map((genre) => search({ genres: [genre] }, `genre:${genre}`));

  const pools = await Promise.all([...genreSearches, ...clusterSearches]);
  const candidates = pools.flat();

  return rankRecommendations(
    candidates,
    profile,
    24,
    classicsResultToShopAssets,
    dislikedIds
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
