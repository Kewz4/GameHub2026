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
/**
 * Live snapshot of the current sync so a window opened mid-sync can render the
 * progress immediately (via `getExophaseSyncState`) instead of waiting up to a
 * few seconds for the next streamed event.
 */
let currentActive = false;
let lastProgress: ExophaseSyncProgress | null = null;

export const getSyncSnapshot = (): {
  active: boolean;
  progress: ExophaseSyncProgress | null;
} => ({ active: currentActive, progress: lastProgress });

export const broadcastSyncActive = (active: boolean): void => {
  currentActive = active;
  if (!active) lastProgress = null;
  WindowManager.sendToAppWindows("on-exophase-sync-active", { active });
};

export const broadcastSyncProgress = (progress: ExophaseSyncProgress): void => {
  currentActive = true;
  lastProgress = progress;
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
