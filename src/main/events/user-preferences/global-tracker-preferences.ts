import { validateAndNormalizeTrackerUrls } from "@shared";
import type { UserPreferences } from "@types";

/** Runtime validation for the generic preferences IPC boundary. */
export const normalizeGlobalTrackerPreferencePatch = (
  preferences: Partial<UserPreferences>
): Partial<UserPreferences> => {
  const normalized = { ...preferences };

  if (Object.hasOwn(preferences, "globalTrackers")) {
    normalized.globalTrackers = validateAndNormalizeTrackerUrls(
      (preferences as { globalTrackers?: unknown }).globalTrackers
    );
  }

  if (Object.hasOwn(preferences, "appendGlobalTrackers")) {
    const appendGlobalTrackers = (
      preferences as { appendGlobalTrackers?: unknown }
    ).appendGlobalTrackers;

    if (typeof appendGlobalTrackers !== "boolean") {
      throw new TypeError("invalid_append_global_trackers");
    }

    normalized.appendGlobalTrackers = appendGlobalTrackers;
  }

  return normalized;
};
