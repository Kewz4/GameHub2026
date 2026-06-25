import { db } from "../level";
import type { EmulatorSystem } from "@types";

export interface MinervaCatalogueEntry {
  system: EmulatorSystem;
  title: string;
  region: string | null;
  filename: string;
  romPath: string;
  magnet: string | null;
  torrentUrl: string | null;
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

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (__, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
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
  normalTarget: string,
  out: Array<{ entry: MinervaCatalogueEntry; score: number }>
): Promise<void> {
  for await (const [, value] of minervaCatalogueSublevel.iterator({
    gte: prefix,
    lte: `${prefix}￿`,
  })) {
    const normalEntry = normalizeTitle(value.entry.title);
    const isSubstring =
      normalEntry.includes(normalTarget) || normalTarget.includes(normalEntry);
    const dist = levenshtein(normalTarget, normalEntry);
    if (isSubstring || dist <= 2) {
      out.push({ entry: value.entry, score: isSubstring ? 0 : dist });
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
  const normalTarget = normalizeTitle(title);
  const candidates: Array<{ entry: MinervaCatalogueEntry; score: number }> = [];

  const prefix = system ? `${system}:` : undefined;
  await scanPrefix(prefix ?? "", normalTarget, candidates);

  if (system) {
    for (const related of relatedPrefixes(system)) {
      await scanPrefix(related, normalTarget, candidates);
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
export function minervaObjectId(
  system: EmulatorSystem,
  title: string
): string {
  return `minerva:${system}:${normalizeTitle(title)}`;
}

/**
 * Fuzzy-search base games across every system for the global search dropdown
 * and catalogue. Updates/DLC are excluded. Results are deduped by
 * system+title and ranked best-match first.
 */
export async function searchMinervaGames(
  title: string,
  limit = 8
): Promise<MinervaGameSuggestion[]> {
  const normalTarget = normalizeTitle(title);
  if (normalTarget.length < 2) return [];

  const candidates: Array<{ entry: MinervaCatalogueEntry; score: number }> = [];
  for (const system of BASE_GAME_SYSTEMS) {
    await scanPrefix(`${system}:`, normalTarget, candidates);
  }

  candidates.sort((a, b) => a.score - b.score);

  const seen = new Set<string>();
  const out: MinervaGameSuggestion[] = [];
  for (const { entry } of candidates) {
    const objectId = minervaObjectId(entry.system, entry.title);
    if (seen.has(objectId)) continue;
    seen.add(objectId);
    out.push({ title: entry.title, system: entry.system, objectId });
    if (out.length >= limit) break;
  }
  return out;
}
