import { WindowManager } from "@main/services/window-manager";
import type { ExophaseSyncProgress } from "@main/services/achievements/exophase";

/**
 * Shared broadcaster for Exophase sync activity. Every sync entry point (manual
 * "Sync now", PSN import, background sync) routes through this so that ANY open
 * window — the onboarding flow, the Achievements Sync report page, settings —
 * can subscribe to the SAME live progress, regardless of which one kicked it off.
 *
 * It emits:
 *   - `on-exophase-sync-active`   { active: boolean }  — start/stop signal
 *   - `on-exophase-sync-progress` { current, total, … } — per-game progress
 */
export const broadcastSyncActive = (active: boolean): void => {
  WindowManager.sendToAppWindows("on-exophase-sync-active", { active });
};

export const broadcastSyncProgress = (progress: ExophaseSyncProgress): void => {
  WindowManager.sendToAppWindows("on-exophase-sync-progress", progress);
};

/**
 * Wraps a sync run with start/finish "active" broadcasts so late subscribers
 * (e.g. the report page opened mid-sync) get a crisp begin/end signal in
 * addition to the streaming progress events.
 */
export const withSyncBroadcast = async <T>(
  run: (onProgress: (p: ExophaseSyncProgress) => void) => Promise<T>
): Promise<T> => {
  broadcastSyncActive(true);
  try {
    return await run(broadcastSyncProgress);
  } finally {
    broadcastSyncActive(false);
  }
};
