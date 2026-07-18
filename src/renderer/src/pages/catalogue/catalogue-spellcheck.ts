/**
 * Offline "Did you mean …?" spell-correction for the catalogue search.
 *
 * The hosted search matches tokens literally, so a misspelled distinctive word
 * ("Eldne Ring", "Ocarnia of Time", "God of War Ragnorok") returns nothing and
 * the user is left guessing. This mirrors Google's "Did you mean X?": each query
 * word is checked against a VOCABULARY, and any word that's absent but within a
 * small edit distance of a known word is corrected, yielding a suggested query
 * the user can search with one click.
 *
 * The vocabulary is assembled at call time from three sources — a curated list
 * of popular game words/franchises, the user's own library titles, and the
 * titles currently on screen — so a correction only ever fires for a word that
 * appears in NONE of them (a strong typo signal), never for a word the search
 * already knows about. Fully local and deterministic; no dictionary service.
 */

/**
 * Popular franchise and title words people commonly misspell then re-search.
 * Not exhaustive — the user's library and on-screen results extend it — but a
 * dependable backstop for well-known games that may not be in either.
 */
const COMMON_GAME_WORDS = [
  "zelda",
  "ocarina",
  "majora",
  "breath",
  "wild",
  "tears",
  "kingdom",
  "link",
  "awakening",
  "hyrule",
  "ganon",
  "elden",
  "ring",
  "dark",
  "souls",
  "bloodborne",
  "sekiro",
  "shadows",
  "die",
  "twice",
  "nioh",
  "witcher",
  "cyberpunk",
  "grand",
  "theft",
  "auto",
  "vice",
  "andreas",
  "redemption",
  "arthur",
  "morgan",
  "assassin",
  "creed",
  "valhalla",
  "odyssey",
  "origins",
  "mirage",
  "call",
  "duty",
  "warzone",
  "modern",
  "warfare",
  "battlefield",
  "halo",
  "infinite",
  "destiny",
  "borderlands",
  "bioshock",
  "fallout",
  "elder",
  "scrolls",
  "skyrim",
  "oblivion",
  "morrowind",
  "starfield",
  "mass",
  "effect",
  "andromeda",
  "dragon",
  "age",
  "inquisition",
  "veilguard",
  "baldur",
  "gate",
  "divinity",
  "original",
  "sin",
  "disco",
  "elysium",
  "pillars",
  "eternity",
  "pathfinder",
  "wrath",
  "righteous",
  "final",
  "fantasy",
  "remake",
  "rebirth",
  "kingdom",
  "hearts",
  "persona",
  "metaphor",
  "refantazio",
  "yakuza",
  "judgment",
  "sekiro",
  "nier",
  "automata",
  "replicant",
  "metal",
  "gear",
  "solid",
  "rising",
  "revengeance",
  "devil",
  "cry",
  "bayonetta",
  "god",
  "war",
  "ragnarok",
  "kratos",
  "horizon",
  "zero",
  "dawn",
  "forbidden",
  "west",
  "spider",
  "miles",
  "morales",
  "last",
  "us",
  "uncharted",
  "ghost",
  "tsushima",
  "death",
  "stranding",
  "hades",
  "hollow",
  "knight",
  "silksong",
  "celeste",
  "hyper",
  "light",
  "drifter",
  "dead",
  "cells",
  "cuphead",
  "stardew",
  "valley",
  "terraria",
  "minecraft",
  "valheim",
  "subnautica",
  "factorio",
  "satisfactory",
  "rimworld",
  "prison",
  "architect",
  "cities",
  "skylines",
  "civilization",
  "total",
  "warhammer",
  "vermintide",
  "darktide",
  "left",
  "dying",
  "resident",
  "evil",
  "village",
  "silent",
  "hill",
  "outlast",
  "amnesia",
  "phasmophobia",
  "sons",
  "forest",
  "portal",
  "half",
  "life",
  "alyx",
  "counter",
  "strike",
  "dota",
  "league",
  "legends",
  "valorant",
  "overwatch",
  "apex",
  "fortnite",
  "rocket",
  "fall",
  "guys",
  "among",
  "sea",
  "thieves",
  "monster",
  "hunter",
  "world",
  "iceborne",
  "rise",
  "sunbreak",
  "wilds",
  "pokemon",
  "scarlet",
  "violet",
  "arceus",
  "mario",
  "odyssey",
  "kart",
  "smash",
  "bros",
  "sonic",
  "frontiers",
  "kirby",
  "metroid",
  "dread",
  "prime",
  "splatoon",
  "animal",
  "crossing",
  "horizons",
  "fire",
  "emblem",
  "engage",
  "xenoblade",
  "chronicles",
  "octopath",
  "traveler",
  "triangle",
  "strategy",
  "hi-fi",
  "rush",
  "stellar",
  "blade",
  "lies",
  "black",
  "myth",
  "wukong",
  "star",
  "wars",
  "jedi",
  "survivor",
  "fallen",
  "order",
  "outlaws",
  "squadrons",
  "guardians",
  "galaxy",
  "avengers",
  "batman",
  "arkham",
  "knight",
  "middle",
  "earth",
  "shadow",
  "mordor",
];

/** Words shorter than this are never corrected (too many near-collisions). */
const MIN_CORRECT_LEN = 4;
/** Max single-word edit distance for a correction. */
const MAX_EDIT_DISTANCE = 2;

/** Bounded Levenshtein — bails out early once the distance exceeds `max`. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Build the correction vocabulary from the curated word list plus any extra
 * titles (the user's library and the current results), lowercased and split
 * into words. Returned as a Set for O(1) membership and iterated for nearest-
 * word search.
 */
export function buildVocabulary(extraTitles: string[]): Set<string> {
  const vocab = new Set(COMMON_GAME_WORDS);
  for (const title of extraTitles) {
    for (const word of wordsOf(title)) if (word.length >= 3) vocab.add(word);
  }
  return vocab;
}

/** Nearest vocabulary word to `token` within the edit-distance budget, or null. */
function nearestWord(token: string, vocab: Set<string>): string | null {
  let best: string | null = null;
  let bestDist = MAX_EDIT_DISTANCE + 1;
  for (const word of vocab) {
    // Cheap pre-filters: same first letter and comparable length. Most typos
    // keep the initial letter, and this keeps the scan fast on a large vocab.
    if (word[0] !== token[0]) continue;
    if (Math.abs(word.length - token.length) > MAX_EDIT_DISTANCE) continue;
    const dist = editDistance(token, word, MAX_EDIT_DISTANCE);
    if (dist > 0 && dist < bestDist) {
      bestDist = dist;
      best = word;
      if (dist === 1) break; // can't do better than an edit of 1
    }
  }
  return best;
}

/**
 * Suggest a corrected query for `query`, or null when nothing looks misspelled.
 * Each word absent from the vocabulary but close to a known word is replaced
 * (whole-word, case-insensitive) in the original string, so punctuation and the
 * user's casing survive ("The Legend of Zelda: Ocarnia of Time" → "… Ocarina …").
 */
export function suggestCorrection(
  query: string,
  vocab: Set<string>
): string | null {
  const tokens = wordsOf(query);
  if (!tokens.length) return null;

  let corrected = query;
  let changed = false;

  for (const token of tokens) {
    if (token.length < MIN_CORRECT_LEN) continue;
    if (vocab.has(token)) continue;
    const suggestion = nearestWord(token, vocab);
    if (!suggestion) continue;
    // Replace this word wherever it appears, preserving surrounding text.
    const pattern = new RegExp(`\\b${escapeRegExp(token)}\\b`, "gi");
    corrected = corrected.replace(pattern, (match) =>
      matchCase(match, suggestion)
    );
    changed = true;
  }

  const normalized = corrected.trim();
  return changed && normalized.toLowerCase() !== query.trim().toLowerCase()
    ? normalized
    : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Apply the original word's capitalization pattern to the suggestion. */
function matchCase(original: string, suggestion: string): string {
  if (original === original.toUpperCase()) return suggestion.toUpperCase();
  if (original[0] === original[0]?.toUpperCase()) {
    return suggestion[0].toUpperCase() + suggestion.slice(1);
  }
  return suggestion;
}
