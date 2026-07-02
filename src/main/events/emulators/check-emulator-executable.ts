import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import type { EmulatorSystem } from "@types";

/**
 * Whether the emulator configured for a system still has a valid executable on
 * disk. Callers pass the *system* (not a path) and read `{ exists }`; the
 * handler resolves the stored executablePath itself. (Previously it treated the
 * argument as a path and returned a bare boolean, so the renderer's
 * `{ exists }` was always undefined → every configured emulator wrongly showed
 * "executable missing / setup needed".)
 */
const checkEmulatorExecutable = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem
): Promise<{ exists: boolean }> => {
  const config = await emulators.getEmulatorConfig(system);
  return {
    exists: config.executablePath
      ? emulators.isValidEmulatorExecutable(config.executablePath)
      : false,
  };
};

registerEvent("checkEmulatorExecutable", checkEmulatorExecutable);
