import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import type { EmulatorSystem } from "@types";

const toggleRomFolderSubfolders = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem,
  folderId: string,
  scanSubfolders: boolean
) => {
  return emulators.updateEmulatorConfig(system, (cfg) => ({
    ...cfg,
    romFolders: cfg.romFolders.map((f) =>
      f.id === folderId ? { ...f, scanSubfolders } : f
    ),
  }));
};

registerEvent("toggleRomFolderSubfolders", toggleRomFolderSubfolders);
