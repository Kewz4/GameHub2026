import { registerEvent } from "../register-event";
import AutoLaunch from "auto-launch";
import { app } from "electron";
import { logger } from "@main/services";

export interface AutoLaunchPreferences {
  enabled: boolean;
  minimized: boolean;
}

export const applyAutoLaunchPreferences = async (
  autoLaunchProps: AutoLaunchPreferences
) => {
  if (!app.isPackaged) return;

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
