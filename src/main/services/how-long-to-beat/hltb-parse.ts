import type { HowLongToBeatCategory } from "@types";

/**
 * Pure parsing/matching/formatting helpers for the HowLongToBeat client.
 * Kept free of Electron/logger imports so they can be unit-tested in isolation.
 */

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "of",
  "and",
  "version",
  "edition",
  "game",
]);

/** Significant lowercase tokens (matches the metadata generator's tokenizer). */
export function titleTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

/** Seconds -> "12 Hours" / "45 Mins" (the HowLongToBeatSection splits on space). */
export function formatHltbDuration(seconds: number): string | null {
  if (!seconds || seconds <= 0) return null;
  const hours = seconds / 3600;
  if (hours < 1) {
    const mins = Math.round(seconds / 60);
    return `${mins} Mins`;
  }
  const halves = Math.round(hours * 2) / 2;
  const whole = Math.floor(halves);
  const frac = halves - whole > 0 ? "½" : "";
  return `${whole}${frac} Hours`;
}

export interface HltbGame {
  game_name?: string;
  comp_main?: number;
  comp_plus?: number;
  comp_100?: number;
}

/** Map a HLTB result row to the app's category list (only non-zero entries). */
export function mapHltbGame(game: HltbGame): HowLongToBeatCategory[] {
  const out: HowLongToBeatCategory[] = [];
  const add = (title: string, seconds?: number) => {
    const duration = formatHltbDuration(seconds ?? 0);
    if (duration) out.push({ title, duration, accuracy: "00" });
  };
  add("Main Story", game.comp_main);
  add("Main + Extras", game.comp_plus);
  add("Completionist", game.comp_100);
  return out;
}

/** Pick the result whose name best matches the query (most shared tokens, then
 *  fewest extra tokens). Returns null if nothing overlaps enough. */
export function pickBestHltbMatch(
  results: HltbGame[],
  query: string
): HltbGame | null {
  const qt = titleTokens(query);
  if (!qt.length) return null;
  let best: HltbGame | null = null;
  let bestScore = -1;
  for (const g of results) {
    const ct = titleTokens(g.game_name ?? "");
    if (!ct.length) continue;
    const shared = ct.filter((t) => qt.includes(t)).length;
    const queryCovered = shared / qt.length;
    if (queryCovered < 0.6) continue;
    const score = queryCovered - (ct.length - shared) * 0.05;
    if (score > bestScore) {
      best = g;
      bestScore = score;
    }
  }
  return best;
}
