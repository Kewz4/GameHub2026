import { registerEvent } from "../register-event";
import { gamesSublevel } from "@main/level";
import { WindowManager } from "@main/services/window-manager";
import { logger } from "@main/services/logger";

const clearLibrary = async (_event: Electron.IpcMainInvokeEvent) => {
  const entries = await gamesSublevel.iterator().all().catch(() => []);
  let cleared = 0;
  for (const [key, game] of entries) {
    if (game && !game.isDeleted) {
      await gamesSublevel.put(key, { ...game, isDeleted: true }).catch(() => {});
      cleared++;
    }
  }
  logger.info(`[clearLibrary] Marked ${cleared} games as deleted`);
  WindowManager.sendToAppWindows("on-library-batch-complete");
  return { cleared };
};

registerEvent("clearLibrary", clearLibrary);
