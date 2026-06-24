import { registerEvent } from "../register-event";
import {
  syncExophaseAchievements as runSync,
  type ExophaseSyncResult,
} from "@main/services/achievements/exophase";
import { withSyncBroadcast } from "./exophase-sync-broadcast";
import { runCloudDebuggerInternal } from "@main/events/library/run-cloud-debugger";

const runAndDebug = async (
  onProgress: Parameters<typeof runSync>[0]
): Promise<ExophaseSyncResult> => {
  const result = await runSync(onProgress);
  if (
    (result.report?.totalNewlyUnlocked ?? 0) > 0 ||
    result.totalUnlocked > 0
  ) {
    await runCloudDebuggerInternal();
  }
  return result;
};

const syncExophaseAchievements = (
  _event: Electron.IpcMainInvokeEvent
): Promise<ExophaseSyncResult> =>
  withSyncBroadcast((onProgress) => runAndDebug(onProgress));

registerEvent("syncExophaseAchievements", syncExophaseAchievements);

/** Internal entry point so background sync (main-loop / post-connect) can run
 *  the same import without an IPC round-trip. */
export const syncExophaseAchievementsInternal =
  (): Promise<ExophaseSyncResult> =>
    withSyncBroadcast((onProgress) => runAndDebug(onProgress));
