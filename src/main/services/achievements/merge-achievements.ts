import type {
  AchievementNotificationInfo,
  Game,
  GameShop,
  UnlockedAchievement,
  UserPreferences,
} from "@types";
import { WindowManager } from "../window-manager";
import { getUnlockedAchievements } from "@main/events/user/get-unlocked-achievements";
import { publishNewAchievementNotification } from "../notifications";
import { achievementsLogger } from "../logger";
import { db, gameAchievementsSublevel, levelKeys } from "@main/level";
import { getGameAchievementData } from "./get-game-achievement-data";
import { AchievementWatcherManager } from "./achievement-watcher-manager";
import {
  achievementPayloadFingerprint,
  canonicalizeUnlockedAchievements,
  getNewUnlockedAchievements,
} from "./achievement-sync-policy";
import { syncAchievementsToHydraCloud } from "./achievement-cloud-sync";
import { AchievementSouvenirService } from "./achievement-souvenir-service";
import { supportsDesktopGameCapture } from "../desktop-capture-capability";

const isRareAchievement = (points: number) => {
  const rawPercentage = (50 - Math.sqrt(points)) * 2;

  return rawPercentage < 10;
};

const saveAchievementsOnLocal = async (
  objectId: string,
  shop: GameShop,
  unlockedAchievements: UnlockedAchievement[],
  sendUpdateEvent: boolean
) => {
  const levelKey = levelKeys.game(shop, objectId);

  // Use null fallback so a missing key doesn't cause the entire save to silently
  // fail (LevelDB throws NotFound which would reject the promise chain).
  const gameAchievement = await gameAchievementsSublevel
    .get(levelKey)
    .catch(() => null);
  const canonicalUnlocked = canonicalizeUnlockedAchievements(
    gameAchievement?.achievements,
    unlockedAchievements
  );

  return gameAchievementsSublevel
    .put(levelKey, {
      ...gameAchievement,
      achievements: gameAchievement?.achievements ?? [],
      unlockedAchievements: canonicalUnlocked,
      updatedAt: gameAchievement?.updatedAt,
      language: gameAchievement?.language,
    })
    .then(async () => {
      if (!sendUpdateEvent) return;

      return getUnlockedAchievements(objectId, shop, true)
        .then((achievements) => {
          WindowManager.mainWindow?.webContents.send(
            `on-update-achievements-${objectId}-${shop}`,
            achievements
          );
        })
        .catch(() => {});
    });
};

export const mergeAchievements = async (
  game: Game,
  achievements: UnlockedAchievement[],
  publishNotification: boolean
) => {
  const gameKey = levelKeys.game(game.shop, game.objectId);

  let localGameAchievement = await gameAchievementsSublevel
    .get(gameKey)
    .catch(() => null);
  const userPreferences = await db.get<string, UserPreferences>(
    levelKeys.userPreferences,
    {
      valueEncoding: "json",
    }
  );

  if (!localGameAchievement) {
    await getGameAchievementData(game.objectId, game.shop, false);
    localGameAchievement = await gameAchievementsSublevel.get(gameKey);
  }

  // Exophase is the authoritative source for any game it has imported. Its
  // achievements use Exophase apiNames, so the local-file watcher and remote
  // sync (Steam apiNames) must not merge into or overwrite this record.
  if (localGameAchievement?.source === "exophase") {
    await AchievementWatcherManager.markGameSynced(gameKey, game.remoteId);
    return 0;
  }

  const achievementsData = localGameAchievement?.achievements ?? [];
  const storedUnlockedAchievements =
    localGameAchievement?.unlockedAchievements ?? [];
  const unlockedAchievements = canonicalizeUnlockedAchievements(
    achievementsData,
    storedUnlockedAchievements
  );
  const newAchievements = getNewUnlockedAchievements(
    achievementsData,
    unlockedAchievements,
    achievements
  );
  const mergedLocalAchievements = canonicalizeUnlockedAchievements(
    achievementsData,
    [...unlockedAchievements, ...achievements]
  );
  const localRecordNeedsRepair =
    achievementPayloadFingerprint(storedUnlockedAchievements) !==
    achievementPayloadFingerprint(unlockedAchievements);

  const souvenirRecordKeys: string[] = [];
  if (
    newAchievements.length > 0 &&
    publishNotification &&
    supportsDesktopGameCapture(process.platform) &&
    userPreferences.enableAchievementSouvenirs === true
  ) {
    for (const unlocked of newAchievements) {
      const definition = achievementsData.find(
        (candidate) =>
          candidate.name.toUpperCase() === unlocked.name.toUpperCase()
      );
      if (!definition) continue;
      try {
        const recordKey = await AchievementSouvenirService.capture(
          game,
          definition,
          unlocked.unlockTime
        );
        if (recordKey) souvenirRecordKeys.push(recordKey);
      } catch (error) {
        achievementsLogger.warn(
          "Failed to capture achievement souvenir",
          game.objectId,
          unlocked.name,
          error
        );
      }
    }
  }

  if (
    newAchievements.length &&
    publishNotification &&
    userPreferences.achievementNotificationsEnabled !== false
  ) {
    const filteredAchievements = newAchievements
      .toSorted((a, b) => {
        return a.unlockTime - b.unlockTime;
      })
      .map((achievement) => {
        return achievementsData.find((steamAchievement) => {
          return (
            achievement.name.toUpperCase() ===
            steamAchievement.name.toUpperCase()
          );
        });
      })
      .filter((achievement) => !!achievement);

    const achievementsInfo: AchievementNotificationInfo[] =
      filteredAchievements.map((achievement, index) => {
        return {
          title: achievement.displayName,
          description: achievement.description,
          points: achievement.points,
          isHidden: achievement.hidden,
          isRare: achievement.points
            ? isRareAchievement(achievement.points)
            : false,
          isPlatinum:
            index === filteredAchievements.length - 1 &&
            newAchievements.length + unlockedAchievements.length ===
              achievementsData.length,
          iconUrl: achievement.icon,
        };
      });

    achievementsLogger.log(
      "Publishing achievement notification",
      game.objectId,
      game.title
    );

    const customEnabled =
      userPreferences.achievementCustomNotificationsEnabled !== false &&
      process.platform !== "darwin";

    const position =
      userPreferences.achievementCustomNotificationPosition ?? "top-left";

    const publishOsNotification = () =>
      publishNewAchievementNotification({
        achievements: achievementsInfo,
        unlockedAchievementCount: mergedLocalAchievements.length,
        totalAchievementCount: achievementsData.length,
        gameTitle: game.title,
        gameIcon: game.iconUrl,
      });

    if (
      process.platform === "linux" &&
      !supportsDesktopGameCapture(process.platform)
    ) {
      const shownInApp =
        customEnabled &&
        WindowManager.sendAchievementToFocusedWindow(
          position,
          achievementsInfo
        );

      if (!shownInApp) {
        publishOsNotification();
      }
    } else {
      const shownInOverlay =
        customEnabled &&
        (await WindowManager.showAchievementNotification(
          position,
          achievementsInfo
        ));

      if (!shownInOverlay) {
        publishOsNotification();
      }
    }
  }

  // Upload begins only after the notification is published, keeping GameHub's
  // own toast out of the captured frame and network latency off its hot path.
  for (const recordKey of souvenirRecordKeys) {
    void AchievementSouvenirService.sync(recordKey);
  }

  const shouldSyncWithRemote =
    game.shop !== "custom" &&
    (newAchievements.length || AchievementWatcherManager.hasFinishedPreSearch);

  if (shouldSyncWithRemote) {
    const syncResult = await syncAchievementsToHydraCloud({
      remoteId: game.remoteId,
      shop: game.shop,
      objectId: game.objectId,
      achievements: mergedLocalAchievements,
    });

    const serverAchievements = syncResult.response?.achievements ?? [];
    const persistedAchievements = canonicalizeUnlockedAchievements(
      achievementsData,
      [...syncResult.achievements, ...serverAchievements]
    );

    // Always persist under the LOCAL game identity. A canonical server response
    // may identify the same title under another shop; writing that identity here
    // creates a second achievement record and duplicate profile rows.
    await saveAchievementsOnLocal(
      game.objectId,
      game.shop,
      persistedAchievements,
      publishNotification
    );

    if (
      syncResult.status === "synced" ||
      syncResult.status === "unchanged" ||
      syncResult.status === "no-remote-id"
    ) {
      await AchievementWatcherManager.markGameSynced(gameKey, game.remoteId);
    }
  } else if (newAchievements.length || localRecordNeedsRepair) {
    await saveAchievementsOnLocal(
      game.objectId,
      game.shop,
      mergedLocalAchievements,
      publishNotification
    );
  }

  return newAchievements.length;
};
