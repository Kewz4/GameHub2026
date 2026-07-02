import { registerEvent } from "../register-event";
import { loginRetroAchievements as raLogin } from "@main/services/achievements/retroachievements/ra-api";

/**
 * Exchange a RetroAchievements username + password for a login token. The
 * password is used only for this request and is never stored; the renderer
 * persists the returned token via updateUserPreferences, and it's later written
 * into RALibretro's RAPrefs during setup so the emulator signs in silently.
 */
const loginRetroAchievements = async (
  _event: Electron.IpcMainInvokeEvent,
  username: string,
  password: string
): Promise<{ success: boolean; token?: string; error?: string }> => {
  const result = await raLogin(username, password);
  return result.success
    ? { success: true, token: result.token }
    : { success: false, error: result.error };
};

registerEvent("loginRetroAchievements", loginRetroAchievements);
