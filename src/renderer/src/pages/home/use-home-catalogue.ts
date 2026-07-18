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
import { parseSearchVectorTagIds } from "./recommender-affinity";
import { getAllFeedback } from "./recommendation-feedback";
import { externalResourcesInstance } from "@renderer/hooks/use-catalogue";

/** A thumbs-up recommendation counts like a well-liked, moderately-played game. */
const LIKE_SYNTHETIC_HOURS = 8;

/**
 * A catalogue edge as the backend actually returns it — `searchVector` carries
 * the game's Steam tags as numeric ids and isn't in the shared type.
 */
type CatalogueEdge = CatalogueSearchResult & { searchVector?: string | null };

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
 * Steam tag dictionary (from steam-user-tags.json): name↔id maps used to decode
 * a catalogue edge's `searchVector` tag ids into names, and to query candidate
 * pools by the user's top tags. Fetched once per session and cached.
 */
interface TagDictionary {
  nameToId: Map<string, number>;
  idToName: Map<number, string>;
}
let tagDictCache: TagDictionary | null = null;

async function getTagDictionary(language: string): Promise<TagDictionary> {
  if (tagDictCache) return tagDictCache;
  try {
    const { data } = await externalResourcesInstance.get<
      Record<string, Record<string, number>>
    >("/steam-user-tags.json");
    const dict = data[language] ?? data["en"] ?? {};
    const nameToId = new Map<string, number>();
    const idToName = new Map<number, string>();
    for (const [name, id] of Object.entries(dict)) {
      const numeric = Number(id);
      if (!name || !Number.isFinite(numeric)) continue;
      nameToId.set(name.toLowerCase(), numeric);
      idToName.set(numeric, name);
    }
    tagDictCache = { nameToId, idToName };
  } catch {
    tagDictCache = { nameToId: new Map(), idToName: new Map() };
  }
  return tagDictCache;
}

/** Decode a catalogue edge's real Steam tag NAMES from its searchVector. */
function edgeTags(
  edge: CatalogueEdge,
  idToName: Map<number, string>
): string[] {
  const names: string[] = [];
  for (const id of parseSearchVectorTagIds(edge.searchVector)) {
    const name = idToName.get(id);
    if (name) names.push(name);
  }
  return names;
}

/** Base `/catalogue/search` body; callers override title/genres/tags/take. */
const baseSearchBody = (downloadSourceIds: string[]) => ({
  title: "",
  genres: [] as string[],
  tags: [] as number[],
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
});

/** One `/catalogue/search` call, returning raw edges (incl. searchVector). */
async function searchCatalogueEdges(
  data: Record<string, unknown>
): Promise<CatalogueEdge[]> {
  return window.electron.hydraApi
    .post<{ edges: CatalogueEdge[]; count: number }>("/catalogue/search", {
      data,
      needsAuth: false,
    })
    .then((r) => r.edges ?? [])
    .catch(() => [] as CatalogueEdge[]);
}

/** Per-session cache of a game's real facets, keyed `${shop}:${objectId}`. */
const facetsCache = new Map<string, { genres: string[]; tags: string[] }>();

const normalizeTitle = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Look up a game's real genres + tags by matching it to a catalogue edge (whose
 * searchVector carries the tags). Steam games match on objectId (= appid);
 * others fall back to a normalized-title match. Cached per session so repeat
 * home loads don't re-query.
 */
async function fetchGameFacets(
  game: { shop: string; objectId: string; title: string },
  idToName: Map<number, string>,
  downloadSourceIds: string[]
): Promise<{ genres: string[]; tags: string[] } | null> {
  const key = `${game.shop}:${game.objectId}`;
  const cached = facetsCache.get(key);
  if (cached) return cached;
  if (!game.title) return null;

  const edges = await searchCatalogueEdges({
    ...baseSearchBody(downloadSourceIds),
    title: game.title,
    take: 8,
  });
  if (!edges.length) return null;

  const wantTitle = normalizeTitle(game.title);
  const match =
    edges.find((e) => e.objectId === game.objectId && e.shop === game.shop) ??
    edges.find((e) => normalizeTitle(e.title) === wantTitle) ??
    edges[0];

  const facets = {
    genres: match.genres ?? [],
    tags: edgeTags(match, idToName),
  };
  facetsCache.set(key, facets);
  return facets;
}

/**
 * "Recommended for you": learn a taste profile from the user's library over the
 * REAL genres AND tags of their most-played games — the tags are the same Steam
 * user tags shown on the store, decoded from each catalogue edge's searchVector.
 * Popular catalogue games are then ranked by how much of that genre+tag taste
 * they share, excluding owned, disliked and heavily-online titles. Each result
 * carries a "why" explanation. Empty (row hides) when the library has no signal
 * yet, so new users aren't shown a meaningless row.
 */
async function getRecommended(
  downloadSourceIds: string[],
  language: string
): Promise<ShopAssets[]> {
  const library = (await window.electron
    .getLibrary()
    .catch(() => [])) as LibraryGame[];
  if (!library.length) return [];

  const { nameToId, idToName } = await getTagDictionary(language);

  // Enrich the most-played handful with their real genres + tags (looked up from
  // the catalogue, cached per session). These few games dominate taste anyway,
  // so we don't pay a lookup for the whole library.
  const topPlayed = [...library]
    .sort(
      (a, b) =>
        (b.playTimeInMilliseconds ?? 0) - (a.playTimeInMilliseconds ?? 0)
    )
    .slice(0, 12);

  const enriched = await Promise.all(
    topPlayed.map(async (game): Promise<EnrichedLibraryGame> => {
      const facets = await fetchGameFacets(game, idToName, downloadSourceIds);
      return {
        ...game,
        genres: facets?.genres ?? game.genres ?? [],
        tags: facets?.tags ?? [],
      };
    })
  );

  // Merge enriched entries into the full library so taste weights use them while
  // ownedIds still covers EVERY owned game (not just the enriched handful).
  const enrichedById = new Map(
    enriched.map((g) => [`${g.shop}:${g.objectId}`, g])
  );
  const fullLibrary: EnrichedLibraryGame[] = library.map(
    (g) => enrichedById.get(`${g.shop}:${g.objectId}`) ?? g
  );

  // Fold in thumbs up/down feedback: a "like" (not already owned) is enriched
  // with its real facets and added as a synthetic favorite; a "dislike" is
  // excluded from candidates.
  const feedback = await getAllFeedback();
  const libraryKeys = new Set(library.map((g) => `${g.shop}:${g.objectId}`));
  const dislikedIds = new Set(
    feedback
      .filter((f) => f.feedback === "dislike")
      .map((f) => `${f.shop}:${f.objectId}`)
  );
  const likedNew = feedback.filter(
    (f) => f.feedback === "like" && !libraryKeys.has(`${f.shop}:${f.objectId}`)
  );
  await Promise.all(
    likedNew.map(async (record) => {
      const facets = await fetchGameFacets(record, idToName, downloadSourceIds);
      fullLibrary.push({
        shop: record.shop,
        objectId: record.objectId,
        title: record.title,
        genres: facets?.genres ?? record.genres ?? [],
        tags: facets?.tags ?? [],
        playTimeInMilliseconds: LIKE_SYNTHETIC_HOURS * 3_600_000,
        lastTimePlayed: new Date(record.updatedAt).toISOString(),
        favorite: true,
      });
    })
  );

  const profile = buildTasteProfile(fullLibrary);
  if (profile.topGenres.length === 0 && profile.topTags.length === 0) {
    return [];
  }

  // `/catalogue/search` ANDs each filter category, so query each top genre and
  // each top tag SEPARATELY (broad single-facet pools). Tag every candidate with
  // the feature that produced it AND its own real tags, then rank by the full
  // taste vector so games sharing MORE of the user's genres + tags rise.
  const searchPool = (
    body: { genres?: string[]; tags?: number[] },
    originFeature: string
  ): Promise<RankableCandidate[]> =>
    searchCatalogueEdges({
      ...baseSearchBody(downloadSourceIds),
      genres: body.genres ?? [],
      tags: body.tags ?? [],
    }).then((edges) =>
      edges.map((result) => ({
        result,
        tags: edgeTags(result, idToName),
        originFeatures: new Set([originFeature]),
      }))
    );

  const tagSearches = profile.topTags
    .map((name) => ({ name, id: nameToId.get(name.toLowerCase()) }))
    .filter((t): t is { name: string; id: number } => typeof t.id === "number")
    .slice(0, 5)
    .map((t) => searchPool({ tags: [t.id] }, `tag:${t.name}`));

  const genreSearches = profile.topGenres
    .slice(0, 3)
    .map((genre) => searchPool({ genres: [genre] }, `genre:${genre}`));

  const pools = await Promise.all([...genreSearches, ...tagSearches]);
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
