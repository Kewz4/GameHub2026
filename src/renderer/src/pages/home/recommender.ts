import type { CatalogueSearchResult, ShopAssets } from "@types";
import { isHeavilyOnline, isMechanicTag } from "./recommender-affinity";

/**
 * A small, fully-local content-based recommender for the home "Recommended for
 * you" row. It learns a taste profile from the user's library over two kinds of
 * REAL per-game facets — Steam GENRES and Steam TAGS (the tags come from each
 * catalogue edge's `searchVector`; see recommender-affinity) — weighting each by
 * how MUCH (playtime) and how RECENTLY the user played games carrying it, plus
 * explicit affinity (favorite/pinned/thumbs-up). Candidates are ranked by
 * similarity to that profile. Tags are what make it niche-aware: 200h in Balatro
 * carries "Roguelike Deckbuilder"/"Deckbuilding"/"Card Battler", so it surfaces
 * Slay the Spire and Inscryption rather than generic Casual/Indie games — no
 * hand-coded genre rules involved.
 *
 * No other users' data is involved (that would be server-side collaborative
 * filtering); this is the "more of what you actually play" signal, on-device.
 * Every feature remembers which owned games contributed to it, so the row can
 * explain itself: "Because you played Balatro — you seem to like Deckbuilding".
 */

// Recency half-life: a game last played 45 days ago counts about half as much.
const RECENCY_HALF_LIFE_MS = 1000 * 60 * 60 * 24 * 45;
const HOUR_MS = 3_600_000;

/** How much a gameplay-mechanic tag outweighs a theme/mood tag of equal rarity. */
const MECHANIC_BOOST = 1.9;

const GENRE = (name: string) => `genre:${name}`;
const TAG = (name: string) => `tag:${name}`;

/**
 * Global facet frequencies used to sharpen the taste profile: how many
 * catalogue games carry each feature (`genre:…`/`tag:…`), plus the catalogue
 * total. Lets common facets (RPG, Action, Singleplayer) be down-weighted and
 * rare, distinctive ones (Action Roguelike, Deckbuilding) up-weighted (IDF).
 */
export interface FacetStats {
  counts: Map<string, number>;
  totalGames: number;
}

/**
 * Per-feature weight multiplier = inverse document frequency × mechanic boost.
 * IDF makes rare facets count more than ubiquitous ones; the mechanic boost
 * then lifts gameplay-mechanic tags above equally-rare theme/mood tags. Degrades
 * to 1× (mechanic boost only) when no frequency stats are available.
 */
function featureMultiplier(feature: string, stats?: FacetStats): number {
  let multiplier = 1;
  if (stats && stats.totalGames > 0) {
    const count = stats.counts.get(feature);
    if (typeof count === "number") {
      multiplier *= Math.log(1 + stats.totalGames / (1 + count));
    }
  }
  if (
    feature.startsWith("tag:") &&
    isMechanicTag(feature.slice("tag:".length))
  ) {
    multiplier *= MECHANIC_BOOST;
  }
  return multiplier;
}

/** Library game enriched with its real Steam genres + tags. */
export interface EnrichedLibraryGame {
  shop: string;
  objectId: string;
  title: string;
  genres?: string[];
  /** Real Steam tag names (decoded from the catalogue edge's searchVector). */
  tags?: string[];
  playTimeInMilliseconds?: number;
  lastTimePlayed?: string | Date | null;
  favorite?: boolean;
  isPinned?: boolean;
  /**
   * A "dislike" entry: contributes NEGATIVE weight to its genres/tags instead
   * of positive, so the taste model actively steers away from that kind of
   * game (not just away from this one game — that exclusion is handled
   * separately via `excludeIds` in rankRecommendations).
   */
  distaste?: boolean;
}

interface Contributor {
  title: string;
  weight: number;
}

export interface TasteProfile {
  /** namespaced feature ("genre:Action" / "tag:Deckbuilding") → accumulated weight. */
  featureWeights: Map<string, number>;
  /** feature → owned games that contributed, strongest first (for "why"). */
  contributors: Map<string, Contributor[]>;
  /** `${shop}:${objectId}` of every owned game, to exclude from recommendations. */
  ownedIds: Set<string>;
  /** Strongest raw genre names, used to query candidate pools. */
  topGenres: string[];
  /** Strongest raw tag names, used to query candidates by their Steam tag ids. */
  topTags: string[];
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
 * The base is split across the game's genres and (separately) across its tags,
 * so a game with many tags doesn't over-count — recurrence across the library is
 * what concentrates weight on the user's actual niche (a lone "Relaxing" tag
 * stays weak; "Deckbuilding" seen across several games rises to the top).
 */
export function buildTasteProfile(
  library: EnrichedLibraryGame[],
  stats?: FacetStats
): TasteProfile {
  const now = Date.now();
  const featureWeights = new Map<string, number>();
  const contributors = new Map<string, Contributor[]>();
  const ownedIds = new Set<string>();

  // IDF × mechanic-boost multiplier per feature (memoized — it's frequency-only,
  // independent of the game contributing the feature).
  const multipliers = new Map<string, number>();
  const multiplierFor = (feature: string) => {
    let m = multipliers.get(feature);
    if (m === undefined) {
      m = featureMultiplier(feature, stats);
      multipliers.set(feature, m);
    }
    return m;
  };

  const bump = (feature: string, weight: number, title: string) => {
    const weighted = weight * multiplierFor(feature);
    featureWeights.set(feature, (featureWeights.get(feature) ?? 0) + weighted);
    addContributor(contributors, feature, title, weighted);
  };

  for (const game of library) {
    ownedIds.add(ownedKey(game));
    const genres = game.genres ?? [];
    const tags = game.tags ?? [];
    if (genres.length === 0 && tags.length === 0) continue;

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

    // A "dislike" contributes NEGATIVE weight to its genres/tags — the taste
    // model actively steers away from that kind of game, not just this one.
    if (game.distaste) weight = -Math.abs(weight);

    // Each facet kind carries the same total mass (`weight`), split across its
    // members, so genres and tags stay comparable regardless of how many a game
    // lists.
    if (genres.length) {
      const perGenre = weight / genres.length;
      for (const genre of genres) bump(GENRE(genre), perGenre, game.title);
    }
    if (tags.length) {
      const perTag = weight / tags.length;
      for (const tag of tags) bump(TAG(tag), perTag, game.title);
    }
  }

  // Sort contributors within each feature, strongest first, capped.
  for (const [feature, list] of contributors) {
    list.sort((a, b) => b.weight - a.weight);
    contributors.set(feature, list.slice(0, 6));
  }

  const topBy = (prefix: string, count: number) =>
    [...featureWeights.entries()]
      .filter(([f]) => f.startsWith(prefix))
      .sort((a, b) => b[1] - a[1])
      .slice(0, count)
      .map(([f]) => f.slice(prefix.length));

  return {
    featureWeights,
    contributors,
    ownedIds,
    topGenres: topBy("genre:", 6),
    topTags: topBy("tag:", 8),
    totalSignal: [...featureWeights.values()].reduce((s, w) => s + w, 0),
  };
}

/** The feature set a candidate matches: its own genres + tags + pool origins. */
function candidateFeatures(candidate: RankableCandidate): Set<string> {
  const features = new Set<string>(candidate.originFeatures ?? []);
  for (const genre of candidate.result.genres ?? []) features.add(GENRE(genre));
  for (const tag of candidate.tags ?? []) features.add(TAG(tag));
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
 * name the strongest one or two, plus the niche tag driving the match. Returns
 * null when there's no attributable signal (generic phrase at the call site).
 */
export function explainRecommendation(
  features: Set<string>,
  profile: TasteProfile
): string | null {
  const byTitle = new Map<string, number>();
  const matchedTags: string[] = [];
  for (const feature of features) {
    if (feature.startsWith("tag:")) {
      matchedTags.push(feature.slice("tag:".length));
    }
    const list = profile.contributors.get(feature);
    if (!list) continue;
    for (const c of list) {
      byTitle.set(c.title, (byTitle.get(c.title) ?? 0) + c.weight);
    }
  }
  // Only ever attribute to POSITIVE contributors — a disliked game contributes
  // negative weight to shared features, and must never surface as "Because you
  // played <the game you disliked>".
  const names = [...byTitle.entries()]
    .filter(([, weight]) => weight > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([title]) => title);

  if (!names.length) return null;

  const because =
    names.length === 1
      ? `Because you played ${names[0]}`
      : `Because you played ${names[0]} and ${names[1]}`;

  // Add the niche hook when a tag the user has a taste for drove the match,
  // e.g. "…— you seem to like Roguelike Deckbuilder games".
  const tag = matchedTags.find((name) => profile.topTags.includes(name));
  return tag ? `${because} — you seem to like ${tag} games` : because;
}

/** A candidate paired with its real tags + the features that produced it. */
export interface RankableCandidate {
  result: CatalogueSearchResult;
  /** Real Steam tag names decoded from the edge's searchVector. */
  tags?: string[];
  /** Namespaced features from the pool(s) this candidate was fetched from. */
  originFeatures?: Set<string>;
}

/**
 * Rank + trim candidates against the profile. Drops owned games, de-dupes,
 * excludes heavily-online titles (no such catalogue here) and any the user has
 * thumbed-down (`excludeIds`). Re-orders by taste overlap across genres AND
 * tags; ties keep the incoming (popularity) order via a stable sort. Each
 * returned asset carries its "why" explanation.
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
      .filter((candidate) => {
        const key = ownedKey(candidate.result);
        if (profile.ownedIds.has(key) || seen.has(key)) return false;
        if (excludeIds.has(key)) return false;
        if (isHeavilyOnline(candidate.result.genres, candidate.tags)) {
          return false;
        }
        seen.add(key);
        return true;
      })
      .map((candidate, index) => {
        const features = candidateFeatures(candidate);
        return {
          result: candidate.result,
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
