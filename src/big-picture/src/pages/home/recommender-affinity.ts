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

/**
 * Gameplay-MECHANIC tags — the "what you actually do" tags that define a play
 * loop (roguelike, deckbuilding, metroidvania, tower defense…). These are
 * weighted ABOVE theme/mood/audience tags (Mythology, Vampire, Atmospheric,
 * LGBTQ+…) in the taste profile, because two games can share a lot of THEME
 * (Hades II and God of War are both mythological hack-and-slash) while the thing
 * that actually separates "more roguelikes" from "more God of War" is the
 * mechanic. This is a taxonomy of tag TYPE, not a model of anyone's taste — the
 * taste still comes entirely from the user's own play data.
 */
const MECHANIC_TAGS = new Set(
  [
    "Roguelike",
    "Roguelite",
    "Action Roguelike",
    "Roguelike Deckbuilder",
    "Traditional Roguelike",
    "Deckbuilding",
    "Card Battler",
    "Card Game",
    "Bullet Hell",
    "Twin Stick Shooter",
    "Arena Shooter",
    "Looter Shooter",
    "Metroidvania",
    "Souls-like",
    "Hack and Slash",
    "Beat 'em up",
    "Character Action Game",
    "Platformer",
    "Precision Platformer",
    "2D Platformer",
    "3D Platformer",
    "Tower Defense",
    "Auto Battler",
    "Turn-Based Strategy",
    "Turn-Based Tactics",
    "Real Time Tactics",
    "Real-Time Strategy",
    "RTS",
    "Grand Strategy",
    "4X",
    "City Builder",
    "Colony Sim",
    "Base Building",
    "Automation",
    "Immersive Sim",
    "Stealth",
    "Dungeon Crawler",
    "CRPG",
    "Party-Based RPG",
    "JRPG",
    "Action RPG",
    "Tactical RPG",
    "Survival",
    "Crafting",
    "Farming Sim",
    "Life Sim",
    "Fighting",
    "Shoot 'Em Up",
    "Rhythm",
    "Racing",
    "Flight",
    "Puzzle",
    "Tactical",
    "Wargame",
    "Sandbox",
    "Visual Novel",
    "Dating Sim",
    "Walking Simulator",
    "Point & Click",
    "Management",
    "Tycoon",
    "Perma Death",
    "Open World Survival Craft",
    "Battle Royale",
    "Extraction Shooter",
  ].map((s) => s.toLowerCase())
);

/** True when a tag names a gameplay mechanic (boosted over theme/mood tags). */
export function isMechanicTag(name: string): boolean {
  return MECHANIC_TAGS.has(name.toLowerCase());
}
