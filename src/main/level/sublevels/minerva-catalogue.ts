import { db } from "../level";
import { normalizeRomTitle } from "@main/services/emulators/parse-rom-filename";
import type { EmulatorSystem } from "@types";

export interface MinervaCatalogueEntry {
  system: EmulatorSystem;
  title: string;
  region: string | null;
  filename: string;
  romPath: string;
  magnet: string | null;
  torrentUrl: string | null;
  /** Direct hoster download link (GameHub Vault dumps — VikingFile etc.). */
  downloadUrl?: string | null;
  fileSize?: string | null;
  contentType?: "game" | "update" | "dlc";
  /** PS3/WiiU title ID for cross-referencing updates and DLC to base games. */
  titleId?: string | null;
}

export interface MinervaCacheRecord {
  entry: MinervaCatalogueEntry;
  cachedAt: number;
}

export const minervaCatalogueSublevel = db.sublevel<string, MinervaCacheRecord>(
  "minervaCatalogue",
  { valueEncoding: "json" }
);

export const MINERVA_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const normalizeTitle = normalizeRomTitle;

/**
 * Split a query into normalized tokens ("Zelda Ocarina" → ["zelda","ocarina"]).
 * A title matches when EVERY token appears somewhere in its normalized form —
 * word order doesn't matter, and short titles can never match a longer query
 * (the old `query.includes(title)` direction made "Z" match "zelda").
 */
function queryTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Match score, lower = better. Whole-query hits rank above scattered token
 * hits, earlier positions above later ones, and shorter titles above longer
 * ones (so "Legend of Zelda" outranks a long subtitle for query "zelda").
 */
function matchScore(normTitle: string, normQuery: string): number {
  const wholeAt = normTitle.indexOf(normQuery);
  if (wholeAt === 0 && normTitle.length === normQuery.length) return 0;
  if (wholeAt >= 0) return 100 + wholeAt * 2 + normTitle.length / 8;
  return 10_000 + normTitle.length;
}

/** Systems that have separate update/DLC catalogues stored under extended key prefixes. */
const MULTI_CONTENT_SYSTEMS = new Set<EmulatorSystem>(["ps3", "wiiu"]);

/** Key prefixes for related content types given a primary system. */
function relatedPrefixes(system: EmulatorSystem): string[] {
  if (!MULTI_CONTENT_SYSTEMS.has(system)) return [];
  return [`${system}-upd:`, `${system}-dlc:`];
}

async function scanPrefix(
  prefix: string,
  query: string,
  out: Array<{ entry: MinervaCatalogueEntry; score: number }>
): Promise<void> {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return;
  const normQuery = tokens.join("");

  for await (const [, value] of minervaCatalogueSublevel.iterator({
    gte: prefix,
    lte: `${prefix}￿`,
  })) {
    const normalEntry = normalizeTitle(value.entry.title);
    if (tokens.every((t) => normalEntry.includes(t))) {
      out.push({
        entry: value.entry,
        score: matchScore(normalEntry, normQuery),
      });
    }
  }
}

/**
 * Search the Minerva catalogue by title (and optionally system).
 * For PS3 and WiiU, also includes matching updates and DLC.
 * Returns up to 20 best fuzzy matches (base games first, then updates, then DLC).
 */
export async function searchMinervaCatalogue(
  title: string,
  system?: EmulatorSystem
): Promise<MinervaCatalogueEntry[]> {
  const candidates: Array<{ entry: MinervaCatalogueEntry; score: number }> = [];

  const prefix = system ? `${system}:` : undefined;
  await scanPrefix(prefix ?? "", title, candidates);

  if (system) {
    for (const related of relatedPrefixes(system)) {
      await scanPrefix(related, title, candidates);
    }
  }

  candidates.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    const order = { game: 0, update: 1, dlc: 2 };
    return (
      (order[a.entry.contentType ?? "game"] ?? 0) -
      (order[b.entry.contentType ?? "game"] ?? 0)
    );
  });
  return candidates.slice(0, 20).map((c) => c.entry);
}

/** Every base-game system prefix (excludes the large update/DLC catalogues). */
const BASE_GAME_SYSTEMS: EmulatorSystem[] = [
  "ps1",
  "ps2",
  "ps3",
  "psp",
  "n3ds",
  "nds",
  "dsi",
  "n64",
  "gb",
  "gbc",
  "gba",
  "wiiu",
  "wii",
  "gc",
];

/** A single console game surfaced in the global search (no download payload). */
export interface MinervaGameSuggestion {
  title: string;
  system: EmulatorSystem;
  /** Synthetic, stable id used to open a game-details page for this entry. */
  objectId: string;
}

/** Build the synthetic launchbox objectId used to route to a minerva game. */
export function minervaObjectId(system: EmulatorSystem, title: string): string {
  return `minerva:${system}:${normalizeTitle(title)}`;
}

/**
 * In-memory search index over base games, deduped by system+title. Built
 * lazily from one pass over the sublevel (~30k JSON decodes) and reused for
 * every subsequent keystroke — queries drop from a full-catalogue LevelDB
 * scan + per-entry Levenshtein to a millisecond array sweep.
 */
interface IndexedGame {
  norm: string;
  title: string;
  system: EmulatorSystem;
  objectId: string;
}

let searchIndex: IndexedGame[] | null = null;
let searchIndexBuild: Promise<IndexedGame[]> | null = null;

/** Drop the cached index (call after any catalogue sync/purge). */
export function invalidateMinervaSearchIndex(): void {
  searchIndex = null;
  searchIndexBuild = null;
}

async function buildSearchIndex(): Promise<IndexedGame[]> {
  const seen = new Set<string>();
  const index: IndexedGame[] = [];

  for (const system of BASE_GAME_SYSTEMS) {
    const prefix = `${system}:`;
    for await (const [, value] of minervaCatalogueSublevel.iterator({
      gte: prefix,
      lte: `${prefix}￿`,
    })) {
      const { title } = value.entry;
      const objectId = minervaObjectId(system, title);
      if (seen.has(objectId)) continue;
      seen.add(objectId);
      index.push({
        norm: normalizeTitle(title),
        title,
        system,
        objectId,
      });
    }
  }

  return index;
}

async function getSearchIndex(): Promise<IndexedGame[]> {
  if (searchIndex) return searchIndex;
  // Share one in-flight build between concurrent keystrokes.
  searchIndexBuild ??= buildSearchIndex().then((index) => {
    searchIndex = index;
    return index;
  });
  return searchIndexBuild;
}

/**
 * Search base games across every system for the global search dropdown and
 * catalogue. Every query word must appear in the title (any order), so
 * "zelda" matches every Zelda release. Results are deduped by system+title
 * and ranked best-match first.
 */
export async function searchMinervaGames(
  title: string,
  limit = 8
): Promise<MinervaGameSuggestion[]> {
  const tokens = queryTokens(title);
  const normQuery = tokens.join("");
  if (normQuery.length < 2) return [];

  const index = await getSearchIndex();

  const matches: Array<{ game: IndexedGame; score: number }> = [];
  for (const game of index) {
    if (tokens.every((t) => game.norm.includes(t))) {
      matches.push({ game, score: matchScore(game.norm, normQuery) });
    }
  }

  matches.sort(
    (a, b) => a.score - b.score || a.game.title.localeCompare(b.game.title)
  );

  return matches.slice(0, limit).map(({ game }) => ({
    title: game.title,
    system: game.system,
    objectId: game.objectId,
  }));
}
