import type { CatalogueSearchResult, LibraryGame, ShopAssets } from "@types";

/**
 * A small, fully-local content-based recommender for the home "Recommended for
 * you" row. It learns a genre-weighted taste profile from the user's library —
 * weighting each genre by how MUCH (playtime) and how RECENTLY they've played
 * games of that genre, plus explicit affinity (favorite/pinned) — then ranks
 * catalogue candidates by similarity to that profile. No network of other
 * users' data is involved (that would be server-side collaborative filtering);
 * this is the "games in genres you actually play" signal, computed on-device.
 */

// Recency half-life: a game last played 45 days ago counts about half as much.
const RECENCY_HALF_LIFE_MS = 1000 * 60 * 60 * 24 * 45;
const HOUR_MS = 3_600_000;

export interface TasteProfile {
  /** genre → accumulated weight. */
  weights: Map<string, number>;
  /** `${shop}:${objectId}` of every owned game, to exclude from recommendations. */
  ownedIds: Set<string>;
  /** The strongest genres, used to query candidates. */
  topGenres: string[];
  /** Total accumulated weight — 0 means we have no signal to recommend from. */
  totalSignal: number;
}

const ownedKey = (g: { shop: string; objectId: string }) =>
  `${g.shop}:${g.objectId}`;

/**
 * Build the taste profile from the library. Each owned game contributes to its
 * genres a weight of:
 *   log2(1 + hoursPlayed) + small-base        // played more → stronger, log-scaled
 *   × (recencyFloor + 0.5^(age / halfLife))    // played recently → stronger
 *   × favorite/pinned boosts
 * split across the game's genres so a many-genre game doesn't over-count.
 */
export function buildTasteProfile(library: LibraryGame[]): TasteProfile {
  const now = Date.now();
  const weights = new Map<string, number>();
  const ownedIds = new Set<string>();

  for (const game of library) {
    ownedIds.add(ownedKey(game));
    const genres = game.genres ?? [];
    if (genres.length === 0) continue;

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

    const perGenre = weight / genres.length;
    for (const genre of genres) {
      weights.set(genre, (weights.get(genre) ?? 0) + perGenre);
    }
  }

  const sorted = [...weights.entries()].sort((a, b) => b[1] - a[1]);
  return {
    weights,
    ownedIds,
    topGenres: sorted.slice(0, 6).map(([genre]) => genre),
    totalSignal: sorted.reduce((sum, [, w]) => sum + w, 0),
  };
}

/** Similarity of a candidate to the taste profile: Σ of its genres' weights. */
export function scoreCandidate(
  candidate: CatalogueSearchResult,
  weights: Map<string, number>
): number {
  return (candidate.genres ?? []).reduce(
    (sum, genre) => sum + (weights.get(genre) ?? 0),
    0
  );
}

/**
 * Rank + trim candidates against the profile. The candidates already come
 * genre-filtered by the backend (they're all in the user's top genres), so we
 * only DROP owned games and re-order by taste overlap where the genre labels
 * align — never filtering on the overlap itself, because catalogue results
 * encode genres as index strings that may not match the library's genre
 * strings. When nothing aligns, the backend's popularity order is preserved
 * (stable sort), so the row is always the user's genres, best-first.
 */
export function rankRecommendations(
  candidates: CatalogueSearchResult[],
  profile: TasteProfile,
  limit: number,
  widen: (result: CatalogueSearchResult) => ShopAssets
): ShopAssets[] {
  const seen = new Set<string>();
  return (
    candidates
      .filter((c) => {
        const key = ownedKey(c);
        if (profile.ownedIds.has(key) || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((c, index) => ({
        c,
        index,
        score: scoreCandidate(c, profile.weights),
      }))
      // Higher taste score first; ties fall back to the incoming (popularity) order.
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, limit)
      .map(({ c }) => widen(c))
  );
}
