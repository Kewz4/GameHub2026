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
  "switch",
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
 * Search base games across every system (or a single system when `system` is
 * provided) for the global search dropdown and catalogue. Every query word
 * must appear in the title (any order), so "zelda" matches every Zelda
 * release. Results are deduped by system+title and ranked best-match first.
 */
/**
 * A random shuffle of the console catalogue (mixed platforms), for the home
 * "Console classics" row. Returns up to `count` games; callers filter these
 * down to ones that actually have artwork. Uses Fisher–Yates on a copy so the
 * cached index is never mutated, and is re-shuffled on every call so the row is
 * different each visit.
 */
export async function randomMinervaGames(
  count: number
): Promise<MinervaGameSuggestion[]> {
  const index = await getSearchIndex();
  const pool = index.slice();
  // Partial Fisher–Yates: only shuffle the prefix we need.
  const n = Math.min(count, pool.length);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(Math.random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n).map(({ title, system, objectId }) => ({
    title,
    system,
    objectId,
  }));
}

export async function searchMinervaGames(
  title: string,
  limit = 8,
  system?: EmulatorSystem,
  /** When true, an empty/too-short query lists games instead of returning []. */
  browse = false
): Promise<MinervaGameSuggestion[]> {
  const tokens = queryTokens(title);
  const normQuery = tokens.join("");
  const index = await getSearchIndex();

  // Browse mode: an empty/too-short query lists games alphabetically (optionally
  // scoped to one console). This powers the catalogue's "Console" filter, which
  // shows all console games with no search term typed. Without the flag, an
  // empty query returns nothing (so the global search dropdown stays quiet).
  if (normQuery.length < 2) {
    if (!browse) return [];
    const all = system ? index.filter((game) => game.system === system) : index;
    return [...all]
      .sort((a, b) => a.title.localeCompare(b.title))
      .slice(0, limit)
      .map(({ title: t, system: s, objectId }) => ({
        title: t,
        system: s,
        objectId,
      }));
  }

  const matches: Array<{ game: IndexedGame; score: number }> = [];
  for (const game of index) {
    if (system && game.system !== system) continue;
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
