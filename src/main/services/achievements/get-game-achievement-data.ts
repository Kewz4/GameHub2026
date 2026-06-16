import { HydraApi } from "../hydra-api";
import type { GameAchievement, GameShop, SteamAchievement } from "@types";
import { UserNotLoggedInError } from "@shared";
import { logger } from "../logger";
import { db, gameAchievementsSublevel, levelKeys } from "@main/level";
import { AxiosError } from "axios";

const getModifiedSinceHeader = (
  cachedAchievements: GameAchievement | undefined,
  userLanguage: string
): Date | undefined => {
  if (!cachedAchievements) {
    return undefined;
  }

  if (userLanguage != cachedAchievements.language) {
    return undefined;
  }

  return cachedAchievements.updatedAt
    ? new Date(cachedAchievements.updatedAt)
    : undefined;
};

export const getGameAchievementData = async (
  objectId: string,
  shop: GameShop,
  useCachedData: boolean
) => {
  if (shop === "custom") {
    return [];
  }

  const gameKey = levelKeys.game(shop, objectId);

  const cachedAchievements = await gameAchievementsSublevel.get(gameKey);

  // Exophase is the unified achievement source. When it has imported this game,
  // its definitions and unlocked list share the same apiNames, so we must use
  // the local Exophase data for every shop — including Steam — instead of the
  // Hydra API (whose Steam apiNames would never match the unlocked list).
  if (
    cachedAchievements?.source === "exophase" &&
    cachedAchievements.achievements?.length
  ) {
    return cachedAchievements.achievements;
  }

  // Non-Steam shops store achievements locally during integration sync.
  // Always return local data for these — the Hydra API doesn't know their achievements.
  if (shop !== "steam" && cachedAchievements?.achievements) {
    return cachedAchievements.achievements;
  }

  const language = await db
    .get<string, string>(levelKeys.language, {
      valueEncoding: "utf8",
    })
    .then((language) => language || "en");

  // Only trust the cache when it was fetched in the user's CURRENT language.
  // Otherwise definitions can be stuck in a stale locale (e.g. a game whose
  // HydraAPI achievements were cached in Chinese) and we must refetch so the
  // names come back in the right language.
  if (
    cachedAchievements?.achievements &&
    useCachedData &&
    cachedAchievements.language === language
  ) {
    return cachedAchievements.achievements;
  }

  return HydraApi.get<SteamAchievement[]>(
    `/games/${shop}/${objectId}/achievements`,
    {
      language,
    },
    {
      ifModifiedSince: getModifiedSinceHeader(cachedAchievements, language),
    }
  )
    .then(async (achievements) => {
      await gameAchievementsSublevel.put(gameKey, {
        unlockedAchievements: cachedAchievements?.unlockedAchievements ?? [],
        achievements,
        updatedAt: Date.now(),
        language,
      });

      return achievements;
    })
    .catch((err) => {
      if (err instanceof UserNotLoggedInError) {
        throw err;
      }

      const isNotModified = (err as AxiosError)?.response?.status === 304;

      if (isNotModified) {
        return cachedAchievements?.achievements ?? [];
      }

      logger.error("Failed to get game achievements for", objectId, err);

      return cachedAchievements?.achievements ?? [];
    });
};
