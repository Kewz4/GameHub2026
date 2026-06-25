import { registerEvent } from "../register-event";
import { searchMinervaGames } from "@main/level/sublevels/minerva-catalogue";
import { getGameHubMeta } from "@main/level/sublevels/gamehub-meta";
import type { CatalogueSearchResult } from "@types";

/**
 * Search the console/emulated catalogue and return results shaped like the PC
 * catalogue's `/catalogue/search` edges, so the Catalogue page can render them
 * in the same grid. Art and genres come from the hosted GameHub metadata when
 * available; otherwise the card falls back to a placeholder.
 */
registerEvent(
  "searchClassicsCatalogue",
  async (
    _event: Electron.IpcMainInvokeEvent,
    query: string,
    limit?: number
  ): Promise<CatalogueSearchResult[]> => {
    const games = await searchMinervaGames(query, limit);
    return Promise.all(
      games.map(async (g) => {
        const meta = await getGameHubMeta(g.system, g.title);
        return {
          id: g.objectId,
          objectId: g.objectId,
          title: g.title,
          shop: "launchbox" as const,
          genres: meta?.genres ?? [],
          releaseYear: meta?.releaseYear ?? null,
          libraryImageUrl:
            meta?.libraryImageUrl ?? meta?.coverImageUrl ?? null,
          downloadSources: ["Minerva Archive"],
        } satisfies CatalogueSearchResult;
      })
    );
  }
);
