/**
 * Normalizes a game title for fuzzy deduplication comparison.
 *
 * Strips:
 *  - Edition qualifiers  (Deluxe, Ultimate, Complete, GOTY, Definitive, …)
 *  - The word "Edition" itself
 *  - Common separators before qualifiers  (: -, –, —)
 *  - Roman numerals are NOT stripped — "Hades II" ≠ "Hades"
 *  - Numbers in the base title are NOT stripped — "F1 23" ≠ "F1 24"
 *
 * Examples:
 *   "God of War Ragnarök Deluxe Edition"  → "god of war ragnarök"
 *   "God of War Ragnarök"                 → "god of war ragnarök"
 *   "Control Ultimate Edition"            → "control"
 *   "Control - Ultimate Edition"          → "control"
 *   "Control: Definitive Edition"         → "control"
 *   "Cyberpunk 2077: Phantom Liberty"     → "cyberpunk 2077 phantom liberty"
 *   "The Witcher 3: Wild Hunt – GOTY"     → "the witcher 3 wild hunt"
 *   "Hades II"                            → "hades ii"   (NOT "hades")
 */

const EDITION_WORDS = new Set([
  "deluxe",
  "ultimate",
  "complete",
  "definitive",
  "enhanced",
  "expanded",
  "extended",
  "gold",
  "premium",
  "legendary",
  "anniversary",
  "remastered",
  "remake",
  "directors cut",
  "director's cut",
  "goty",
  "game of the year",
  "standard",
  "base",
  "digital",
  "bundle",
]);

export function normalizeGameTitle(title: string): string {
  // Strip diacritics (ö→o, é→e, etc.) so cross-encoding comparisons work
  let s = title
    .trim()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

  // Replace punctuation separators (colon, dash variants) with a space
  s = s.replace(/\s*[:\-–—]\s*/g, " ");

  // Remove multi-word phrases first (order matters)
  s = s.replace(/\bgame of the year\b/g, "");
  s = s.replace(/\bdirector['']?s cut\b/g, "");

  // Remove single edition qualifier words
  for (const word of EDITION_WORDS) {
    if (word.includes(" ")) continue; // already handled above
    s = s.replace(new RegExp(`\\b${word}\\b`, "g"), "");
  }

  // Remove the word "edition" on its own
  s = s.replace(/\bedition\b/g, "");

  // Collapse whitespace
  s = s.replace(/\s+/g, " ").trim();

  return s;
}
