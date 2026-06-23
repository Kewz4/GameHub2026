import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import type { EmulatorSystem } from "@types";

const getEmulatorRomExtensions = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem
) => emulators.KNOWN_BINARIES[system].romExtensions;

registerEvent("getEmulatorRomExtensions", getEmulatorRomExtensions);
