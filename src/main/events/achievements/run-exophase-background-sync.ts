import { registerEvent } from "../register-event";
import { runExophaseBackgroundSync } from "@main/services/achievements/exophase";
import { withSyncBroadcast } from "./exophase-sync-broadcast";

const runExophaseBackgroundSyncEvent = async (
  _event: Electron.IpcMainInvokeEvent
): Promise<{ ok: boolean }> => {
  await withSyncBroadcast((onProgress) =>
    runExophaseBackgroundSync(onProgress)
  );
  return { ok: true };
};

registerEvent("runExophaseBackgroundSync", runExophaseBackgroundSyncEvent);
