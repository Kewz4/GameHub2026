import { registerEvent } from "../register-event";
import {
  detectInstalledUbisoftGames,
  isUbisoftClientInstalled,
} from "@main/services/ubisoft";

const getUbisoftGames = async (_event: Electron.IpcMainInvokeEvent) => {
  return {
    installed: await isUbisoftClientInstalled(),
    detected: await detectInstalledUbisoftGames(),
  };
};

registerEvent("getUbisoftGames", getUbisoftGames);
