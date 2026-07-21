import { registerEvent } from "../register-event";
import { randomMinervaGames } from "@main/level/sublevels/minerva-catalogue";
import { getGameHubMeta } from "@main/level/sublevels/gamehub-meta";
import type { CatalogueSearchResult } from "@types";

/** How many gamehub-meta lookups to run concurrently per batch. */
const META_BATCH_SIZE = 40;

/**
 * A randomized "Console classics" feed for the home screen: mixed platforms,
 * shuffled fresh on every call, and — crucially — ONLY games that actually have
 * cover artwork (a home row of placeholder tiles looks broken). We over-fetch a
 * random pool, keep the ones whose GameHub metadata has an image, and stop once
 * we hit `limit`.
 *
 * The metadata lookups are batched with Promise.all (not one big-bang
 * Promise.all over the whole pool, and not a strictly sequential loop) so a
 * large `limit * 12` pool doesn't serialize hundreds of leveldb reads one at a
 * time — the previous sequential-await version was a real latency source when
 * this ran as part of the home screen's "Recommended classics" pipeline.
 */
registerEvent(
  "getRandomClassics",
  async (
    _event: Electron.IpcMainInvokeEvent,
    limit = 24
  ): Promise<CatalogueSearchResult[]> => {
    const results: CatalogueSearchResult[] = [];
    // Scan a bounded random pool so a catalogue full of art-less entries can't
    // make this walk the whole index.
    const pool = await randomMinervaGames(limit * 12);

    for (
      let start = 0;
      start < pool.length && results.length < limit;
      start += META_BATCH_SIZE
    ) {
      const batch = pool.slice(start, start + META_BATCH_SIZE);
      const metas = await Promise.all(
        batch.map((game) => getGameHubMeta(game.system, game.title))
      );

      for (let i = 0; i < batch.length; i++) {
        if (results.length >= limit) break;
        const meta = metas[i];
        const image = meta?.libraryImageUrl ?? meta?.coverImageUrl ?? null;
        if (!image) continue;
        results.push({
          id: batch[i].objectId,
          objectId: batch[i].objectId,
          title: batch[i].title,
          shop: "launchbox" as const,
          genres: meta?.genres ?? [],
          releaseYear: meta?.releaseYear ?? null,
          libraryImageUrl: image,
          downloadSources: ["GameHub Vault"],
        } satisfies CatalogueSearchResult);
      }
    }

    return results;
  }
);
