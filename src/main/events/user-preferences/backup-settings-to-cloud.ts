import { registerEvent } from "../register-event";
import { db, levelKeys } from "@main/level";
import { HydraApi } from "@main/services/hydra-api";
import { R2Sync } from "@main/services/r2-sync";
import { logger } from "@main/services";
import type { UserPreferences, ExcludedGame, UserProfile } from "@types";

// Fields that are safe to sync — exclude machine-specific paths and auth tokens
const SAFE_PREFS_KEYS: (keyof UserPreferences)[] = [
  "language",
  "preferQuitInsteadOfHiding",
  "runAtStartup",
  "startMinimized",
  "launchToLibraryPage",
  "disableNsfwAlert",
  "seedAfterDownloadComplete",
  "showHiddenAchievementsDescription",
  "showDownloadSpeedInMegabits",
  "downloadNotificationsEnabled",
  "repackUpdatesNotificationsEnabled",
  "achievementNotificationsEnabled",
  "achievementCustomNotificationsEnabled",
  "achievementCustomNotificationPosition",
  "achievementSoundVolume",
  "friendRequestNotificationsEnabled",
  "friendStartGameNotificationsEnabled",
  "showDownloadSpeedInMegabytes",
  "enableSteamAchievements",
  "autoplayGameTrailers",
  "hideToTrayOnGameStart",
  "enableNewDownloadOptionsBadges",
  "createStartMenuShortcut",
  "autoRunMangohud",
  "autoRunGamemode",
  "enableAutoInstall",
  "extractFilesByDefault",
  "deleteArchiveFilesAfterExtractionByDefault",
  "launchInBigPicture",
  "excludedGames",
];

export interface SettingsBackup {
  preferences: Partial<UserPreferences>;
  excludedGames: ExcludedGame[];
  backupVersion: number;
  updatedAt: string;
}

const backupSettingsToCloud = async (): Promise<{ ok: boolean }> => {
  const prefs = await db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);

  const safePrefs: Partial<UserPreferences> = {};
  for (const key of SAFE_PREFS_KEYS) {
    if (key in (prefs ?? {}) && key !== "excludedGames") {
      (safePrefs as any)[key] = (prefs as any)[key];
    }
  }

  const backup: SettingsBackup = {
    preferences: safePrefs,
    excludedGames: prefs?.excludedGames ?? [],
    backupVersion: 1,
    updatedAt: new Date().toISOString(),
  };

  try {
    const me = await HydraApi.get<UserProfile>("/profile/me").catch(() => null);
    if (!me?.id) {
      logger.warn("[SettingsSync] Not signed in — skipping backup");
      return { ok: false };
    }
    await R2Sync.uploadPreferences(me.id, JSON.stringify(backup));
    logger.info("[SettingsSync] Backup pushed to R2");
    return { ok: true };
  } catch (err) {
    logger.warn("[SettingsSync] Cloud backup failed", err);
    return { ok: false };
  }
};

registerEvent("backupSettingsToCloud", backupSettingsToCloud);

export { backupSettingsToCloud as backupSettingsToCloudInternal };
