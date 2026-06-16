import { BrowserWindow } from "electron";
import { registerEvent } from "../register-event";
import { db, levelKeys } from "@main/level";
import type { UserPreferences } from "@types";
import { logger } from "@main/services";
import { WindowManager } from "@main/services/window-manager";
import {
  STEAM_AUTH_PARTITION,
  STEAM_LOGIN_URL,
  getAuthenticatedSteamOwnedGames,
} from "@main/services/steam-auth";

export interface SteamLoginResult {
  steamId: string;
}

const persistSteamId = async (steamId: string) => {
  const prefs = await db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);
  await db.put<string, UserPreferences>(
    levelKeys.userPreferences,
    { ...(prefs ?? {}), steamId },
    { valueEncoding: "json" }
  );
};

/**
 * Opens an in-app Steam login window (like the Epic/GOG flows). After login the
 * persistent `persist:steam` session can read the user's OWN owned-games list —
 * even when their profile game details are private, which the public XML and
 * OpenID flows cannot do. We detect login via the `steamLoginSecure` cookie,
 * then read the games XML to confirm access and grab the SteamID.
 */
const openSteamLoginWindow = async (
  _event: Electron.IpcMainInvokeEvent
): Promise<SteamLoginResult | null> => {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 500,
      height: 720,
      title: "Sign in to Steam",
      ...(WindowManager.mainWindow
        ? { parent: WindowManager.mainWindow, modal: true }
        : {}),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        partition: STEAM_AUTH_PARTITION,
      },
    });

    win.loadURL(STEAM_LOGIN_URL);

    let handled = false;
    let cookieCheckInterval: ReturnType<typeof setInterval> | null = null;

    const clearCookieCheck = () => {
      if (cookieCheckInterval) {
        clearInterval(cookieCheckInterval);
        cookieCheckInterval = null;
      }
    };

    const complete = async () => {
      if (handled) return;
      handled = true;
      clearCookieCheck();

      // The session now holds the login cookie. Read the owned-games XML to
      // confirm access and extract the SteamID.
      const session = await getAuthenticatedSteamOwnedGames().catch(() => null);

      if (!win.isDestroyed()) win.close();

      if (!session?.steamId) {
        logger.warn("[SteamLogin] login cookie present but games read failed");
        resolve(null);
        return;
      }

      await persistSteamId(session.steamId).catch(() => {});
      logger.log(
        `[SteamLogin] linked SteamID ${session.steamId} (${session.games.length} games)`
      );
      resolve({ steamId: session.steamId });
    };

    const ses = win.webContents.session;
    const checkForLoginCookie = async () => {
      if (handled || win.isDestroyed()) return;
      try {
        const cookies = await ses.cookies.get({
          domain: "steamcommunity.com",
          name: "steamLoginSecure",
        });
        if (cookies.length > 0) void complete();
      } catch {
        // session gone
      }
    };

    win.webContents.on("did-finish-load", () => {
      if (!cookieCheckInterval && !handled) {
        cookieCheckInterval = setInterval(
          () => void checkForLoginCookie(),
          1000
        );
      }
    });

    win.on("closed", () => {
      clearCookieCheck();
      if (!handled) resolve(null);
    });
  });
};

registerEvent("openSteamLoginWindow", openSteamLoginWindow);
