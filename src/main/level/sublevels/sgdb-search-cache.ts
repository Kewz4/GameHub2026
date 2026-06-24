import { db } from "../level";
import { levelKeys } from "./keys";

export interface SgdbSearchCacheEntry {
  /** Resolved SteamGridDB game id, or null when the title had no match. */
  gameId: number | null;
  /** When this title -> id resolution was cached. */
  cachedAt: number;
}

/**
 * Persistent cache of SteamGridDB title searches, keyed by the normalized
 * (trimmed + lower-cased) title. Survives restarts so we don't re-query the
 * SGDB autocomplete endpoint for every ROM on every scan.
 */
export const sgdbSearchCacheSublevel = db.sublevel<
  string,
  SgdbSearchCacheEntry
>(levelKeys.sgdbSearchCache, {
  valueEncoding: "json",
});
