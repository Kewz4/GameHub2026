import type { GameShop, UserAchievement, UserPreferences } from "@types";
import { registerEvent } from "../register-event";
import { getGameAchievementData } from "@main/services/achievements/get-game-achievement-data";
import { db, gameAchievementsSublevel, levelKeys } from "@main/level";
import { AchievementWatcherManager } from "@main/services/achievements/achievement-watcher-manager";
import {
  canonicalizeAchievementDefinitions,
  canonicalizeUnlockedAchievements,
} from "@main/services/achievements/achievement-sync-policy";
import { AchievementSouvenirService } from "@main/services/achievements/achievement-souvenir-service";

export const getUnlockedAchievements = async (
  objectId: string,
  shop: GameShop,
  useCachedData: boolean
): Promise<UserAchievement[]> => {
  const cachedAchievements = await gameAchievementsSublevel.get(
    levelKeys.game(shop, objectId)
  );

  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    {
      valueEncoding: "json",
    }
  );

  const showHiddenAchievementsDescription =
    userPreferences?.showHiddenAchievementsDescription || false;

  const achievementsData = canonicalizeAchievementDefinitions(
    await getGameAchievementData(objectId, shop, useCachedData)
  );

  const unlockedAchievements = canonicalizeUnlockedAchievements(
    achievementsData,
    cachedAchievements?.unlockedAchievements
  );
  const achievementProgress = cachedAchievements?.achievementProgress ?? [];
  const souvenirImages = await AchievementSouvenirService.getGameImages(
    shop,
    objectId,
    !useCachedData
  );

  return achievementsData
    .map((achievementData) => {
      const unlockedAchievementData = unlockedAchievements.find(
        (localAchievement) => {
          return (
            localAchievement.name.toUpperCase() ==
            achievementData.name.toUpperCase()
          );
        }
      );

      const icongray = achievementData.icongray.endsWith("/")
        ? achievementData.icon
        : achievementData.icongray;

      if (unlockedAchievementData) {
        return {
          ...achievementData,
          unlocked: true,
          unlockTime: unlockedAchievementData.unlockTime,
          imageUrl:
            souvenirImages.get(achievementData.name.trim().toUpperCase()) ??
            null,
        };
      }

      const progressData = achievementProgress.find(
        (p) => p.name.toUpperCase() === achievementData.name.toUpperCase()
      );

      return {
        ...achievementData,
        unlocked: false,
        unlockTime: null,
        icongray: icongray,
        ...(progressData && {
          progress: { current: progressData.current, max: progressData.max },
        }),
        description:
          !achievementData.hidden || showHiddenAchievementsDescription
            ? achievementData.description
            : undefined,
      };
    })
    .sort((a, b) => {
      if (a.unlocked && !b.unlocked) return -1;
      if (!a.unlocked && b.unlocked) return 1;
      if (a.unlocked && b.unlocked) {
        return b.unlockTime! - a.unlockTime!;
      }
      return Number(a.hidden) - Number(b.hidden);
    });
};

const getUnlockedAchievementsEvent = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop
): Promise<UserAchievement[]> => {
  await AchievementWatcherManager.firstSyncWithRemoteIfNeeded(shop, objectId);
  return getUnlockedAchievements(objectId, shop, false);
};

registerEvent("getUnlockedAchievements", getUnlockedAchievementsEvent);
