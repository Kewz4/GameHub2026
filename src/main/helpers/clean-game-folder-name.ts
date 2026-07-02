/**
 * Turn a raw game folder (or exe) name into a clean, human game title.
 *
 * Beyond separators/versions, this strips the junk that download sites and
 * scene groups append to folder names, so a folder like
 * "Death Must Die -SteamGG.NET" is detected as "Death Must Die":
 *   - website tags: "-SteamGG.NET", "steamrip.com", "[gog-games.to]"
 *   - bracketed release tags: "[FitGirl Repack]", "(CODEX)", "(MULTi12)"
 *   - trailing group suffixes: "- FitGirl Repack", "-ElAmigos", "-TENOKE"
 */

// Scene groups / repackers / release-tag words seen in folder names. Only
// removed when they appear as a bracketed tag or after a trailing dash —
// a bare word inside a real title is never touched.
const RELEASE_TAG_WORDS = [
  "fitgirl",
  "dodi",
  "elamigos",
  "kaoskrew",
  "codex",
  "skidrow",
  "empress",
  "tenoke",
  "rune",
  "flt",
  "plaza",
  "razor1911",
  "reloaded",
  "prophet",
  "cpy",
  "hoodlum",
  "darksiders",
  "goldberg",
  "online-?fix",
  "steamrip",
  "steamgg",
  "gog",
  "repack",
  "rip",
  "cracked",
  "pre-?installed",
  "portable",
  "multi\\s?\\d+",
  "dlcs?(?:\\s+included)?",
  "build\\s?\\d+",
  "update\\s?\\d+",
].join("|");

/** "-SteamGG.NET", "steamrip.com", "[gog-games.to]" … */
const DOMAIN_TAG_RE =
  /[-–\s[(]*\b[\w-]+\.(?:net|com|org|io|to|me|cc|ru|su|site|xyz|info|top|link|club)\b[\])]*/gi;

/** "[FitGirl Repack]", "(CODEX)", "(v1.2.3)", "[MULTi12]" … */
const BRACKET_TAG_RE = new RegExp(
  `\\s*[\\[(][^\\])]*(?:\\b(?:${RELEASE_TAG_WORDS})\\b|v?\\d+(?:\\.\\d+)+)[^\\])]*[\\])]`,
  "gi"
);

/** "- FitGirl Repack…", "-ElAmigos", "- CODEX" at the end of the name. */
const TRAILING_GROUP_RE = new RegExp(
  `[-–]\\s*(?:${RELEASE_TAG_WORDS})\\b.*$`,
  "i"
);

/** Bare trailing tag words left over once separators are gone ("… DODI"). */
const TRAILING_WORDS_RE = new RegExp(
  `(?:\\s+(?:${RELEASE_TAG_WORDS}))+\\s*$`,
  "i"
);

export function cleanGameFolderName(name: string): string {
  return (
    name
      .replace(/[_]+/g, " ")
      .replace(DOMAIN_TAG_RE, " ")
      .replace(BRACKET_TAG_RE, " ")
      .replace(TRAILING_GROUP_RE, " ")
      .replace(TRAILING_WORDS_RE, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2") // NeonAbyss → Neon Abyss
      .replace(/\s*v?\d+\.\d+[\d.]*\s*$/i, "") // trailing version like v1.2.3
      .replace(/\s+/g, " ")
      // Leftover separators once the junk around them is gone.
      .replace(/[\s\-–.,]+$/, "")
      .replace(/^[\s\-–.,]+/, "")
      .trim() || name.trim()
  );
}
