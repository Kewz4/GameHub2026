import { sleep } from "@main/helpers";
import { DownloadManager } from "./download";
import { gamesPlaytime, watchProcesses } from "./process-watcher";
import { AchievementWatcherManager } from "./achievements/achievement-watcher-manager";
import { UpdateManager } from "./update-manager";
import { INTERVALS } from "@main/constants";
import { PowerSaveBlockerManager } from "./power-save-blocker";
import { logger } from "./logger";
import { db, levelKeys } from "@main/level";
import type { UserPreferences } from "@types";

const wrapInLoop = (fn: () => unknown, interval: number) => {
  const loop = async () => {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        await fn();
      } catch (error) {
        logger.error(
          `Error in loop: ${error instanceof Error ? error.stack : String(error)}`
        );
      }

      await sleep(interval);
    }
  };
  loop();
};

export const syncAllLibraries = async () => {
  const prefs = await db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);

  const tasks: Promise<unknown>[] = [];

  if (prefs?.steamId) {
    tasks.push(
      import("@main/events/library/sync-steam-library")
        .then((m) =>
          m.syncSteamLibraryInternal(
            prefs.steamId!,
            prefs.steamApiKey ?? undefined
          )
        )
        .catch((e) => logger.error("Steam library sync failed", e))
    );
  }

  tasks.push(
    import("@main/events/library/sync-epic-library")
      .then((m) => m.syncEpicLibraryInternal())
      .catch((e) => logger.error("Epic library sync failed", e))
  );

  if (prefs?.gogRefreshToken) {
    tasks.push(
      import("@main/events/library/sync-gog-library")
        .then((m) => m.syncGogLibraryInternal())
        .catch((e) => logger.error("GOG library sync failed", e))
    );
  }

  if (prefs?.xboxXstsToken) {
    tasks.push(
      import("@main/events/library/sync-gamepass-library")
        .then((m) => m.syncGamePassLibraryInternal())
        .catch((e) => logger.error("GamePass library sync failed", e))
    );
  }

  await Promise.allSettled(tasks);
};

export const startMainLoop = async () => {
  wrapInLoop(() => watchProcesses(), INTERVALS.processWatcher);
  wrapInLoop(() => DownloadManager.watchDownloads(), INTERVALS.downloadWatcher);
  wrapInLoop(
    () => AchievementWatcherManager.watchAchievements(),
    INTERVALS.achievementWatcher
  );
  wrapInLoop(
    () => DownloadManager.getSeedStatus(),
    INTERVALS.seedStatusWatcher
  );
  wrapInLoop(() => UpdateManager.checkForUpdates(), INTERVALS.updateChecker);
  wrapInLoop(() => syncAllLibraries(), INTERVALS.librarySync);

  // Exophase achievement cache: refresh on startup and every 2 hours. Pulls the
  // shared R2 cache, credits newly-unlocked achievements, flags PSN games, and
  // raises the "Achievements Sync finished" notification.
  wrapInLoop(async () => {
    const { runExophaseBackgroundSync } = await import(
      "./achievements/exophase/exophase-background-sync"
    );
    await runExophaseBackgroundSync();
  }, INTERVALS.exophaseSync);

  wrapInLoop(() => {
    PowerSaveBlockerManager.syncState({
      downloadActive: DownloadManager.hasActiveDownload(),
      compatibilityGameActive:
        PowerSaveBlockerManager.hasRunningCompatibilityGame(
          gamesPlaytime.keys()
        ),
    });
  }, INTERVALS.powerSaveBlockerSync);
};
