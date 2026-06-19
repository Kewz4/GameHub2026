import { app } from "electron";
import { registerEvent } from "../register-event";
import updater from "electron-updater";

const { autoUpdater } = updater;

export const restartAndInstallUpdate = () => {
  autoUpdater.removeAllListeners();
  if (app.isPackaged) {
    // Give all windows and async operations a moment to flush before the NSIS
    // installer starts replacing files — avoids ERROR 32 "file in use".
    setTimeout(() => {
      autoUpdater.quitAndInstall(false, true);
    }, 1500);
  }
};

const restartAndInstallUpdateEvent = async (
  _event: Electron.IpcMainInvokeEvent
) => restartAndInstallUpdate();

registerEvent("restartAndInstallUpdate", restartAndInstallUpdateEvent);
