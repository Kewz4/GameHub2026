import { db } from "../level";
import { levelKeys } from "./keys";

export interface PlaynitePlaytimeCacheEntry {
  shop: string;
  objectId: string;
  title: string;
  playTimeInMilliseconds: number;
  /** Original Playnite provider identifier, when available. */
  sourceGameId?: string;
  /** Compact title persisted for catalogue-independent future matching. */
  normalizedTitle?: string;
  /** False when Hydra had no catalogue match at import time. */
  catalogueResolved?: boolean;
  /** When this playtime was last imported from Playnite. */
  updatedAt: number;
}

/**
 * Caches Playnite-imported playtime for games that are NOT in the local
 * library, keyed by the canonical `${shop}:${objectId}` resolved from the Hydra
 * catalogue. When the user later adds one of these games to their library, the
 * cached playtime is applied — so Playnite import never clutters the library
 * (Retigga) with games the user hasn't explicitly added, while still preserving
 * the correct playtime for when they do.
 */
export const playnitePlaytimeCacheSublevel = db.sublevel<
  string,
  PlaynitePlaytimeCacheEntry
>(levelKeys.playnitePlaytimeCache, {
  valueEncoding: "json",
});
