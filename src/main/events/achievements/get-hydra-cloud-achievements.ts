import { registerEvent } from "../register-event";
import { gameAchievementsSublevel, gamesSublevel } from "@main/level";

export interface HydraCloudGame {
  shop: string;
  objectId: string;
  title: string;
  iconUrl: string | null;
  totalAchievements: number;
  unlockedAchievements: number;
}

/**
 * Returns all library games that have cloud-synced achievement data — i.e.,
 * records in `gameAchievementsSublevel` whose `source` is NOT "exophase".
 * These are the HydraAPI (Steam/canonical) achievement definitions that were
 * pushed to the user's Hydra cloud account via the Exophase matching pipeline.
 */
const getHydraCloudAchievements = async (
  _event: Electron.IpcMainInvokeEvent
): Promise<HydraCloudGame[]> => {
  const results: HydraCloudGame[] = [];

  for await (const [key, game] of gamesSublevel.iterator()) {
    if (!game || game.isDeleted || game.shop === "custom") continue;

    const achData = await gameAchievementsSublevel.get(key).catch(() => null);
    if (
      !achData ||
      achData.source === "exophase" ||
      !achData.achievements?.length
    )
      continue;

    const unlocked = achData.unlockedAchievements?.length ?? 0;
    if (unlocked === 0) continue;

    results.push({
      shop: game.shop,
      objectId: game.objectId,
      title: game.title,
      iconUrl: game.iconUrl ?? null,
      totalAchievements: achData.achievements.length,
      unlockedAchievements: unlocked,
    });
  }

  results.sort((a, b) => b.unlockedAchievements - a.unlockedAchievements);
  return results;
};

registerEvent("getHydraCloudAchievements", getHydraCloudAchievements);
