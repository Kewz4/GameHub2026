import { app, ipcMain } from "electron";
import path from "node:path";
import { WindowManager } from "@main/services";
import {
  getInstallerDefaults,
  browseForDirectory,
  setupInstall,
  setupPortable,
  relaunchFrom,
  openInstallFolder,
} from "@main/services/installer";

ipcMain.handle("installer:getDefaults", () => getInstallerDefaults());

ipcMain.handle("installer:browseDirectory", (_e, defaultPath: string) =>
  browseForDirectory(defaultPath)
);

ipcMain.handle(
  "installer:runSetup",
  async (_e, mode: "install" | "portable", destDir?: string) => {
    const win = WindowManager.installerWindow;

    if (!destDir) return { ok: false, error: "No destination directory" };

    if (mode === "portable") {
      try {
        await setupPortable(destDir, (pct, file) => {
          win?.webContents.send("installer:progress", pct, file);
        });
        // Redirect data paths for this session immediately — subsequent launches
        // detect the portable marker at startup, but this first launch needs it
        // too since the marker didn't exist when app.setPath was first called.
        const dataDir = path.join(destDir, "data");
        try {
          app.setPath("userData", dataDir);
          app.setPath("logs", path.join(dataDir, "logs"));
          app.setPath("sessionData", path.join(dataDir, "session"));
          app.setPath("crashDumps", path.join(dataDir, "crashes"));
        } catch {
          /* setPath may fail after ready on some platforms; ignore */
        }
        return { ok: true, destDir };
      } catch (err: any) {
        return { ok: false, error: err.message };
      }
    }

    try {
      await setupInstall(destDir, (pct, file) => {
        win?.webContents.send("installer:progress", pct, file);
      });
      return { ok: true, destDir };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }
);

ipcMain.handle("installer:relaunch", (_e, destDir: string) => {
  relaunchFrom(destDir);
});

ipcMain.handle("installer:openFolder", (_e, destDir: string) => {
  openInstallFolder(destDir);
});

ipcMain.handle("installer:closeAndLaunch", () => {
  WindowManager.installerWindow?.close();
  WindowManager.installerWindow = null;
  WindowManager.createMainWindow();
});

ipcMain.handle(
  "installer:resizeWindow",
  (_e, width: number, height: number) => {
    WindowManager.installerWindow?.setSize(width, height, true);
  }
);
