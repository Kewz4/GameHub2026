import { registerEvent } from "../register-event";
import type { GameShop } from "@types";
import { Ludusavi, SystemPath } from "@main/services";
import { backupsPath, emulatorsInstallPath } from "@main/constants";
import { app } from "electron";
import path from "node:path";
import { validateManualSavePath } from "./manual-save-path";

const selectGameBackupPath = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  backupPath: string | null
) => {
  if (backupPath === null) {
    await Ludusavi.removeManualCustomGame(shop, objectId);
    return;
  }

  const validatedPath = validateManualSavePath(backupPath, [
    path.dirname(app.getPath("exe")),
    SystemPath.getPath("userData"),
    backupsPath,
    emulatorsInstallPath,
  ]);
  await Ludusavi.setManualCustomGame(shop, objectId, validatedPath);
};

registerEvent("selectGameBackupPath", selectGameBackupPath);
