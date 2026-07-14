/**
 * Normalize publisher/developer/company names for the catalogue filter lists.
 *
 * The hosted `steam-publishers.json` / `steam-developers.json` datasets carry
 * raw Steam data with no dedup — "Capcom", "Capcom Co., Ltd.", "CAPCOM CO., LTD."
 * all appear as separate entries. This module merges them into one canonical
 * form so the user doesn't see 20,000 near-duplicate companies in the filter
 * sidebar.
 *
 * The normalization is display-only — the raw string is still sent to the API
 * as the filter value. The canonical name is what the user sees.
 */

// Suffixes to strip (case-insensitive, trailing only).
const COMPANY_SUFFIXES = [
  ", ltd.",
  ", ltd",
  " ltd.",
  " ltd",
  ", llc",
  " llc",
  ", inc.",
  ", inc",
  " inc.",
  " inc",
  " co., ltd.",
  " co. ltd.",
  " co.,ltd.",
  " co. ltd",
  " co., ltd",
  " corporation",
  " corp.",
  " corp",
  " s.a.",
  " sa",
  " gmbh",
  " s.r.l.",
  " srl",
  " s.r.o.",
  " b.v.",
  " bv",
  " n.v.",
  " oy",
  " ab",
  " pty. ltd.",
  " pty ltd",
  " pty",
  " limited",
  " pte. ltd.",
  " pte ltd",
  " pte",
  " k.k.",
  " kk",
  " ooo",
  " sp. z o.o.",
  " sp z o o",
  " s.a.s.",
  " sas",
];

// Known alias mappings — force-merge these to a single canonical name.
const ALIAS_MAP: Record<string, string> = {
  "capcom co": "Capcom",
  "capcom co.,": "Capcom",
  capcomco: "Capcom",
  "nintendo co": "Nintendo",
  "nintendo co.,": "Nintendo",
  nintendocotheltd: "Nintendo",
  "nintendo of america": "Nintendo",
  "nintendo of europe": "Nintendo",
  "sony computer entertainment": "Sony Interactive Entertainment",
  "sony interactive entertainment america": "Sony Interactive Entertainment",
  "sony interactive entertainment europe": "Sony Interactive Entertainment",
  "sie america": "Sony Interactive Entertainment",
  "sie europe": "Sony Interactive Entertainment",
  "square enix co": "Square Enix",
  "square enix ltd": "Square Enix",
  "square-enix": "Square Enix",
  "square enix inc": "Square Enix",
  "bandai namco entertainment": "Bandai Namco",
  "bandai namco entertainment america": "Bandai Namco",
  "bandai namco entertainment europe": "Bandai Namco",
  "bandai namco games": "Bandai Namco",
  "namco bandai games": "Bandai Namco",
  "sega of america": "Sega",
  "sega europe": "Sega",
  "sega holdings": "Sega",
  "sega games co": "Sega",
  "konami digital entertainment": "Konami",
  "konami corporation": "Konami",
  "ubisoft entertainment": "Ubisoft",
  "ubisoft montreal": "Ubisoft",
  "ubisoft quebec": "Ubisoft",
  "electronic arts": "EA",
  "ea games": "EA",
  "ea redwood shores": "EA",
  "ea los angeles": "EA",
  "ea canada": "EA",
  "ea dice": "EA",
  "ea sports": "EA",
  "take-two interactive": "Take-Two",
  "take two interactive": "Take-Two",
  "2k games": "2K",
  "2k boston": "2K",
  "2k marin": "2K",
  "rockstar games": "Rockstar Games",
  "rockstar north": "Rockstar Games",
  "rockstar san diego": "Rockstar Games",
  "rockstar toronto": "Rockstar Games",
  "wb games": "Warner Bros. Games",
  "warner bros": "Warner Bros. Games",
  "warner bros. interactive entertainment": "Warner Bros. Games",
  "warner bros interactive entertainment": "Warner Bros. Games",
  "devolver digital inc": "Devolver Digital",
  "team17 digital ltd": "Team17",
  "team17 group": "Team17",
  "thq nordic": "THQ Nordic",
  "nordic games": "THQ Nordic",
  "koei tecmo": "Koei Tecmo",
  "koei tecmo america": "Koei Tecmo",
  "koei tecmo europe": "Koei Tecmo",
  "tecmo koei": "Koei Tecmo",
  "xseed games": "XSEED Games",
  "marvelous usa": "Marvelous",
  "marvelous entertainment": "Marvelous",
  "marvelous aql": "Marvelous",
  "natsume inc": "Natsume",
  "ascii entertainment": "ASCII",
  "ascii corporation": "ASCII",
};

/** Canonical form: lowercase, strip suffixes, collapse whitespace. */
function canonicalKey(name: string): string {
  let s = name.trim().toLowerCase();

  // Strip trailing company suffixes repeatedly (e.g. "Co., Ltd." → "").
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of COMPANY_SUFFIXES) {
      if (s.endsWith(suffix)) {
        s = s.slice(0, -suffix.length).trim();
        changed = true;
        break;
      }
    }
  }

  // Collapse whitespace and punctuation.
  s = s.replace(/[.,]/g, "").replace(/\s+/g, " ").trim();

  // Check alias map.
  const aliased = ALIAS_MAP[s];
  if (aliased) return aliased.toLowerCase();

  return s;
}

/** A normalized filter item: the display label is the canonical name, but the
 *  value sent to the API is the original raw string (so the server still
 *  matches against its raw data). When multiple raw strings map to the same
 *  canonical key, the first one's raw value is used and the display count
 *  reflects how many were merged. */
export interface NormalizedFilterItem {
  label: string;
  value: string;
  checked: boolean;
  /** How many raw entries were merged into this one (for display). */
  mergeCount?: number;
}

/** Normalize a list of publisher/developer strings into deduped filter items. */
export function normalizeCompanyList(
  rawList: string[],
  selectedValues: string[],
  decodeHtml?: (s: string) => string
): NormalizedFilterItem[] {
  const groups = new Map<
    string,
    { raw: string; display: string; count: number }
  >();

  for (const raw of rawList) {
    const display = decodeHtml ? decodeHtml(raw) : raw;
    const key = canonicalKey(display);
    const existing = groups.get(key);
    if (existing) {
      existing.count++;
    } else {
      groups.set(key, { raw, display, count: 1 });
    }
  }

  return [...groups.values()]
    .sort((a, b) => a.display.localeCompare(b.display))
    .map((g) => ({
      label: g.display,
      value: g.raw,
      checked: selectedValues.includes(g.raw),
      mergeCount: g.count > 1 ? g.count : undefined,
    }));
}

/** Normalize a genre list — merges common duplicates. */
const GENRE_MERGE: Record<string, string> = {
  "action-adventure": "Action",
  adventure: "Adventure",
  rpg: "RPG",
  "role-playing": "RPG",
  "role playing": "RPG",
  "role-playing game": "RPG",
  simulation: "Simulation",
  sim: "Simulation",
  strategy: "Strategy",
  sports: "Sports",
  racing: "Racing",
  puzzle: "Puzzle",
  platformer: "Platformer",
  shooter: "Shooter",
  fps: "Shooter",
  fighting: "Fighting",
  arcade: "Arcade",
  casual: "Casual",
  indie: "Indie",
  "massively multiplayer": "Massively Multiplayer",
  mmorpg: "Massively Multiplayer",
  mmo: "Massively Multiplayer",
};

export function normalizeGenreList(
  items: { label: string; value: string; checked: boolean }[]
): { label: string; value: string; checked: boolean }[] {
  const seen = new Map<
    string,
    { label: string; value: string; checked: boolean }
  >();
  for (const item of items) {
    const key = GENRE_MERGE[item.label.toLowerCase()] ?? item.label;
    if (!seen.has(key)) {
      seen.set(key, { ...item, label: key });
    }
  }
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
}
