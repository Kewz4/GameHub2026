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

/**
 * Search the Minerva catalogue by title (and optionally system).
 * Returns up to 10 best fuzzy matches.
 */
export async function searchMinervaCatalogue(
  title: string,
  system?: EmulatorSystem
): Promise<MinervaCatalogueEntry[]> {
  const normalTarget = normalizeTitle(title);
  const candidates: Array<{ entry: MinervaCatalogueEntry; score: number }> = [];

  const prefix = system ? `${system}:` : undefined;

  for await (const [key, value] of minervaCatalogueSublevel.iterator(
    prefix ? { gte: prefix, lte: `${prefix}￿` } : {}
  )) {
    // key is always a string here
    void key;
    const normalEntry = normalizeTitle(value.entry.title);
    const isSubstring =
      normalEntry.includes(normalTarget) || normalTarget.includes(normalEntry);
    const dist = levenshtein(normalTarget, normalEntry);
    if (isSubstring || dist <= 2) {
      candidates.push({ entry: value.entry, score: isSubstring ? 0 : dist });
    }
  }

  candidates.sort((a, b) => a.score - b.score);
  return candidates.slice(0, 10).map((c) => c.entry);
}
