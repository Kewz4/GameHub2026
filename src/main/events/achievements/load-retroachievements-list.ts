import type { EmulatorSystem, GameShop, UserAchievement } from "@types";
import { registerEvent } from "../register-event";
import { loadRaAchievementList } from "@main/services/achievements/retroachievements/ra-load-game-achievements";
import { getUnlockedAchievements } from "../user/get-unlocked-achievements";

/**
 * Resolve a console game's RetroAchievements set by title and return the full
 * achievement list (with earned status) for the game-details page. Returns an
 * empty list when RA has no set for the title or no credentials are configured.
 */
const loadRetroAchievementsList = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  system: EmulatorSystem,
  title: string
): Promise<UserAchievement[]> => {
  const loaded = await loadRaAchievementList(shop, objectId, system, title);
  if (!loaded) return [];
  return getUnlockedAchievements(objectId, shop, true);
};

registerEvent("loadRetroAchievementsList", loadRetroAchievementsList);
