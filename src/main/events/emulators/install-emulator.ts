import { registerEvent } from "../register-event";
import { emulators, WindowManager } from "@main/services";
import type { EmulatorBinary, EmulatorInstallProgress } from "@types";

const installEmulator = async (
  _event: Electron.IpcMainInvokeEvent,
  binary: EmulatorBinary,
  optionId: string
) =>
  emulators.installEmulator(
    binary,
    optionId,
    (progress: EmulatorInstallProgress) => {
      WindowManager.sendToAppWindows("on-emulator-install-progress", progress);
    }
  );

registerEvent("installEmulator", installEmulator);
