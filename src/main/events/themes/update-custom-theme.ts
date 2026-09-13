import { themesSublevel } from "@main/level";
import { registerEvent } from "../register-event";
import { BrowserWindow } from "electron";

const updateCustomTheme = async (
  _event: Electron.IpcMainInvokeEvent,
  themeId: string,
  code: string
) => {
  const theme = await themesSublevel.get(themeId);

  if (!theme) {
    throw new Error("Theme not found");
  }

  await themesSublevel.put(themeId, {
    ...theme,
    code,
    updatedAt: new Date(),
  });

  if (theme.isActive) {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send("on-custom-theme-updated");
      }
    }
  }
};

registerEvent("updateCustomTheme", updateCustomTheme);
