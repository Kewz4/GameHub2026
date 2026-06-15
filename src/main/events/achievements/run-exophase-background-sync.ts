import { registerEvent } from "../register-event";
import { runExophaseBackgroundSync } from "@main/services/achievements/exophase";

/** Manual trigger for the background cache/earned-state sync (Settings button,
 *  onboarding "set up achievements"). Resolves when the pass finishes. */
const runExophaseBackgroundSyncEvent = async (
  _event: Electron.IpcMainInvokeEvent
): Promise<{ ok: boolean }> => {
  await runExophaseBackgroundSync();
  return { ok: true };
};

registerEvent("runExophaseBackgroundSync", runExophaseBackgroundSyncEvent);
