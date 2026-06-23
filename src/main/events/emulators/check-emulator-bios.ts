import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import type { EmulatorSystem } from "@types";

const checkEmulatorBios = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem
) => {
  const config = await emulators.getEmulatorConfig(system);
  if (!config.executablePath) return false;
  return emulators.isEmulatorBiosInstalled(system, config.executablePath);
};

registerEvent("checkEmulatorBios", checkEmulatorBios);
