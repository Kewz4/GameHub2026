import type { Game, SteamAchievement, UnlockedAchievement } from "@types";
import {
  gameAchievementsSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import { WindowManager } from "../window-manager";
import { achievementsLogger } from "../logger";
import {
  canonicalizeAchievementDefinitions,
  canonicalizeUnlockedAchievements,
} from "./achievement-sync-policy";
import { syncAchievementsToHydraCloud } from "./achievement-cloud-sync";

/**
 * One persistence/sync boundary for platform account imports. Imported rows are
 * normalized before either local storage or Hydra Cloud sees them, and a cloud
 * response can only update the same local game identity that initiated it.
 */
export const persistImportedAchievements = async (
  game: Game,
  achievements: SteamAchievement[] | null,
  unlocked: UnlockedAchievement[]
): Promise<void> => {
  const gameKey = levelKeys.game(game.shop, game.objectId);
  const existing = await gameAchievementsSublevel
    .get(gameKey)
    .catch(() => null);
  const definitions = canonicalizeAchievementDefinitions(
    achievements?.length ? achievements : existing?.achievements
  );
  let mergedUnlocked = canonicalizeUnlockedAchievements(definitions, [
    ...(existing?.unlockedAchievements ?? []),
    ...unlocked,
  ]);

  if (mergedUnlocked.length > 0) {
    const syncResult = await syncAchievementsToHydraCloud({
      remoteId: game.remoteId,
      shop: game.shop,
      objectId: game.objectId,
      achievements: mergedUnlocked,
    });

    mergedUnlocked = canonicalizeUnlockedAchievements(definitions, [
      ...syncResult.achievements,
      ...(syncResult.response?.achievements ?? []),
    ]);

    if (syncResult.status === "failed") {
      achievementsLogger.warn(
        `[Achievement import] Hydra sync remains pending for ${game.shop}:${game.objectId}`
      );
    }
  }

  await gameAchievementsSublevel.put(gameKey, {
    ...existing,
    achievements: definitions,
    unlockedAchievements: mergedUnlocked,
    updatedAt: Date.now(),
    language: existing?.language ?? "en",
  });

  await gamesSublevel.put(gameKey, {
    ...game,
    achievementCount:
      definitions.length > 0 ? definitions.length : game.achievementCount,
    unlockedAchievementCount: mergedUnlocked.length,
  });

  WindowManager.mainWindow?.webContents.send(
    `on-update-achievements-${game.objectId}-${game.shop}`,
    mergedUnlocked
  );
};
