import { registerEvent } from "../register-event";

import type { UserPreferences } from "@types";
import i18next from "i18next";
import { defaultDownloadsPath } from "@main/constants";
import { db, levelKeys } from "@main/level";
import { patchUserProfile } from "../profile/update-profile";
import { DownloadManager } from "@main/services";
import { WindowManager } from "@main/services/window-manager";
import { getDownloadDirectoryPreferences } from "@shared";

const updateUserPreferences = async (
  _event: Electron.IpcMainInvokeEvent,
  preferences: Partial<UserPreferences>
) => {
  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    { valueEncoding: "json" }
  );

  if (preferences.language) {
    await db.put<string, string>(levelKeys.language, preferences.language, {
      valueEncoding: "utf8",
    });

    i18next.changeLanguage(preferences.language);
    patchUserProfile({ language: preferences.language }).catch(() => {});
  }

  const mergedPreferences = {
    ...userPreferences,
    ...preferences,
  };
  const normalizedDownloadDirectoryPreferences =
    getDownloadDirectoryPreferences(mergedPreferences, defaultDownloadsPath);

  // Preserve downloadsPath: normalization may return null if the path matches
  // the system Downloads folder exactly, but we want to keep whatever the user
  // explicitly saved (even if it equals the default — getDownloadsPath will
  // fall back to the system default only when the value is null/undefined).
  const preservedDownloadsPath =
    normalizedDownloadDirectoryPreferences.downloadsPath ??
    mergedPreferences.downloadsPath ??
    null;

  const updatedPreferences = {
    ...mergedPreferences,
    ...normalizedDownloadDirectoryPreferences,
    downloadsPath: preservedDownloadsPath,
  };

  await db.put<string, UserPreferences>(
    levelKeys.userPreferences,
    updatedPreferences,
    {
      valueEncoding: "json",
    }
  );

  WindowManager.sendToAppWindows(
    "on-user-preferences-updated",
    updatedPreferences
  );

  if (Object.hasOwn(preferences, "maxDownloadSpeedBytesPerSecond")) {
    await DownloadManager.applyDownloadSpeedLimit(
      preferences.maxDownloadSpeedBytesPerSecond ?? null
    );
  }

  // Best-effort cloud backup so settings survive reinstalls
  import("./backup-settings-to-cloud")
    .then((m) => m.backupSettingsToCloudInternal())
    .catch(() => {});
};

registerEvent("updateUserPreferences", updateUserPreferences);
