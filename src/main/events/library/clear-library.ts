import { registerEvent } from "../register-event";
import { gamesSublevel } from "@main/level";
import { WindowManager } from "@main/services/window-manager";
import { logger } from "@main/services/logger";

const clearLibrary = async (_event: Electron.IpcMainInvokeEvent) => {
  const entries = await gamesSublevel
    .iterator()
    .all()
    .catch(() => []);
  let cleared = 0;
  for (const [key, game] of entries) {
    if (game && !game.isDeleted) {
      // Mirror remove-game-from-library: clear executablePath too. Otherwise a
      // later deep scan / re-sync would treat the stale path as "already
      // resolved" and skip the game, so a wiped-then-rescanned library would
      // report "no new games found".
      await gamesSublevel
        .put(key, { ...game, isDeleted: true, executablePath: null })
        .catch(() => {});
      cleared++;
    }
  }
  logger.info(`[clearLibrary] Marked ${cleared} games as deleted`);
  WindowManager.sendToAppWindows("on-library-batch-complete");
  return { cleared };
};

registerEvent("clearLibrary", clearLibrary);
