import { registerEvent } from "../register-event";
import { detectInstalledEaGames, isEaClientInstalled } from "@main/services/ea";

const getEaGames = async (_event: Electron.IpcMainInvokeEvent) => {
  return {
    installed: await isEaClientInstalled(),
    detected: await detectInstalledEaGames(),
  };
};

registerEvent("getEaGames", getEaGames);
