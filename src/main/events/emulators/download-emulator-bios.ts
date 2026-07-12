import { registerEvent } from "../register-event";
import { emulators, WindowManager } from "@main/services";
import type { EmulatorSystem } from "@types";

const downloadEmulatorBios = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem
) =>
  emulators.downloadEmulatorBios(system, (progress) => {
    WindowManager.sendToAppWindows("on-bios-download-progress", progress);
  });

registerEvent("downloadEmulatorBios", downloadEmulatorBios);
