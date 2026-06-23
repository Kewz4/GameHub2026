import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import type { EmulatorSystem } from "@types";

const removeEmulator = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem
) => {
  return emulators.updateEmulatorConfig(system, (cfg) => ({
    ...cfg,
    executablePath: null,
    detectedVersion: null,
    detectedAt: null,
  }));
};

registerEvent("removeEmulator", removeEmulator);
