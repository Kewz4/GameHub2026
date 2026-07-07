import { app, BrowserWindow } from "electron";
import { registerEvent } from "../register-event";
import updater from "electron-updater";

const { autoUpdater } = updater;

export const restartAndInstallUpdate = () => {
  autoUpdater.removeAllListeners();
  if (!app.isPackaged) return;

  // Close every window up front so no renderer keeps a file handle locked and
  // the process is already tearing down before the installer runs.
  for (const win of BrowserWindow.getAllWindows()) {
    win.removeAllListeners("close");
    win.destroy();
  }

  // Install SILENTLY: the silent NSIS installer force-closes the running
  // instance itself instead of showing the "please close GameHub" prompt, then
  // relaunches (isForceRunAfter). The longer delay lets windows + async work
  // flush so the file-replace step doesn't hit ERROR 32 (file in use).
  setTimeout(() => {
    autoUpdater.quitAndInstall(true, true);
  }, 3000);
};

const restartAndInstallUpdateEvent = async (
  _event: Electron.IpcMainInvokeEvent
) => restartAndInstallUpdate();

registerEvent("restartAndInstallUpdate", restartAndInstallUpdateEvent);
