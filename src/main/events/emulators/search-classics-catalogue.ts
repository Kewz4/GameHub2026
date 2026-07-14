import { registerEvent } from "../register-event";
import { searchMinervaGames } from "@main/level/sublevels/minerva-catalogue";
import { getGameHubMeta } from "@main/level/sublevels/gamehub-meta";
import type { CatalogueSearchResult, EmulatorSystem } from "@types";

/**
 * Search the console/emulated catalogue and return results shaped like the PC
 * catalogue's `/catalogue/search` edges, so the Catalogue page can render them
 * in the same grid. Art and genres come from the hosted GameHub metadata when
 * available; otherwise the card falls back to a placeholder.
 *
 * When `system` is provided, only games for that console are returned (used by
 * the catalogue's "Console" platform filter with a specific system selected).
 */
registerEvent(
  "searchClassicsCatalogue",
  async (
    _event: Electron.IpcMainInvokeEvent,
    query: string,
    limit?: number,
    system?: EmulatorSystem
  ): Promise<CatalogueSearchResult[]> => {
    const games = await searchMinervaGames(query, limit, system);
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
          libraryImageUrl: meta?.libraryImageUrl ?? meta?.coverImageUrl ?? null,
          downloadSources: ["GameHub Vault"],
        } satisfies CatalogueSearchResult;
      })
    );
  }
);
