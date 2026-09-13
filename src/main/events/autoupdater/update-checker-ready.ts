import { registerEvent } from "../register-event";
import { UpdateCheckerManager } from "@main/services/update-checker-manager";

/**
 * The splash renderer calls this once its update-event listener is subscribed,
 * so the main process can replay any events emitted before then (a fast
 * post-update check would otherwise race ahead of the listener).
 */
const updateCheckerReady = async (_event: Electron.IpcMainInvokeEvent) => {
  UpdateCheckerManager.markRendererReady();
};

registerEvent("updateCheckerReady", updateCheckerReady);
