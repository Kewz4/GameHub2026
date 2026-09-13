import { shell } from "electron";
import { registerEvent } from "../register-event";
import type { GameShop } from "@types";
import fs from "node:fs";

const openGameSaveFolder = async (
  _event: Electron.IpcMainInvokeEvent,
  _shop: GameShop,
  _objectId: string,
  saveFolderPath: string
): Promise<boolean> => {
  if (!saveFolderPath) return false;

  try {
    if (fs.existsSync(saveFolderPath)) {
      const stat = fs.statSync(saveFolderPath);
      if (stat.isFile()) {
        shell.showItemInFolder(saveFolderPath);
        return true;
      }
      if (stat.isDirectory()) {
        return (await shell.openPath(saveFolderPath)) === "";
      }
    }
  } catch {
    return false;
  }

  return false;
};

registerEvent("openGameSaveFolder", openGameSaveFolder);
