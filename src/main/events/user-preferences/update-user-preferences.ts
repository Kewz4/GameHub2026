import { registerEvent } from "../register-event";

import type { UserPreferences } from "@types";
import i18next from "i18next";
import { BrowserWindow } from "electron";
import { defaultDownloadsPath } from "@main/constants";
import { db, levelKeys } from "@main/level";
import { patchUserProfile } from "../profile/update-profile";
import { DownloadManager } from "@main/services";
import { OverlayManager } from "@main/services/overlay-manager";
import { getDownloadDirectoryPreferences } from "@shared";
import { enqueueUserPreferencesMutation } from "./user-preferences-mutation-queue";
import { normalizeGlobalTrackerPreferencePatch } from "./global-tracker-preferences";

const updateUserPreferences = async (
  _event: Electron.IpcMainInvokeEvent,
  preferences: Partial<UserPreferences>
) => {
  const validatedPreferences =
    normalizeGlobalTrackerPreferencePatch(preferences);

  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    { valueEncoding: "json" }
  );

  if (validatedPreferences.language) {
    await db.put<string, string>(
      levelKeys.language,
      validatedPreferences.language,
      {
        valueEncoding: "utf8",
      }
    );

    i18next.changeLanguage(validatedPreferences.language);
    patchUserProfile({ language: validatedPreferences.language }).catch(
      () => {}
    );
  }

  const mergedPreferences = {
    ...userPreferences,
    ...validatedPreferences,
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

  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(
        "on-user-preferences-updated",
        updatedPreferences
      );
    }
  }

  // Apply overlay-preference changes to the active game session immediately
  // (toggle the overlay / performance HUD without needing a relaunch).
  OverlayManager.applyUserPreferences(updatedPreferences);

  if (Object.hasOwn(validatedPreferences, "maxDownloadSpeedBytesPerSecond")) {
    await DownloadManager.applyDownloadSpeedLimit(
      validatedPreferences.maxDownloadSpeedBytesPerSecond ?? null
    );
  }

  if (Object.hasOwn(validatedPreferences, "torrentNetworkInterface")) {
    await DownloadManager.applyNetworkInterface(
      validatedPreferences.torrentNetworkInterface ?? null
    );
  }

  // Best-effort cloud backup so settings survive reinstalls
  import("./backup-settings-to-cloud")
    .then((m) => m.backupSettingsToCloudInternal())
    .catch(() => {});
};

registerEvent("updateUserPreferences", (event, preferences) =>
  enqueueUserPreferencesMutation(() =>
    updateUserPreferences(event, preferences as Partial<UserPreferences>)
  )
);
