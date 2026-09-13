import { registerEvent } from "../register-event";
import { app } from "electron";
import { db, levelKeys } from "@main/level";
import { HydraApi } from "@main/services/hydra-api";
import { R2Sync } from "@main/services/r2-sync";
import { logger } from "@main/services";
import type { UserPreferences, ExcludedGame, UserProfile } from "@types";
import { getSettingsBackupPreferences } from "./settings-backup-policy";

export interface SettingsBackup {
  preferences: Partial<UserPreferences>;
  excludedGames: ExcludedGame[];
  backupVersion: number;
  updatedAt: string;
}

let settingsBackupTail: Promise<void> = Promise.resolve();

const performSettingsBackupToCloud = async (): Promise<{ ok: boolean }> => {
  if (!app.isPackaged && process.env.GAMEHUB_READ_ONLY_VISUAL_QA === "true") {
    logger.info("[SettingsSync] Read-only visual QA — skipping R2 backup");
    return { ok: false };
  }

  const prefs = await db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);

  const backup: SettingsBackup = {
    preferences: getSettingsBackupPreferences(prefs),
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

const backupSettingsToCloud = (): Promise<{ ok: boolean }> => {
  const result = settingsBackupTail.then(
    performSettingsBackupToCloud,
    performSettingsBackupToCloud
  );
  settingsBackupTail = result.then(
    () => undefined,
    () => undefined
  );
  return result;
};

registerEvent("backupSettingsToCloud", backupSettingsToCloud);

export { backupSettingsToCloud as backupSettingsToCloudInternal };
