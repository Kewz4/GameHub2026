import { db, levelKeys } from "@main/level";
import type { ExophaseSyncReport } from "@types";
import { achievementsLogger } from "@main/services/logger";
import { WindowManager } from "@main/services/window-manager";
import { LocalNotificationManager } from "@main/services/notifications/local-notifications";
import { getPrefs, pullSharedCache, pushSharedCache } from "./exophase-cache";
import { syncExophaseAccount } from "./exophase-importer";

let running = false;

/**
 * The background achievement pass. Runs on startup and every 2 hours:
 *   1. pull the shared definition/unlock cache from R2 (fast, network-free apply)
 *   2. run the account-driven sync: enumerate the user's Exophase games, match
 *      them to the Hydra catalogue, and apply/cache achievements
 *   3. push the refreshed cache back to R2 and raise the "Achievements Sync
 *      finished" notification when anything newly unlocked
 *
 * No-ops cleanly when Exophase isn't connected/enabled.
 */
export const runExophaseBackgroundSync = async (
  onProgress?: (p: { current: number; total: number; title: string }) => void
): Promise<void> => {
  if (running) return;

  const prefs = await getPrefs();
  if (!prefs?.exophaseUserId) return;
  if (prefs.exophaseEnabled === false) return;

  running = true;
  try {
    // 1. Merge the community cache (also lights up matching library games).
    await pullSharedCache().catch(() => 0);

    // 2. Account-driven sync — PC storefronts only (PSN is a separate import).
    const result = await syncExophaseAccount(
      (p) => onProgress?.({ current: p.current, total: p.total, title: p.title }),
      "pc"
    );

    // 3. Share the refreshed cache.
    await pushSharedCache().catch(() => {});

    const report: ExophaseSyncReport = result.report ?? {
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      gamesProcessed: result.gamesProcessed,
      gamesUpdated: 0,
      totalNewlyUnlocked: 0,
      games: [],
      psnDetected: [],
    };

    await db
      .put(levelKeys.exophaseSyncReport, report, { valueEncoding: "json" })
      .catch(() => {});

    WindowManager.sendToAppWindows("on-library-batch-complete");

    if (report.gamesUpdated > 0) {
      await LocalNotificationManager.createNotification(
        "ACHIEVEMENTS_SYNC_COMPLETE",
        "Achievements Sync finished",
        `${report.totalNewlyUnlocked} new achievement${
          report.totalNewlyUnlocked !== 1 ? "s" : ""
        } across ${report.gamesUpdated} game${
          report.gamesUpdated !== 1 ? "s" : ""
        }`,
        { url: "/achievements-sync" }
      ).catch(() => {});
    }

    achievementsLogger.log(
      `[Exophase bg] complete: ${report.gamesUpdated} updated, ${report.totalNewlyUnlocked} new`
    );
  } finally {
    running = false;
  }
};
