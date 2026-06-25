import { registerEvent } from "../register-event";
import { searchMinervaGames } from "@main/level/sublevels/minerva-catalogue";
import { getGameHubMeta } from "@main/level/sublevels/gamehub-meta";
import type { EmulatorSystem } from "@types";

export interface ClassicsSuggestion {
  title: string;
  system: EmulatorSystem;
  objectId: string;
  iconUrl: string | null;
}

registerEvent(
  "searchMinervaGames",
  async (
    _event: Electron.IpcMainInvokeEvent,
    query: string,
    limit?: number
  ): Promise<ClassicsSuggestion[]> => {
    const games = await searchMinervaGames(query, limit);
    // Attach cover art from the hosted metadata when available (cheap local
    // lookups — bounded by `limit`).
    return Promise.all(
      games.map(async (g) => {
        const meta = await getGameHubMeta(g.system, g.title);
        return {
          title: g.title,
          system: g.system,
          objectId: g.objectId,
          iconUrl: meta?.coverImageUrl ?? meta?.libraryImageUrl ?? null,
        };
      })
    );
  }
);
