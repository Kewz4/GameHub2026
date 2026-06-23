import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import type { EmulatorSystem } from "@types";

const getEmulatorInstallOptions = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem
) => emulators.getEmulatorInstallOptions(system);

registerEvent("getEmulatorInstallOptions", getEmulatorInstallOptions);
