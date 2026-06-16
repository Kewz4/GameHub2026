import { registerEvent } from "../register-event";
import {
  syncExophaseAchievements as runSync,
  type ExophaseSyncResult,
} from "@main/services/achievements/exophase";
import { withSyncBroadcast } from "./exophase-sync-broadcast";

const syncExophaseAchievements = (
  _event: Electron.IpcMainInvokeEvent
): Promise<ExophaseSyncResult> =>
  withSyncBroadcast((onProgress) => runSync(onProgress));

registerEvent("syncExophaseAchievements", syncExophaseAchievements);

/** Internal entry point so background sync (main-loop / post-connect) can run
 *  the same import without an IPC round-trip. */
export const syncExophaseAchievementsInternal =
  (): Promise<ExophaseSyncResult> =>
    withSyncBroadcast((onProgress) => runSync(onProgress));
