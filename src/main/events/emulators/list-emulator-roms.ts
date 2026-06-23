import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import type { EmulatorSystem, DetectedRom } from "@types";

const listEmulatorRoms = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem
): Promise<DetectedRom[]> => {
  const config = await emulators.getEmulatorConfig(system);
  const allGames: DetectedRom[] = [];
  for (const folder of config.romFolders) {
    const result = await emulators.scanRomFolder(folder.path, system, {
      scanSubfolders: folder.scanSubfolders,
    });
    for (const game of result.games) {
      if (!game.wrongPlatform) {
        allGames.push({
          objectId: game.primaryPath,
          title: game.name,
          libraryImageUrl: null,
          iconUrl: null,
          sizeBytes: game.sizeBytes,
          skus: [],
        });
      }
    }
  }
  return allGames;
};

registerEvent("listEmulatorRoms", listEmulatorRoms);
