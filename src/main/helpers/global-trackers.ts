import { db, levelKeys } from "@main/level";
import { resolveConfiguredGlobalTrackers } from "@shared";
import type { UserPreferences } from "@types";

/**
 * Read the local, explicitly enabled tracker list. This never fetches a remote
 * list: tracker URLs are supplied by the user and passed only to libtorrent.
 */
export const getGlobalTrackers = async (): Promise<string[]> => {
  const userPreferences = await db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);

  return resolveConfiguredGlobalTrackers(userPreferences);
};
