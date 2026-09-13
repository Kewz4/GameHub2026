import { shell } from "electron";
import fs from "node:fs";
import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import { GameShop } from "@types";
import { resolveGameFolderTarget } from "@main/services/game-folder-target";

const openGameExecutablePath = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const game = await gamesSublevel.get(levelKeys.game(shop, objectId));
  if (!game) return false;

  const target = resolveGameFolderTarget(game);
  if (!target) return false;
  try {
    if (fs.statSync(target).isDirectory()) {
      return (await shell.openPath(target)) === "";
    }
    shell.showItemInFolder(target);
    return true;
  } catch {
    return false;
  }
};

registerEvent("openGameExecutablePath", openGameExecutablePath);
