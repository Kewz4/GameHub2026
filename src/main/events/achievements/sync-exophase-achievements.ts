import { registerEvent } from "../register-event";
import { WindowManager } from "@main/services/window-manager";
import {
  syncExophaseAchievements as runSync,
  type ExophaseSyncResult,
} from "@main/services/achievements/exophase";

const syncExophaseAchievements = (
  _event: Electron.IpcMainInvokeEvent
): Promise<ExophaseSyncResult> =>
  runSync((progress) => {
    WindowManager.sendToAppWindows("on-exophase-sync-progress", progress);
  });

registerEvent("syncExophaseAchievements", syncExophaseAchievements);

/** Internal entry point so background sync (main-loop / post-connect) can run
 *  the same import without an IPC round-trip. */
export const syncExophaseAchievementsInternal =
  (): Promise<ExophaseSyncResult> =>
    runSync((progress) => {
      WindowManager.sendToAppWindows("on-exophase-sync-progress", progress);
    });
