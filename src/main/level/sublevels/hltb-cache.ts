import { db } from "../level";
import type { HowLongToBeatCategory } from "@types";

/**
 * Cached HowLongToBeat result for a console/emulated game, keyed by normalized
 * title. Console games aren't in the Hydra backend, so HLTB is resolved live by
 * title on the user's machine and cached here to avoid repeat lookups (and to
 * survive HLTB's anti-bot rate limiting).
 */
export interface HltbCacheRecord {
  /** null = looked up but no match found (negative cache, shorter TTL). */
  categories: HowLongToBeatCategory[] | null;
  cachedAt: number;
}

export const hltbCacheSublevel = db.sublevel<string, HltbCacheRecord>(
  "hltbCache",
  { valueEncoding: "json" }
);

export const HLTB_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days (hits)
export const HLTB_NEGATIVE_TTL_MS = 3 * 24 * 60 * 60 * 1000; // 3 days (misses)
