import { registerEvent } from "../register-event";
import {
  searchMinervaGames,
  type MinervaGameSuggestion,
} from "@main/level/sublevels/minerva-catalogue";

registerEvent(
  "searchMinervaGames",
  async (
    _event: Electron.IpcMainInvokeEvent,
    query: string,
    limit?: number
  ): Promise<MinervaGameSuggestion[]> => searchMinervaGames(query, limit)
);
