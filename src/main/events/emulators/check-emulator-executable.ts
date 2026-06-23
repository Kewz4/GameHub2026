import { registerEvent } from "../register-event";
import { emulators } from "@main/services";

const checkEmulatorExecutable = async (
  _event: Electron.IpcMainInvokeEvent,
  executablePath: string
) => emulators.isValidEmulatorExecutable(executablePath);

registerEvent("checkEmulatorExecutable", checkEmulatorExecutable);
