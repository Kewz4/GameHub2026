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
import type {
  EnrichedLibraryGame,
  FacetStats,
  RankableCandidate,
  TasteProfile,
} from "./recommender";
import { buildTasteProfile, rankRecommendations } from "./recommender";
import { isMechanicTag, parseSearchVectorTagIds } from "./recommender-affinity";
import { getAllFeedback } from "./recommendation-feedback";
import { getRecommendedClassics } from "./recommender-classics";
import { externalResourcesInstance } from "@renderer/hooks/use-catalogue";

/** A thumbs-up recommendation counts like a well-liked, moderately-played game. */
const LIKE_SYNTHETIC_HOURS = 8;

/**
 * A catalogue edge as the backend actually returns it — `searchVector` carries
 * the game's Steam tags as numeric ids and isn't in the shared type.
 */
type CatalogueEdge = CatalogueSearchResult & { searchVector?: string | null };

/** A "Because you played {anchor}" shelf for one of the user's taste clusters. */
export interface BecauseYouPlayedRow {
  anchorTitle: string;
  games: ShopAssets[];
}

export interface HomeCatalogue {
  featured: TrendingGame[];
  recommended: ShopAssets[];
  becauseYouPlayed: BecauseYouPlayedRow[];
  recommendedClassics: ShopAssets[];
  hot: ShopAssets[];
  weekly: ShopAssets[];
  achievements: ShopAssets[];
  classics: ShopAssets[];
}

const EMPTY_CATALOGUE: HomeCatalogue = {
  featured: [],
  recommended: [],
  becauseYouPlayed: [],
  recommendedClassics: [],
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

/** One `/catalogue/search` call returning just the global match count. */
async function catalogueCount(data: Record<string, unknown>): Promise<number> {
  return window.electron.hydraApi
    .post<{ count: number }>("/catalogue/search", { data, needsAuth: false })
    .then((r) => r.count ?? 0)
    .catch(() => 0);
}

/** Total catalogue size (IDF denominator), fetched once per session. */
let totalGamesCache: number | null = null;
async function getTotalGames(downloadSourceIds: string[]): Promise<number> {
  if (totalGamesCache !== null) return totalGamesCache;
  totalGamesCache = await catalogueCount({
    ...baseSearchBody(downloadSourceIds),
    take: 5,
  });
  return totalGamesCache;
}

/**
 * Global frequency of each genre/tag feature (how many catalogue games carry
 * it), used for IDF weighting. Persisted in leveldb with a 14-day TTL since
 * these barely change — so the count queries are effectively a one-time cost,
 * then served from cache on every later home load.
 */
const FACET_COUNT_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const facetCountSession = new Map<string, number>();

async function getFacetCounts(
  features: string[],
  nameToId: Map<string, number>,
  downloadSourceIds: string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  await Promise.all(
    features.map(async (feature) => {
      const session = facetCountSession.get(feature);
      if (session !== undefined) {
        counts.set(feature, session);
        return;
      }
      const cached = (await levelDBService
        .get(feature, "recommenderFacetCounts")
        .catch(() => null)) as { count: number; cachedAt: number } | null;
      if (cached && Date.now() - cached.cachedAt < FACET_COUNT_TTL_MS) {
        facetCountSession.set(feature, cached.count);
        counts.set(feature, cached.count);
        return;
      }
      let body: Record<string, unknown> | null = null;
      if (feature.startsWith("tag:")) {
        const id = nameToId.get(feature.slice("tag:".length).toLowerCase());
        if (typeof id === "number") {
          body = { ...baseSearchBody(downloadSourceIds), tags: [id], take: 5 };
        }
      } else if (feature.startsWith("genre:")) {
        body = {
          ...baseSearchBody(downloadSourceIds),
          genres: [feature.slice("genre:".length)],
          take: 5,
        };
      }
      if (!body) return;
      const count = await catalogueCount(body);
      facetCountSession.set(feature, count);
      counts.set(feature, count);
      levelDBService
        .put(feature, { count, cachedAt: Date.now() }, "recommenderFacetCounts")
        .catch(() => {});
    })
  );
  return counts;
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
interface RecommendationResult {
  recommended: ShopAssets[];
  becauseYouPlayed: BecauseYouPlayedRow[];
}

const EMPTY_RECOMMENDATIONS: RecommendationResult = {
  recommended: [],
  becauseYouPlayed: [],
};

/** How many "Because you played …" shelves to show at most. */
const MAX_BECAUSE_ROWS = 3;
/** A shelf needs at least this many recs to be worth showing. */
const MIN_ROW_SIZE = 6;

async function getRecommended(
  downloadSourceIds: string[],
  language: string
): Promise<RecommendationResult> {
  const library = (await window.electron
    .getLibrary()
    .catch(() => [])) as LibraryGame[];
  if (!library.length) return EMPTY_RECOMMENDATIONS;

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
  const likedEnriched: EnrichedLibraryGame[] = await Promise.all(
    likedNew.map(async (record) => {
      const facets = await fetchGameFacets(record, idToName, downloadSourceIds);
      return {
        shop: record.shop,
        objectId: record.objectId,
        title: record.title,
        genres: facets?.genres ?? record.genres ?? [],
        tags: facets?.tags ?? [],
        playTimeInMilliseconds: LIKE_SYNTHETIC_HOURS * 3_600_000,
        lastTimePlayed: new Date(record.updatedAt).toISOString(),
        favorite: true,
      };
    })
  );
  fullLibrary.push(...likedEnriched);

  // Price every genre/tag the enriched games carry by its global frequency, so
  // the profile can down-weight common facets and up-weight rare/mechanic ones.
  const featureSet = new Set<string>();
  for (const game of [...enriched, ...likedEnriched]) {
    for (const genre of game.genres ?? []) featureSet.add(`genre:${genre}`);
    for (const tag of game.tags ?? []) featureSet.add(`tag:${tag}`);
  }
  const [totalGames, counts] = await Promise.all([
    getTotalGames(downloadSourceIds),
    // Cap the burst of count queries on a cold cache; the cache is persistent so
    // this is a one-time cost, and 60 facets covers any realistic library.
    getFacetCounts([...featureSet].slice(0, 60), nameToId, downloadSourceIds),
  ]);
  const stats: FacetStats = { counts, totalGames };

  const profile = buildTasteProfile(fullLibrary, stats);
  if (profile.topGenres.length === 0 && profile.topTags.length === 0) {
    return EMPTY_RECOMMENDATIONS;
  }

  // `/catalogue/search` ANDs each filter category, so query each top genre and
  // each top tag SEPARATELY (broad single-facet pools). Pools are cached per
  // load and re-used across the blended row and the per-anchor shelves (which
  // often share tags). Tag pools use a deep `take` so a niche-but-well-matching
  // game (e.g. an early-access roguelike ranked ~#90 by popularity) still enters
  // scoring instead of being crowded out by the popular head of the list.
  const poolCache = new Map<string, RankableCandidate[]>();
  const getPool = async (
    feature: string,
    body: { genres?: string[]; tags?: number[] },
    take: number
  ): Promise<RankableCandidate[]> => {
    const cached = poolCache.get(feature);
    if (cached) return cached;
    const edges = await searchCatalogueEdges({
      ...baseSearchBody(downloadSourceIds),
      genres: body.genres ?? [],
      tags: body.tags ?? [],
      take,
    });
    const pool = edges.map((result) => ({
      result,
      tags: edgeTags(result, idToName),
      originFeatures: new Set([feature]),
    }));
    poolCache.set(feature, pool);
    return pool;
  };

  /** Fetch + rank a single profile's candidates, excluding the given ids. */
  const recommendFrom = async (
    taste: TasteProfile,
    excludeIds: Set<string>,
    limit: number
  ): Promise<ShopAssets[]> => {
    const tagPools = taste.topTags
      .map((name) => ({ name, id: nameToId.get(name.toLowerCase()) }))
      .filter(
        (t): t is { name: string; id: number } => typeof t.id === "number"
      )
      .slice(0, 6)
      .map((t) => getPool(`tag:${t.name}`, { tags: [t.id] }, 100));
    const genrePools = taste.topGenres
      .slice(0, 3)
      .map((genre) => getPool(`genre:${genre}`, { genres: [genre] }, 40));
    const pools = await Promise.all([...tagPools, ...genrePools]);
    return rankRecommendations(
      pools.flat(),
      taste,
      limit,
      classicsResultToShopAssets,
      excludeIds
    );
  };

  const recommended = await recommendFrom(profile, dislikedIds, 24);

  // "Because you played X": one shelf per DISTINCT taste cluster in the library.
  // Anchor on the most-played games, skipping any whose dominant mechanic tag is
  // already covered (so a roguelike-heavy library doesn't get three roguelike
  // shelves), and dedupe games across shelves for variety.
  const allOwnedIds = new Set(
    fullLibrary.map((g) => `${g.shop}:${g.objectId}`)
  );
  const shown = new Set(recommended.map((g) => `${g.shop}:${g.objectId}`));
  const usedClusters = new Set<string>();
  const becauseYouPlayed: BecauseYouPlayedRow[] = [];

  for (const anchor of enriched) {
    if (becauseYouPlayed.length >= MAX_BECAUSE_ROWS) break;
    if (!anchor.tags?.length && !anchor.genres?.length) continue;

    const anchorProfile = buildTasteProfile([{ ...anchor }], stats);
    // Identify the cluster by the anchor's strongest mechanic tag (else its top
    // tag/genre), so distinct shelves cover distinct kinds of games.
    const cluster =
      anchorProfile.topTags.find((t) => isMechanicTag(t)) ??
      anchorProfile.topTags[0] ??
      anchorProfile.topGenres[0];
    if (!cluster || usedClusters.has(cluster)) continue;
    usedClusters.add(cluster);

    const exclude = new Set([...allOwnedIds, ...dislikedIds, ...shown]);
    const games = await recommendFrom(anchorProfile, exclude, 20);
    if (games.length >= MIN_ROW_SIZE) {
      becauseYouPlayed.push({ anchorTitle: anchor.title, games });
      for (const g of games) shown.add(`${g.shop}:${g.objectId}`);
    }
  }

  return { recommended, becauseYouPlayed };
}

/**
 * Single source of truth for the home screen. Every list is fetched exactly
 * once (in parallel) so the hero carousel and the category rows never request
 * the same dataset twice. The hero consumes `/catalogue/featured`, which is a
 * distinct dataset from `/catalogue/hot`, so the hero and the Hot row do not
 * overlap.
 */
/** Persisted home snapshot: painted instantly, then refreshed in background. */
const HOME_SNAPSHOT_SUBLEVEL = "homeCache";
const HOME_SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface HomeSnapshot {
  catalogue: HomeCatalogue;
  language: string;
  savedAt: number;
}

export function useHomeCatalogue(language: string) {
  const [catalogue, setCatalogue] = useState<HomeCatalogue>(EMPTY_CATALOGUE);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    // Stale-while-revalidate: paint the last session's rows immediately (no
    // skeleton flash), then let the fresh load below replace them when it
    // lands. The snapshot is only cosmetic state, so failures are ignored.
    levelDBService
      .get("snapshot", HOME_SNAPSHOT_SUBLEVEL)
      .then((value) => {
        const snap = value as HomeSnapshot | null;
        if (
          isMounted &&
          snap?.catalogue &&
          snap.language === language &&
          Date.now() - snap.savedAt < HOME_SNAPSHOT_MAX_AGE_MS
        ) {
          setCatalogue({ ...EMPTY_CATALOGUE, ...snap.catalogue });
          setIsLoading(false);
        }
      })
      .catch(() => undefined);

    async function loadCatalogue() {
      const sources = (await levelDBService.values(
        "downloadSources"
      )) as DownloadSource[];
      const downloadSourceIds = orderBy(sources, "createdAt", "desc").map(
        (source) => source.id
      );

      const [
        recommendations,
        recommendedClassics,
        featured,
        hot,
        weekly,
        achievements,
        classics,
      ] = await Promise.all([
        getRecommended(downloadSourceIds, language).catch(
          () => EMPTY_RECOMMENDATIONS
        ),
        window.electron
          .getLibrary()
          .then((library) => getRecommendedClassics(library as LibraryGame[]))
          .catch(() => [] as ShopAssets[]),
        getFeatured(language).catch(() => [] as TrendingGame[]),
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

      const fresh: HomeCatalogue = {
        featured: resolvedFeatured,
        recommended: recommendations.recommended,
        becauseYouPlayed: recommendations.becauseYouPlayed,
        recommendedClassics,
        hot,
        weekly,
        achievements,
        classics,
      };

      if (isMounted) setCatalogue(fresh);

      // Persist for the next launch's instant paint — but never overwrite a
      // good snapshot with an all-empty load (e.g. offline start).
      const hasContent = Object.values(fresh).some(
        (rows) => Array.isArray(rows) && rows.length > 0
      );
      if (hasContent) {
        const snapshot: HomeSnapshot = {
          catalogue: fresh,
          language,
          savedAt: Date.now(),
        };
        levelDBService
          .put("snapshot", snapshot, HOME_SNAPSHOT_SUBLEVEL)
          .catch(() => undefined);
      }
    }

    loadCatalogue()
      .catch(() => {
        // Keep whatever the snapshot painted; only blank out if nothing did.
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
