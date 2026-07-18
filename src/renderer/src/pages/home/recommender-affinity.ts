/**
 * Real per-game facet extraction for the recommender.
 *
 * The catalogue backend exposes every game's Steam user TAGS on each search
 * edge — not as a clean field, but encoded in the Postgres `searchVector`
 * (a tsvector) alongside the genre words. Tags appear as quoted NUMERIC lexemes
 * (their Steam tag ids), e.g. `'1091588':3B '32322':5B` → "Roguelike
 * Deckbuilder", "Deckbuilding". Mapping those ids through steam-user-tags.json
 * gives us the game's actual tags, so the recommender can learn niche taste
 * ("roguelike deckbuilder", "souls-like") from REAL data instead of hand-coded
 * keyword clusters.
 *
 * This module only parses; the id→name mapping lives with the caller that holds
 * the tag dictionary (see use-home-catalogue).
 */

/**
 * Extract the numeric lexemes (Steam tag ids) from a catalogue edge's
 * `searchVector`. Non-numeric lexemes (genre/title/dev words) are ignored, and
 * so are the position/weight suffixes after the colon. Callers filter the ids
 * against the tag dictionary, which drops the rare non-tag number (e.g. a title
 * token like "2") automatically.
 */
export function parseSearchVectorTagIds(
  searchVector?: string | null
): number[] {
  if (!searchVector) return [];
  const ids: number[] = [];
  // Match quoted all-digit lexemes: '1091588':3B → 1091588.
  const re = /'(\d+)':/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(searchVector)) !== null) {
    ids.push(Number(match[1]));
  }
  return ids;
}

/**
 * Genres/tags that mark a heavily-online / live-service game we never
 * recommend (this launcher has no such catalogue). Local/couch co-op is
 * deliberately NOT excluded. Matched case-insensitively against a game's real
 * genres AND tags.
 */
const ONLINE_EXCLUDE = new Set(
  [
    "Massively Multiplayer",
    "MMO",
    "MMORPG",
    "MOBA",
    "Battle Royale",
    "Free to Play",
    "Hero Shooter",
  ].map((s) => s.toLowerCase())
);

/** True when a game's real genres/tags mark it as heavily-online. */
export function isHeavilyOnline(
  genres: string[] | undefined,
  tags: string[] | undefined
): boolean {
  return [...(genres ?? []), ...(tags ?? [])].some((facet) =>
    ONLINE_EXCLUDE.has(facet.toLowerCase())
  );
}
