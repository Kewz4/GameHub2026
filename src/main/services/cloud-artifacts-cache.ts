import { db } from "@main/level";

/**
 * Stale-while-revalidate cache for the enriched cloud-saves artifact list.
 * Building the list is expensive (R2 ListObjects + one HEAD per artifact +
 * catalogue lookups for unknown games), so the sidebar page serves the last
 * known list instantly and refreshes in the background. Persisted in LevelDB
 * so the very first open after an app restart is instant too.
 */

const CACHE_KEY = "cloudArtifactsCache";

export interface CloudArtifactsCacheEntry {
  userId: string;
  artifacts: unknown[];
  cachedAt: number;
}

let memory: CloudArtifactsCacheEntry | null = null;

export const getCachedArtifacts =
  async (): Promise<CloudArtifactsCacheEntry | null> => {
    if (memory) return memory;
    const stored = await db
      .get<string, CloudArtifactsCacheEntry>(CACHE_KEY, {
        valueEncoding: "json",
      })
      .catch(() => null);
    if (stored) memory = stored;
    return stored;
  };

export const setCachedArtifacts = async (
  userId: string,
  artifacts: unknown[]
): Promise<void> => {
  memory = { userId, artifacts, cachedAt: Date.now() };
  await db.put(CACHE_KEY, memory, { valueEncoding: "json" }).catch(() => {});
};

/** Drop the cache (after upload/delete) so the next read recomputes. */
export const invalidateCachedArtifacts = async (): Promise<void> => {
  memory = null;
  await db.del(CACHE_KEY).catch(() => {});
};
