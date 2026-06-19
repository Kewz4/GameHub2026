import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import type { GameShop } from "@types";

const enableExperimentalAchievements = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey).catch(() => null);
  if (!game) return { success: false };
  await gamesSublevel.put(gameKey, {
    ...game,
    experimentalAchievementsEnabled: true,
  });
  return { success: true };
};

registerEvent("enableExperimentalAchievements", enableExperimentalAchievements);
