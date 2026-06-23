import { registerEvent } from "../register-event";
import { WindowManager } from "@main/services";

const hideAchievementCustomNotificationWindow = async (
  _event: Electron.IpcMainInvokeEvent
) => {
  WindowManager.hideNotificationWindow();
};

registerEvent(
  "hideAchievementCustomNotificationWindow",
  hideAchievementCustomNotificationWindow
);
