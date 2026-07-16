import { registerEvent } from "../register-event";
import { randomMinervaGames } from "@main/level/sublevels/minerva-catalogue";
import { getGameHubMeta } from "@main/level/sublevels/gamehub-meta";
import type { CatalogueSearchResult } from "@types";

/**
 * A randomized "Console classics" feed for the home screen: mixed platforms,
 * shuffled fresh on every call, and — crucially — ONLY games that actually have
 * cover artwork (a home row of placeholder tiles looks broken). We over-fetch a
 * random pool, keep the ones whose GameHub metadata has an image, and stop once
 * we hit `limit`.
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

    for (const game of pool) {
      if (results.length >= limit) break;
      const meta = await getGameHubMeta(game.system, game.title);
      const image = meta?.libraryImageUrl ?? meta?.coverImageUrl ?? null;
      if (!image) continue;
      results.push({
        id: game.objectId,
        objectId: game.objectId,
        title: game.title,
        shop: "launchbox" as const,
        genres: meta?.genres ?? [],
        releaseYear: meta?.releaseYear ?? null,
        libraryImageUrl: image,
        downloadSources: ["GameHub Vault"],
      } satisfies CatalogueSearchResult);
    }

    return results;
  }
);
