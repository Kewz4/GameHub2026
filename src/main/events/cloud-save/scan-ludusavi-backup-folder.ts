import { gamesSublevel } from "@main/level";
import { scanLudusaviBackupRoot } from "@main/services/cloud-save/ludusavi-import-plan";
import type { LudusaviBackupScanEntry } from "@types";

import { registerEvent } from "../register-event";

const scanLudusaviBackupFolder = async (
  _event: Electron.IpcMainInvokeEvent,
  folderPath: string
): Promise<LudusaviBackupScanEntry[]> => {
  const library = await gamesSublevel.values().all();
  return scanLudusaviBackupRoot(folderPath, library);
};

registerEvent("scanLudusaviBackupFolder", scanLudusaviBackupFolder);
