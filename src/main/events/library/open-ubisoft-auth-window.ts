import axios from "axios";
import { BrowserWindow } from "electron";
import { registerEvent } from "../register-event";
import { db, levelKeys } from "@main/level";
import type { UserPreferences } from "@types";
import { logger } from "@main/services";
import { WindowManager } from "@main/services/window-manager";

const UBI_APP_ID = "f68a4c21-3006-47f3-b676-e2badf904de8";

export interface UbisoftAuthResult {
  ticket: string;
  userId: string;
  profileId: string;
  username: string;
}

const openUbisoftAuthWindow = async (
  _event: Electron.IpcMainInvokeEvent
): Promise<UbisoftAuthResult | null> => {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 520,
      height: 720,
      title: "Sign in to Ubisoft Connect",
      ...(WindowManager.mainWindow
        ? { parent: WindowManager.mainWindow, modal: true }
        : {}),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        partition: "persist:ubisoft-auth",
      },
    });

    const loginUrl =
      `https://account.ubisoft.com/en-US/login?appId=${UBI_APP_ID}` +
      `&nextUrl=${encodeURIComponent(`https://connect.ubisoft.com/ready?appId=${UBI_APP_ID}`)}`;

    win.loadURL(loginUrl);

    let handled = false;

    const checkUrl = async (url: string) => {
      if (handled) return;
      // Only trigger when the window actually navigates TO connect.ubisoft.com —
      // not when the login URL merely contains it in a nextUrl query parameter.
      if (!url.startsWith("https://connect.ubisoft.com")) return;
      handled = true;

      try {
        // Grab the session cookies Ubisoft set during login — must happen
        // before closing the window or the webContents session is gone
        const cookies = await win.webContents.session.cookies.get({
          domain: ".ubisoft.com",
        });
        win.close();
        const cookieHeader = cookies
          .map((c) => `${c.name}=${c.value}`)
          .join("; ");

        // Exchange the browser session cookies for an API ticket
        const res = await axios.post(
          "https://public-ubiservices.ubi.com/v3/profiles/sessions",
          { rememberMe: true },
          {
            headers: {
              Cookie: cookieHeader,
              "Ubi-AppId": UBI_APP_ID,
              "Content-Type": "application/json",
              "Ubi-RequestedPlatformType": "uplay",
              "User-Agent": "GameHub Launcher",
            },
            timeout: 15_000,
          }
        );

        const result: UbisoftAuthResult = {
          ticket: res.data.ticket,
          userId: String(res.data.userId),
          profileId: res.data.profileId,
          username: res.data.nameOnPlatform ?? res.data.userId,
        };

        // Persist immediately
        const prefs = await db
          .get<string, UserPreferences | null>(levelKeys.userPreferences, {
            valueEncoding: "json",
          })
          .catch(() => null);
        await db.put<string, UserPreferences>(
          levelKeys.userPreferences,
          {
            ...(prefs ?? {}),
            ubisoftTicket: result.ticket,
            ubisoftUserId: result.userId,
            ubisoftProfileId: result.profileId,
            ubisoftUsername: result.username,
          },
          { valueEncoding: "json" }
        );

        resolve(result);
      } catch (err) {
        logger.error("Ubisoft auth failed", err);
        if (!win.isDestroyed()) win.close();
        resolve(null);
      }
    };

    win.webContents.on("will-navigate", (_e, url) => checkUrl(url));
    win.webContents.on("will-redirect", (_e, url) => checkUrl(url));
    win.webContents.on("did-navigate", (_e, url) => checkUrl(url));
    win.on("closed", () => {
      if (!handled) resolve(null);
    });
  });
};

registerEvent("openUbisoftAuthWindow", openUbisoftAuthWindow);
