import { registerEvent } from "../register-event";
import { emulators } from "@main/services";

/**
 * Push the stored RetroAchievements login into an already-installed RALibretro
 * so signing in through GameHub takes effect immediately, without a reinstall.
 */
const syncRalibretroLogin = async (
  _event: Electron.IpcMainInvokeEvent
): Promise<boolean> => emulators.syncRalibretroLogin();

registerEvent("syncRalibretroLogin", syncRalibretroLogin);
