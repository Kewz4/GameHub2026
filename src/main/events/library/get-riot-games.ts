import { registerEvent } from "../register-event";
import {
  RIOT_GAMES,
  detectInstalledRiotGames,
  isRiotClientInstalled,
} from "@main/services/riot";

const getRiotGames = async (_event: Electron.IpcMainInvokeEvent) => {
  return {
    installed: isRiotClientInstalled(),
    detected: detectInstalledRiotGames(),
    all: RIOT_GAMES,
  };
};

registerEvent("getRiotGames", getRiotGames);
