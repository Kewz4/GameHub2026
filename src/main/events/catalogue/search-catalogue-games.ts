import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import { searchMinervaGames } from "@main/level/sublevels/minerva-catalogue";
import type { CatalogueSearchResult } from "@types";

export interface CatalogueSearchSuggestion extends CatalogueSearchResult {
  /** "pc" catalogue or "launchbox" console/emulated catalogue. */
  source: "catalogue" | "classics";
}

/**
 * Search both the hosted PC catalogue and the local console/emulated
 * catalogue in parallel, shaped identically so the custom-download modal can
 * offer a single "link this download to a game" dropdown.
 */
const searchCatalogueGames = async (
  _event: Electron.IpcMainInvokeEvent,
  query: string,
  limit = 8
): Promise<CatalogueSearchSuggestion[]> => {
  const title = query.trim();
  if (!title) return [];

  const [pcResponse, classics] = await Promise.all([
    HydraApi.post<{ edges: CatalogueSearchResult[]; count: number }>(
      "/catalogue/search",
      {
        title,
        sortBy: "popularity",
        sortOrder: "desc",
        downloadSourceFingerprints: [],
        tags: [],
        publishers: [],
        genres: [],
        developers: [],
        protondbSupportBadges: [],
        deckCompatibilities: [],
        take: limit,
        skip: 0,
      },
      { needsAuth: false }
    )
      .then((response) => response?.edges ?? [])
      .catch(() => []),
    searchMinervaGames(title, limit).then((games) =>
      games.map((game) => ({
        id: game.objectId,
        objectId: game.objectId,
        title: game.title,
        shop: "launchbox" as const,
        genres: [],
        releaseYear: null,
      }))
    ),
  ]);

  const pc = pcResponse.map((edge) => ({
    ...edge,
    source: "catalogue" as const,
  }));
  const consoleGames = classics.map((game) => ({
    ...game,
    source: "classics" as const,
  }));

  // Prefer PC catalogue matches first, then console titles.
  return [...pc, ...consoleGames].slice(0, limit);
};

registerEvent("searchCatalogueGames", searchCatalogueGames);
