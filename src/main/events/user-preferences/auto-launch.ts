import { registerEvent } from "../register-event";
import AutoLaunch from "auto-launch";
import { app } from "electron";
import { logger } from "@main/services";
import { setLinuxAutoLaunch } from "@main/services/linux-auto-launch";
import { getLinuxLauncherExecutable } from "@main/services/linux-desktop-entry";

export interface AutoLaunchPreferences {
  enabled: boolean;
  minimized: boolean;
}

export const applyAutoLaunchPreferences = async (
  autoLaunchProps: AutoLaunchPreferences
) => {
  if (!app.isPackaged) return;
  if (process.platform === "linux") {
    await setLinuxAutoLaunch({
      ...autoLaunchProps,
      executable: getLinuxLauncherExecutable(process.execPath),
      home: app.getPath("home"),
    });
    return;
  }

  const appLauncher = new AutoLaunch({
    name: app.getName(),
    isHidden: autoLaunchProps.minimized,
  });

  if (autoLaunchProps.enabled) {
    await appLauncher.enable().catch((err) => {
      logger.error(err);
    });
  } else {
    await appLauncher.disable().catch((err) => {
      logger.error(err);
    });
  }
};

const autoLaunch = async (
  _event: Electron.IpcMainInvokeEvent,
  autoLaunchProps: AutoLaunchPreferences
) => applyAutoLaunchPreferences(autoLaunchProps);

registerEvent("autoLaunch", autoLaunch);
