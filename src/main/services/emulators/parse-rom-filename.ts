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
// The catalogue is limited to ENGLISH releases (USA + pan-European English).
// No-Intro tags the pan-European English release as "(Europe)" (it bundles
// En,Fr,De,Es,It), then ALSO ships per-country localized dumps: "(Spain)",
// "(France)", "(Germany)", "(Italy)"… whose titles are translated
// ("Pokemon - Edicion Rubi", "Versione Rubino"). Those are foreign-language
// duplicates of the same game, so only English-family regions are allowed;
// every other country (and Japan/Korea/Taiwan/Asia) is excluded.

/** Regions whose releases are in English (kept). */
const ENGLISH_REGION_TOKENS = new Set([
  "usa",
  "us",
  "u",
  "world",
  "w",
  "europe",
  "eur",
  "e",
  "uk",
  "united kingdom",
  "australia",
  "new zealand",
  "canada",
  "ireland",
]);

/**
 * Every token we recognize AS a region (English or not). Used to tell a real
 * region tag apart from an unrelated tag like "(SGB Enhanced)" so an untagged
 * homebrew entry is kept while a localized "(Spain)" release is dropped.
 */
const KNOWN_REGION_TOKENS = new Set([
  ...ENGLISH_REGION_TOKENS,
  // Non-English European / other countries — excluded (localized dupes).
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
  "greece",
  "scandinavia",
  "russia",
  "brazil",
  "mexico",
  "latin america",
  // Asia — excluded.
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

/**
 * The English region families a ROM covers ("(USA, Europe)" → ["USA","Europe"];
 * "(Europe)" → ["Europe"]). Empty when the ROM has no English region tag.
 */
export function romRegionFamilies(fileName: string): string[] {
  const withoutExt = stripExtension(fileName);
  const families = new Set<string>();
  for (const match of withoutExt.matchAll(TAG_REGEX)) {
    for (const raw of match[0].slice(1, -1).split(",")) {
      const token = raw.trim().toLowerCase();
      if (!ENGLISH_REGION_TOKENS.has(token)) continue;
      families.add(
        token === "usa" || token === "us" || token === "u" || token === "canada"
          ? "USA"
          : token === "world" || token === "w"
            ? "World"
            : "Europe"
      );
    }
  }
  return [...families];
}

/**
 * Whether a ROM is an English (USA/Europe-family) release.
 * Policy: if any recognized region tag is English → keep (covers combos like
 * "(USA, Europe)"); if it carries region tags but none are English → drop
 * (localized "(Spain)"/"(Japan)"/… dupes); if it has NO recognized region tag
 * at all → keep (untagged homebrew shouldn't vanish).
 */
export function isAllowedRomRegion(fileName: string): boolean {
  const withoutExt = stripExtension(fileName);

  let sawRegion = false;
  for (const match of withoutExt.matchAll(TAG_REGEX)) {
    for (const raw of match[0].slice(1, -1).split(",")) {
      const token = raw.trim().toLowerCase();
      if (!token) continue;
      if (ENGLISH_REGION_TOKENS.has(token)) return true;
      if (KNOWN_REGION_TOKENS.has(token)) sawRegion = true;
    }
  }

  return !sawRegion;
}
