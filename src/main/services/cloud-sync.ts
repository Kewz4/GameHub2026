import { db, levelKeys } from "@main/level";
import type { UserPreferences } from "@types";

import { R2Sync } from "./r2-sync";

/** Account namespace compatibility retained for the R2-backed V2 engine. */
export class CloudSync {
  /**
   * Return the active Cloud Save namespace. Fresh installs receive a random
   * namespace until authenticated account preparation promotes it safely.
   */
  public static async getOrCreateUserId(): Promise<string> {
    const preferences = await db
      .get<string, UserPreferences>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => ({}) as UserPreferences);

    let userId = preferences.cloudSyncUserId;
    if (!userId) {
      userId = R2Sync.generateUserId();
      await db.put(
        levelKeys.userPreferences,
        { ...preferences, cloudSyncUserId: userId },
        { valueEncoding: "json" }
      );
    }
    return userId;
  }
}
