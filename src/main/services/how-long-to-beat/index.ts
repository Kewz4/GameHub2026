import type { HowLongToBeatCategory } from "@types";
import {
  hltbCacheSublevel,
  HLTB_CACHE_TTL_MS,
  HLTB_NEGATIVE_TTL_MS,
} from "@main/level/sublevels/hltb-cache";
import { fetchHowLongToBeat } from "./hltb-client";

function normalizeKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * HowLongToBeat times for a console/emulated game, by title. Reads a LevelDB
 * cache first (30d for hits, 3d for misses) and only hits HLTB on a miss.
 */
export async function getConsoleHowLongToBeat(
  title: string
): Promise<HowLongToBeatCategory[] | null> {
  const key = normalizeKey(title);
  if (!key) return null;

  const cached = await hltbCacheSublevel.get(key).catch(() => null);
  if (cached) {
    const ttl = cached.categories ? HLTB_CACHE_TTL_MS : HLTB_NEGATIVE_TTL_MS;
    if (Date.now() - cached.cachedAt < ttl) {
      return cached.categories;
    }
  }

  const categories = await fetchHowLongToBeat(title);
  await hltbCacheSublevel
    .put(key, { categories, cachedAt: Date.now() })
    .catch(() => {});
  return categories;
}

export { fetchHowLongToBeat } from "./hltb-client";
