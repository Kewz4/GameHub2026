import fs from "node:fs";
import type { User } from "@types";
import { achievementSouvenirsSublevel, db, levelKeys } from "@main/level";
import { AchievementScreenshotService } from "../achievement-screenshot";
import { achievementsLogger } from "../logger";
import { R2Sync } from "../r2-sync";
import { AchievementSouvenirLifecycle } from "./achievement-souvenir-lifecycle";

const lifecycle = new AchievementSouvenirLifecycle({
  store: {
    get: async (key) => {
      const record = await achievementSouvenirsSublevel.get(key);
      if (!record) throw new Error("achievement_souvenir_not_found");
      return record;
    },
    put: (key, record) => achievementSouvenirsSublevel.put(key, record),
    values: () => achievementSouvenirsSublevel.values().all(),
  },
  remote: {
    upload: (record, filePath) =>
      R2Sync.uploadAchievementSouvenir(record, filePath),
    list: (ownerId, game) => R2Sync.listAchievementSouvenirs(ownerId, game),
    cache: (record) => R2Sync.cacheAchievementSouvenir(record),
    delete: (ownerId, key) => R2Sync.deleteAchievementSouvenir(ownerId, key),
  },
  screenshots: {
    capture: (ownerId, game, achievement) =>
      AchievementScreenshotService.capture(ownerId, game, achievement),
    reconcilePersistedPath: (ownerId, filePath) =>
      AchievementScreenshotService.reconcilePersistedPath(ownerId, filePath),
    delete: (ownerId, filePath) =>
      AchievementScreenshotService.delete(ownerId, filePath),
    cleanup: (ownerId, protectedPaths) =>
      AchievementScreenshotService.cleanup(ownerId, protectedPaths),
  },
  currentOwnerId: () =>
    db
      .get<string, User>(levelKeys.user, { valueEncoding: "json" })
      .then((user) => user?.id ?? null)
      .catch(() => null),
  fileExists: fs.existsSync,
  now: Date.now,
  warn: (message, error) => achievementsLogger.warn(message, error),
});

/** Production facade retained for existing achievement watchers and IPC. */
export class AchievementSouvenirService {
  static capture: AchievementSouvenirLifecycle["capture"] =
    lifecycle.capture.bind(lifecycle);
  static sync: AchievementSouvenirLifecycle["sync"] =
    lifecycle.sync.bind(lifecycle);
  static getGameImages: AchievementSouvenirLifecycle["getGameImages"] =
    lifecycle.getGameImages.bind(lifecycle);
  static listProfile: AchievementSouvenirLifecycle["listProfile"] =
    lifecycle.listProfile.bind(lifecycle);
  static delete: AchievementSouvenirLifecycle["delete"] =
    lifecycle.delete.bind(lifecycle);
}
