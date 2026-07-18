import type { CatalogueSearchResult } from "@types";

/**
 * The hosted `/catalogue/search` title search tokenises the raw query and
 * scores loosely, so punctuation-heavy franchise titles rank badly. Typing
 * "The Legend of Zelda: Link's Awakening" surfaces unrelated games (the common
 * words "the"/"of" dominate and the colon/apostrophe fragment the distinctive
 * tokens), while "Link's Awakening" alone matches correctly.
 *
 * These helpers fix relevance on the client: sanitise the query the API sees,
 * derive a distinctive subtitle to search alongside it, and re-rank the merged
 * results by how well each title actually matches what the user typed.
 */

/** Very common words that carry no discriminative signal in a game title. */
const STOPWORDS = new Set([
  "the",
  "of",
  "a",
  "an",
  "and",
  "to",
  "for",
  "in",
  "on",
]);

/** Lowercase, strip punctuation to spaces, and collapse whitespace. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Meaningful tokens (punctuation removed, stopwords dropped when possible). */
export function titleTokens(value: string): string[] {
  const all = normalize(value).split(" ").filter(Boolean);
  const meaningful = all.filter((token) => !STOPWORDS.has(token));
  // Only drop stopwords if something distinctive remains, so a query that is
  // ALL stopwords (unlikely for a game) still searches for something.
  return meaningful.length ? meaningful : all;
}

/**
 * Clean the query string sent to the search API: punctuation becomes spaces so
 * the tokeniser sees whole words ("Link's" → "Link s" would fragment, so we
 * keep the joined form where possible) and stopwords are dropped. Falls back to
 * the original title if sanitisation would leave nothing.
 */
export function sanitizeTitleQuery(title: string): string {
  const tokens = titleTokens(title);
  const cleaned = tokens.join(" ");
  return cleaned || title.trim();
}

/**
 * When a title carries a subtitle after a colon/dash ("<series>: <subtitle>"),
 * return the subtitle — the most distinctive part, which searches reliably on
 * its own. Returns null when there's no subtitle or it isn't distinctive.
 */
export function subtitleQuery(title: string): string | null {
  const match = title.split(/[:\-–—]/);
  if (match.length < 2) return null;
  const subtitle = match[match.length - 1].trim();
  const tokens = titleTokens(subtitle);
  if (!tokens.length) return null;
  // Skip trivial subtitles ("II", "2") that would match too broadly.
  if (tokens.join("").length < 3) return null;
  return sanitizeTitleQuery(subtitle);
}

/**
 * Score how well a candidate title matches the query, 0..1+. Rewards exact and
 * substring matches, then token overlap weighted by how many of the query's
 * distinctive tokens the candidate covers.
 */
export function scoreTitleMatch(candidateTitle: string, query: string): number {
  const cand = normalize(candidateTitle);
  const q = normalize(query);
  if (!cand || !q) return 0;
  if (cand === q) return 1.5;
  if (cand.includes(q) || q.includes(cand)) return 1.2;

  const queryTokens = titleTokens(query);
  const candTokens = new Set(titleTokens(candidateTitle));
  if (!queryTokens.length) return 0;
  const covered = queryTokens.filter((token) => candTokens.has(token)).length;
  return covered / queryTokens.length;
}

/**
 * Re-rank results by relevance to the original query (stable — ties keep the
 * server's order, which already reflects popularity). Used on page 1 only, so
 * pagination on deeper pages stays server-driven.
 */
export function rerankByRelevance(
  results: CatalogueSearchResult[],
  query: string
): CatalogueSearchResult[] {
  return results
    .map((result, index) => ({
      result,
      index,
      score: scoreTitleMatch(result.title, query),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.result);
}
