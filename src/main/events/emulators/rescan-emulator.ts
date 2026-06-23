import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import type { EmulatorSystem } from "@types";

const rescanEmulator = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem
) => {
  const config = await emulators.getEmulatorConfig(system);
  let updated = config;

  for (const folder of config.romFolders) {
    const result = await emulators.scanRomFolder(folder.path, system, {
      scanSubfolders: folder.scanSubfolders,
    });
    updated = await emulators.updateEmulatorConfig(system, (cfg) => ({
      ...cfg,
      romFolders: cfg.romFolders.map((f) =>
        f.id === folder.id
          ? { ...f, fileCount: result.fileCount, sizeBytes: result.sizeBytes, lastScanAt: Date.now() }
          : f
      ),
    }));
  }

  return emulators.recomputeTotals(updated);
};

registerEvent("rescanEmulator", rescanEmulator);
