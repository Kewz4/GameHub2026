/**
 * Parses a No-Intro / Redump style ROM filename into a clean human title and
 * (optionally) a region.
 *
 * Examples:
 *   "007 Legends (Europe) (v1.01) (NPEB01017) (Update).pkg"
 *     -> { title: "007 Legends", region: "Europe" }
 *   "Super Mario 64 (USA).z64"
 *     -> { title: "Super Mario 64", region: "USA" }
 *   "Some Game [!].gba"
 *     -> { title: "Some Game", region: null }
 */

export interface ParsedRomFilename {
  title: string;
  region: string | null;
}

// Maps a raw tag token (lower-cased) to a canonical region label.
const REGION_MAP: Record<string, string> = {
  usa: "USA",
  us: "USA",
  u: "USA",
  europe: "Europe",
  eur: "Europe",
  e: "Europe",
  japan: "Japan",
  jpn: "Japan",
  jap: "Japan",
  j: "Japan",
  world: "World",
  w: "World",
};

const stripExtension = (fileName: string): string => {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
};

// Matches a parenthetical "(...)" or bracketed "[...]" tag (non-nested).
const TAG_REGEX = /[([][^()[\]]*[)\]]/g;

const deriveRegion = (tags: string[]): string | null => {
  for (const tag of tags) {
    // A tag may list multiple comma-separated regions: "(USA, Europe)".
    const tokens = tag
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    for (const token of tokens) {
      const mapped = REGION_MAP[token];
      if (mapped) return mapped;
    }
  }
  return null;
};

/**
 * Turn a No-Intro/Redump-style title into its natural display form by moving
 * the FIRST segment's trailing article back to the front (No-Intro only
 * shifts the leading article of a title, never subtitles):
 *   "Legend of Zelda, The - The Minish Cap" → "The Legend of Zelda - The Minish Cap"
 *   "Bug's Life, A" → "A Bug's Life"
 */
export function displayRomTitle(title: string): string {
  const segments = title.split(" - ");
  const m = segments[0].match(/^(.*?),\s+(The|A|An)$/i);
  if (m) segments[0] = `${m[2]} ${m[1]}`;
  return segments.join(" - ");
}

/**
 * Canonical, article-insensitive normalization shared by every ROM-title key
 * and lookup (minerva catalogue, gamehub-meta, objectIds). Comma-shifted
 * articles ("Zelda, The - …") and a leading article ("The Zelda - …") are
 * dropped BEFORE squashing, so the No-Intro form and the natural display
 * form normalize to the SAME key — lookups work with either.
 */
export function normalizeRomTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/,\s*(the|an|a)\b/g, "")
    .replace(/^(the|an|a)\s+/, "")
    .replace(/[^a-z0-9]/g, "");
}

export function parseRomFilename(fileName: string): ParsedRomFilename {
  const withoutExt = stripExtension(fileName);

  const tags: string[] = [];
  for (const match of withoutExt.matchAll(TAG_REGEX)) {
    // Drop the surrounding delimiters.
    tags.push(match[0].slice(1, -1));
  }

  const region = deriveRegion(tags);

  const title = withoutExt
    .replace(TAG_REGEX, " ")
    // Collapse leftover separators/whitespace.
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*-\s*$/, "")
    .trim();

  return { title: displayRomTitle(title || withoutExt.trim()), region };
}

// ── Region allowlist ─────────────────────────────────────────────────────────
// The catalogue is limited to USA/Europe releases for now. European releases
// are often tagged with a single country ("(France)", "(Germany)"), so those
// count as Europe; Australia/Canada are English-language PAL/NTSC releases in
// the same families. Asian releases (romanized Japanese/Korean titles like
// "Zelda no Densetsu …" / "Zelda-ui Jeonseol …") are excluded.

const ALLOWED_REGION_TOKENS = new Set([
  "usa",
  "us",
  "u",
  "world",
  "w",
  "europe",
  "eur",
  "e",
  "australia",
  "canada",
  "uk",
  "united kingdom",
  "france",
  "germany",
  "italy",
  "spain",
  "netherlands",
  "holland",
  "sweden",
  "denmark",
  "norway",
  "finland",
  "portugal",
  "poland",
  "austria",
  "switzerland",
  "belgium",
  "ireland",
  "greece",
  "scandinavia",
]);

const DENIED_REGION_TOKENS = new Set([
  "japan",
  "jpn",
  "jap",
  "j",
  "korea",
  "kor",
  "taiwan",
  "china",
  "asia",
  "hong kong",
  "hongkong",
]);

/** Canonical region family per allowed token (European countries → Europe). */
const REGION_FAMILY: Record<string, string> = {
  usa: "USA",
  us: "USA",
  u: "USA",
  canada: "USA",
  world: "World",
  w: "World",
};
for (const token of ALLOWED_REGION_TOKENS) {
  REGION_FAMILY[token] ??= "Europe";
}

/**
 * All allowed region families a ROM covers ("(USA, Europe)" → ["USA","Europe"];
 * "(Germany)" → ["Europe"]). Empty when no allowed region tag is present.
 */
export function romRegionFamilies(fileName: string): string[] {
  const withoutExt = stripExtension(fileName);
  const families = new Set<string>();
  for (const match of withoutExt.matchAll(TAG_REGEX)) {
    for (const raw of match[0].slice(1, -1).split(",")) {
      const family = REGION_FAMILY[raw.trim().toLowerCase()];
      if (family) families.add(family);
    }
  }
  return [...families];
}

/**
 * Whether a ROM belongs to the allowed regions (USA/Europe families).
 * Policy: any allowed region tag → keep (covers "(Japan, USA)" combos);
 * otherwise any denied region tag → drop; no region tag at all → keep
 * (homebrew/unlabelled entries shouldn't vanish).
 */
export function isAllowedRomRegion(fileName: string): boolean {
  const withoutExt = stripExtension(fileName);

  let sawDenied = false;
  for (const match of withoutExt.matchAll(TAG_REGEX)) {
    const tag = match[0].slice(1, -1);
    for (const raw of tag.split(",")) {
      const token = raw.trim().toLowerCase();
      if (!token) continue;
      if (ALLOWED_REGION_TOKENS.has(token)) return true;
      if (DENIED_REGION_TOKENS.has(token)) sawDenied = true;
    }
  }

  return !sawDenied;
}
