import os from "node:os";

import { resolveCloudSaveAppDataDir } from "./cloud-save/cloud-save-os-paths";
import { SystemPath } from "./system-path";

/** Real Windows Roaming AppData, never Electron's portable user-data root. */
export const getWindowsRoamingAppData = () =>
  resolveCloudSaveAppDataDir({
    platform: "windows",
    homeDir: SystemPath.getPath("home") || os.homedir(),
    electronAppDataDir: SystemPath.getPath("appData"),
    windowsAppDataDir: process.env.APPDATA,
  })!;
