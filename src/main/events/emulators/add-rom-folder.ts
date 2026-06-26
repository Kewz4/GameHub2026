import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import type { EmulatorSystem, RomFolder } from "@types";
import crypto from "node:crypto";
import { syncEmulatorRomPaths } from "@main/services/emulators/configure-emulator-rom-paths";

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

  const updated = await emulators.updateEmulatorConfig(system, (cfg) => ({
    ...cfg,
    romFolders: [...cfg.romFolders, newFolder],
  }));

  // Best-effort: mirror the new folder list into the emulator's own config file.
  syncEmulatorRomPaths(system).catch(() => {});

  return updated;
};

registerEvent("addRomFolder", addRomFolder);
