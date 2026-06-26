import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import type { EmulatorSystem } from "@types";
import { syncEmulatorRomPaths } from "@main/services/emulators/configure-emulator-rom-paths";

const removeRomFolder = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem,
  folderId: string
) => {
  const updated = await emulators.updateEmulatorConfig(system, (cfg) => ({
    ...cfg,
    romFolders: cfg.romFolders.filter((f) => f.id !== folderId),
  }));

  // Best-effort: sync the updated folder list back to the emulator's config.
  syncEmulatorRomPaths(system).catch(() => {});

  return updated;
};

registerEvent("removeRomFolder", removeRomFolder);
