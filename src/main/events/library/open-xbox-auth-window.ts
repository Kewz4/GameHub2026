import { BrowserWindow } from "electron";
import { registerEvent } from "../register-event";
import {
  XBOX_OAUTH_URL,
  extractMsaToken,
  exchangeMsaForXboxTokens,
} from "@main/services/xbox";
import { db, levelKeys } from "@main/level";
import type { UserPreferences } from "@types";
import { logger } from "@main/services";

const openXboxAuthWindow = async (
  _event: Electron.IpcMainInvokeEvent
): Promise<{
  success: boolean;
  gamertag?: string;
  hasGamePass?: boolean;
}> => {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 500,
      height: 680,
      backgroundColor: "#1c1c1c",
      title: "Sign in to Xbox",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    win.loadURL(XBOX_OAUTH_URL);

    let handled = false;

    const tryHandle = async (url: string) => {
      if (handled) return;
      const msaToken = extractMsaToken(url);
      if (!msaToken) return;

      handled = true;
      win.close();

      try {
        const { tokens, user } = await exchangeMsaForXboxTokens(msaToken);

        // Persist tokens to user preferences
        const prefs = await db
          .get<string, UserPreferences | null>(levelKeys.userPreferences, {
            valueEncoding: "json",
          })
          .catch(() => null);

        await db.put(
          levelKeys.userPreferences,
          {
            ...(prefs ?? {}),
            xboxAccessToken: tokens.accessToken,
            xboxUserHash: tokens.userHash,
            xboxXstsToken: tokens.xstsToken,
            xboxTokenExpiry: tokens.expiry.toISOString(),
            xboxGamertag: user.gamertag,
            xboxHasGamePass: user.hasGamePass,
            xboxXuid: user.xuid,
          } as UserPreferences,
          { valueEncoding: "json" }
        );

        resolve({
          success: true,
          gamertag: user.gamertag,
          hasGamePass: user.hasGamePass,
        });
      } catch (err) {
        logger.error("Xbox auth failed", err);
        resolve({ success: false });
      }
    };

    win.webContents.on("will-redirect", (_e, url) => tryHandle(url));
    win.webContents.on("did-navigate", (_e, url) => tryHandle(url));
    win.webContents.on("did-navigate-in-page", (_e, url) => tryHandle(url));

    win.on("closed", () => {
      if (!handled) resolve({ success: false });
    });
  });
};

registerEvent("openXboxAuthWindow", openXboxAuthWindow);
