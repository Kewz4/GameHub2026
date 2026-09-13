import type { UserPreferences } from "@types";

/** Portable, non-secret preferences that can safely follow an account. */
export const SETTINGS_BACKUP_SAFE_PREFERENCE_KEYS = [
  "language",
  "themeMode",
  "preferQuitInsteadOfHiding",
  "runAtStartup",
  "startMinimized",
  "launchToLibraryPage",
  "launchInBigPicture",
  "hideToTrayOnGameStart",
  "hideClassicsBookmark",
  "classicsUseHeroLayout",
  "bigPictureSoundsEnabled",
  "bigPictureVirtualKeyboardEnabled",
  "bigPictureDiagnosticsEnabled",
  "bigPictureDiagnosticsPosition",
  "disableNsfwAlert",
  "hideMatureGames",
  "overlayEnabled",
  "overlayPerformanceEnabled",
  "overlayPerformanceShowFps",
  "overlayPerformanceShowAverageFps",
  "overlayPerformanceShowFrameTime",
  "overlayPerformanceShowOnePercentLow",
  "gameRecorderEnabled",
  "gameRecorderResolution",
  "gameRecorderFps",
  "gameRecorderQualityPreset",
  "gameRecorderInstantReplayEnabled",
  "gameRecorderReplayDurationSeconds",
  "gameRecorderCaptureAudio",
  "enableAutoInstall",
  "seedAfterDownloadComplete",
  "showHiddenAchievementsDescription",
  "showDownloadSpeedInMegabytes",
  "maxDownloadSpeedBytesPerSecond",
  "downloadNotificationsEnabled",
  "repackUpdatesNotificationsEnabled",
  "achievementNotificationsEnabled",
  "achievementCustomNotificationsEnabled",
  "achievementCustomNotificationPosition",
  "achievementSoundVolume",
  "friendRequestNotificationsEnabled",
  "friendStartGameNotificationsEnabled",
  "extractFilesByDefault",
  "deleteArchiveFilesAfterExtractionByDefault",
  "enableSteamAchievements",
  "autoplayGameTrailers",
  "enableNewDownloadOptionsBadges",
  "createStartMenuShortcut",
  "autoRunMangohud",
  "autoRunGamemode",
  "exophaseEnabled",
  "exophaseManagedPlatforms",
  "exophaseExtraProfiles",
] as const satisfies readonly (keyof UserPreferences)[];

export function getSettingsBackupPreferences(
  preferences: UserPreferences | null | undefined
): Partial<UserPreferences> {
  const safePreferences: Partial<UserPreferences> = {};
  if (!preferences) return safePreferences;

  for (const key of SETTINGS_BACKUP_SAFE_PREFERENCE_KEYS) {
    if (Object.hasOwn(preferences, key)) {
      Object.assign(safePreferences, { [key]: preferences[key] });
    }
  }
  return safePreferences;
}
