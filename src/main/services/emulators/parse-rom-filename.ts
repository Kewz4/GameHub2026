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
  "u": "USA",
  europe: "Europe",
  eur: "Europe",
  "e": "Europe",
  japan: "Japan",
  jpn: "Japan",
  jap: "Japan",
  "j": "Japan",
  world: "World",
  "w": "World",
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

  return { title: title || withoutExt.trim(), region };
}
