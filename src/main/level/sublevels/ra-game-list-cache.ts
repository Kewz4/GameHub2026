import { db } from "../level";

/**
 * Cached normalized-title -> RA GameID map for one RetroAchievements console,
 * built from API_GetGameList. Lets us resolve a ROM's RA GameID by title
 * without re-downloading the (large) per-console list on every lookup.
 */
export interface RaGameListCacheRecord {
  consoleId: number;
  titleToGameId: Record<string, number>;
  cachedAt: number;
}

export const raGameListCacheSublevel = db.sublevel<
  string,
  RaGameListCacheRecord
>("raGameListCache", { valueEncoding: "json" });

export const RA_GAME_LIST_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
