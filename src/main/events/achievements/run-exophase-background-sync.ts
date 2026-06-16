import { registerEvent } from "../register-event";
import { runExophaseBackgroundSync } from "@main/services/achievements/exophase";
import { WindowManager } from "@main/services/window-manager";

const runExophaseBackgroundSyncEvent = async (
  _event: Electron.IpcMainInvokeEvent
): Promise<{ ok: boolean }> => {
  await runExophaseBackgroundSync((progress) => {
    WindowManager.sendToAppWindows("on-exophase-sync-progress", progress);
  });
  return { ok: true };
};

registerEvent("runExophaseBackgroundSync", runExophaseBackgroundSyncEvent);
