import { registerEvent } from "../register-event";
import {
  resolveHiddenMatureGames,
  type MaturityQuery,
} from "@main/services/age-rating";

/**
 * Given a batch of games, return the `${shop}:${objectId}` keys that should be
 * HIDDEN under the "hide mature" filter. `resolve=false` decides from local data
 * + cache only (instant; uncached Steam games are hidden fail-closed);
 * `resolve=true` fetches + caches any uncached Steam ratings, then decides.
 */
registerEvent(
  "getGamesMaturity",
  async (
    _event: Electron.IpcMainInvokeEvent,
    games: MaturityQuery[],
    resolve: boolean
  ): Promise<string[]> => {
    if (!Array.isArray(games) || games.length === 0) return [];
    return resolveHiddenMatureGames(games, Boolean(resolve));
  }
);
