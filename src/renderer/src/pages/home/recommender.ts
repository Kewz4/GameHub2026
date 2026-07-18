import type { CatalogueSearchResult, ShopAssets } from "@types";
import {
  clusterLabel,
  detectClustersFromTitle,
  isHeavilyOnline,
} from "./recommender-affinity";

/**
 * A small, fully-local content-based recommender for the home "Recommended for
 * you" row. It learns a taste profile from the user's library over two feature
 * kinds — coarse Steam GENRES and curated niche playstyle CLUSTERS (roguelite,
 * character-action, souls-like…) — weighting each feature by how MUCH (playtime)
 * and how RECENTLY the user played games carrying it, plus explicit affinity
 * (favorite/pinned). Candidates are then ranked by similarity to that profile.
 *
 * No other users' data is involved (that would be server-side collaborative
 * filtering); this is the "more of what you actually play" signal, on-device.
 * Every feature also remembers which owned games contributed to it, so the row
 * can explain itself: "Because you played Hades, God of War".
 */

// Recency half-life: a game last played 45 days ago counts about half as much.
const RECENCY_HALF_LIFE_MS = 1000 * 60 * 60 * 24 * 45;
const HOUR_MS = 3_600_000;

/** A niche cluster is a strong, specific signal, so it outweighs one genre. */
const CLUSTER_WEIGHT = 0.9;

const GENRE = (name: string) => `genre:${name}`;
const CLUSTER = (id: string) => `cluster:${id}`;

/** Library game enriched with detected niche clusters (see recommender-affinity). */
export interface EnrichedLibraryGame {
  shop: string;
  objectId: string;
  title: string;
  genres?: string[];
  /** Detected playstyle cluster ids (from title + description text). */
  clusters?: string[];
  playTimeInMilliseconds?: number;
  lastTimePlayed?: string | Date | null;
  favorite?: boolean;
  isPinned?: boolean;
}

interface Contributor {
  title: string;
  weight: number;
}

export interface TasteProfile {
  /** namespaced feature ("genre:Action" / "cluster:roguelite") → accumulated weight. */
  featureWeights: Map<string, number>;
  /** feature → owned games that contributed, strongest first (for "why"). */
  contributors: Map<string, Contributor[]>;
  /** `${shop}:${objectId}` of every owned game, to exclude from recommendations. */
  ownedIds: Set<string>;
  /** Strongest raw genre names, used to query candidate pools. */
  topGenres: string[];
  /** Strongest cluster ids, used to query candidates by their Steam tag ids. */
  topClusters: string[];
  /** Total accumulated weight — 0 means we have no signal to recommend from. */
  totalSignal: number;
}

const ownedKey = (g: { shop: string; objectId: string }) =>
  `${g.shop}:${g.objectId}`;

/** Merge a contributor into a feature's list, keeping the strongest per title. */
function addContributor(
  map: Map<string, Contributor[]>,
  feature: string,
  title: string,
  weight: number
) {
  if (!title) return;
  const list = map.get(feature) ?? [];
  const existing = list.find((c) => c.title === title);
  if (existing) existing.weight += weight;
  else list.push({ title, weight });
  map.set(feature, list);
}

/**
 * Build the taste profile from the (enriched) library. Each owned game
 * contributes a base weight of:
 *   log2(1 + hoursPlayed) + small-base        // played more → stronger, log-scaled
 *   × (recencyFloor + 0.5^(age / halfLife))    // played recently → stronger
 *   × favorite/pinned boosts
 * The base is split across the game's genres (so a many-genre game doesn't
 * over-count) and applied — scaled — to each detected niche cluster.
 */
export function buildTasteProfile(
  library: EnrichedLibraryGame[]
): TasteProfile {
  const now = Date.now();
  const featureWeights = new Map<string, number>();
  const contributors = new Map<string, Contributor[]>();
  const ownedIds = new Set<string>();

  const bump = (feature: string, weight: number, title: string) => {
    featureWeights.set(feature, (featureWeights.get(feature) ?? 0) + weight);
    addContributor(contributors, feature, title, weight);
  };

  for (const game of library) {
    ownedIds.add(ownedKey(game));
    const genres = game.genres ?? [];
    const clusters = game.clusters ?? [];
    if (genres.length === 0 && clusters.length === 0) continue;

    const hours = (game.playTimeInMilliseconds ?? 0) / HOUR_MS;
    // Owned-but-unplayed still signals mild interest (+0.2); playtime is
    // log-scaled so a single 500h game doesn't drown everything else.
    let weight = Math.log2(1 + hours) + 0.2;

    if (game.lastTimePlayed) {
      const age = now - new Date(game.lastTimePlayed).getTime();
      // Floor of 0.4 so old-but-loved games keep contributing.
      weight *= 0.4 + Math.pow(0.5, age / RECENCY_HALF_LIFE_MS);
    }
    if (game.favorite) weight *= 1.6;
    if (game.isPinned) weight *= 1.3;

    if (genres.length) {
      const perGenre = weight / genres.length;
      for (const genre of genres) bump(GENRE(genre), perGenre, game.title);
    }
    for (const cluster of clusters) {
      bump(CLUSTER(cluster), weight * CLUSTER_WEIGHT, game.title);
    }
  }

  // Sort contributors within each feature, strongest first, capped.
  for (const [feature, list] of contributors) {
    list.sort((a, b) => b.weight - a.weight);
    contributors.set(feature, list.slice(0, 6));
  }

  const genreEntries = [...featureWeights.entries()]
    .filter(([f]) => f.startsWith("genre:"))
    .sort((a, b) => b[1] - a[1]);
  const clusterEntries = [...featureWeights.entries()]
    .filter(([f]) => f.startsWith("cluster:"))
    .sort((a, b) => b[1] - a[1]);

  return {
    featureWeights,
    contributors,
    ownedIds,
    topGenres: genreEntries.slice(0, 6).map(([f]) => f.slice("genre:".length)),
    topClusters: clusterEntries
      .slice(0, 4)
      .map(([f]) => f.slice("cluster:".length)),
    totalSignal: [...featureWeights.values()].reduce((s, w) => s + w, 0),
  };
}

/** The feature set a candidate matches: its own genres + any origin/title clusters. */
function candidateFeatures(
  candidate: CatalogueSearchResult,
  originFeatures: Set<string> | undefined
): Set<string> {
  const features = new Set<string>(originFeatures ?? []);
  for (const genre of candidate.genres ?? []) features.add(GENRE(genre));
  for (const cluster of detectClustersFromTitle(candidate.title)) {
    features.add(CLUSTER(cluster));
  }
  return features;
}

/** Similarity: Σ of the profile weights for every feature the candidate matches. */
function scoreFeatures(features: Set<string>, profile: TasteProfile): number {
  let score = 0;
  for (const feature of features)
    score += profile.featureWeights.get(feature) ?? 0;
  return score;
}

/**
 * Build the "Because you played …" explanation for a candidate: accumulate how
 * much each owned game contributed to the features this candidate matched, then
 * name the strongest one or two. Returns null when there's no attributable
 * signal (falls back to a generic phrase at the call site).
 */
export function explainRecommendation(
  features: Set<string>,
  profile: TasteProfile
): string | null {
  const byTitle = new Map<string, number>();
  const matchedClusters: string[] = [];
  for (const feature of features) {
    if (feature.startsWith("cluster:")) {
      matchedClusters.push(feature.slice("cluster:".length));
    }
    const list = profile.contributors.get(feature);
    if (!list) continue;
    for (const c of list) {
      byTitle.set(c.title, (byTitle.get(c.title) ?? 0) + c.weight);
    }
  }
  const names = [...byTitle.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([title]) => title);

  if (!names.length) return null;

  const because =
    names.length === 1
      ? `Because you played ${names[0]}`
      : `Because you played ${names[0]} and ${names[1]}`;

  // Add the niche hook when the match is driven by a playstyle cluster the user
  // has a taste for, e.g. "…— you seem to like roguelites".
  const cluster = matchedClusters.find((id) =>
    profile.topClusters.includes(id)
  );
  return cluster
    ? `${because} — you seem to like ${clusterLabel(cluster)}`
    : because;
}

/** A candidate paired with the features that produced it (pool origins). */
export interface RankableCandidate {
  result: CatalogueSearchResult;
  /** Namespaced features from the pool(s) this candidate was fetched from. */
  originFeatures?: Set<string>;
}

/**
 * Rank + trim candidates against the profile. Drops owned games, de-dupes,
 * excludes heavily-online titles (no such catalogue here) and any the user has
 * thumbed-down (`excludeIds`). Re-orders by taste overlap across genres AND
 * niche clusters; ties keep the incoming (popularity) order via a stable sort.
 * Each returned asset carries its "why" explanation.
 */
export function rankRecommendations(
  candidates: RankableCandidate[],
  profile: TasteProfile,
  limit: number,
  widen: (result: CatalogueSearchResult) => ShopAssets,
  excludeIds: Set<string> = new Set()
): ShopAssets[] {
  const seen = new Set<string>();
  return (
    candidates
      .filter(({ result }) => {
        const key = ownedKey(result);
        if (profile.ownedIds.has(key) || seen.has(key)) return false;
        if (excludeIds.has(key)) return false;
        if (isHeavilyOnline(result.genres)) return false;
        seen.add(key);
        return true;
      })
      .map(({ result, originFeatures }, index) => {
        const features = candidateFeatures(result, originFeatures);
        return {
          result,
          index,
          features,
          score: scoreFeatures(features, profile),
        };
      })
      // Higher taste score first; ties fall back to the incoming (popularity) order.
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, limit)
      .map(({ result, features }) => ({
        ...widen(result),
        recommendationReason:
          explainRecommendation(features, profile) ?? "Based on your library",
      }))
  );
}
