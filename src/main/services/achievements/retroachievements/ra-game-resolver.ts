import axios from "axios";
import type { EmulatorSystem } from "@types";
import { raGameListCacheSublevel, RA_GAME_LIST_TTL_MS } from "@main/level";
import { achievementsLogger } from "../../logger";

const RA_BASE_URL = "https://retroachievements.org/API/";

/**
 * RetroAchievements console IDs for the systems whose emulators support RA.
 * (RA has no PS1/PS2/PS3/3DS/WiiU sets, so those are intentionally absent.)
 * DSi titles live under the Nintendo DS list on RA.
 */
export const RA_CONSOLE_IDS: Partial<Record<EmulatorSystem, number>> = {
  gb: 4,
  gbc: 6,
  gba: 5,
  n64: 2,
  nds: 18,
  dsi: 18,
  psp: 41,
  wii: 19,
  gc: 16,
};

interface RaGameListEntry {
  ID: number;
  Title: string;
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Fetch (and cache) the normalized-title -> GameID map for one RA console.
 * Only games that actually have achievements are included (f=1).
 */
async function getConsoleTitleMap(
  consoleId: number,
  username: string,
  apiKey: string
): Promise<Record<string, number>> {
  const cacheKey = String(consoleId);
  const cached = await raGameListCacheSublevel.get(cacheKey).catch(() => null);
  if (cached && Date.now() - cached.cachedAt < RA_GAME_LIST_TTL_MS) {
    return cached.titleToGameId;
  }

  try {
    const { data } = await axios.get<RaGameListEntry[]>(
      `${RA_BASE_URL}API_GetGameList.php`,
      {
        // RA accepts u/z (username) + y (api key); send both spellings so the
        // call works regardless of endpoint vintage. f=1 → only games with
        // achievement sets.
        params: { u: username, z: username, y: apiKey, i: consoleId, f: 1 },
        timeout: 30000,
      }
    );

    if (!Array.isArray(data)) return cached?.titleToGameId ?? {};

    const titleToGameId: Record<string, number> = {};
    for (const entry of data) {
      const key = normalizeTitle(entry.Title);
      // First write wins — RA lists base games before hacks/variants.
      if (key && !(key in titleToGameId)) titleToGameId[key] = entry.ID;
    }

    await raGameListCacheSublevel
      .put(cacheKey, { consoleId, titleToGameId, cachedAt: Date.now() })
      .catch(() => {});

    return titleToGameId;
  } catch (err) {
    achievementsLogger.warn(
      "Failed to fetch RetroAchievements game list",
      err instanceof Error ? err.message : err
    );
    return cached?.titleToGameId ?? {};
  }
}

/**
 * Resolve a ROM's RetroAchievements GameID from its system + title. Returns
 * null when the system has no RA support, no credentials, or no title match.
 */
export async function resolveRaGameId(
  system: EmulatorSystem,
  title: string,
  username: string,
  apiKey: string
): Promise<number | null> {
  const consoleId = RA_CONSOLE_IDS[system];
  if (!consoleId || !username || !apiKey || !title) return null;

  const map = await getConsoleTitleMap(consoleId, username, apiKey);
  const target = normalizeTitle(title);
  if (!target) return null;

  if (map[target]) return map[target];

  // Loose fallback: a RA title that the ROM title starts with (or vice versa),
  // e.g. "Pokemon Red Version" vs "Pokemon Red". Pick the shortest such match
  // to avoid over-greedy hits.
  let best: number | null = null;
  let bestLen = Infinity;
  for (const [key, id] of Object.entries(map)) {
    if (
      (target.startsWith(key) || key.startsWith(target)) &&
      key.length < bestLen
    ) {
      best = id;
      bestLen = key.length;
    }
  }
  return best;
}
