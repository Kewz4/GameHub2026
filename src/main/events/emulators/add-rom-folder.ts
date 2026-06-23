import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import type { EmulatorSystem, RomFolder } from "@types";
import crypto from "node:crypto";

const addRomFolder = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem,
  folderPath: string,
  scanSubfolders: boolean
) => {
  const current = await emulators.getEmulatorConfig(system);
  if (current.romFolders.some((f) => f.path === folderPath)) return current;

  const newFolder: RomFolder = {
    id: crypto.randomUUID(),
    path: folderPath,
    scanSubfolders,
    fileCount: 0,
    sizeBytes: 0,
    lastScanAt: null,
  };

  return emulators.updateEmulatorConfig(system, (cfg) => ({
    ...cfg,
    romFolders: [...cfg.romFolders, newFolder],
  }));
};

registerEvent("addRomFolder", addRomFolder);
