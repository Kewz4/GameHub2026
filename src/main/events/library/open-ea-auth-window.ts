import { BrowserWindow } from "electron";
import { registerEvent } from "../register-event";
import { db, levelKeys } from "@main/level";
import type { UserPreferences } from "@types";
import { logger } from "@main/services";
import { WindowManager } from "@main/services/window-manager";
import {
  EA_AUTH_PARTITION,
  buildEaLoginUrl,
  exchangeEaAuthCode,
  extractEaAuthCode,
  isEaLoginRedirect,
} from "@main/services/ea-auth";
import { fetchEaIdentity } from "@main/services/ea-juno";

export interface EaAuthResult {
  accessToken: string;
  username: string;
  pid: string;
}

const persistEaAuth = async (
  accessToken: string,
  refreshToken: string,
  expiresInSeconds: number,
  username: string,
  pid: string
) => {
  const prefs = await db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);
  const expiry = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
  await db.put<string, UserPreferences>(
    levelKeys.userPreferences,
    {
      ...(prefs ?? {}),
      eaAccessToken: accessToken,
      eaRefreshToken: refreshToken,
      eaTokenExpiry: expiry,
      eaUsername: username,
      eaPid: pid,
    },
    { valueEncoding: "json" }
  );
};

/**
 * Opens the EA App login flow (JUNO_PC_CLIENT + pc_sign). After the user signs
 * in, EA redirects to qrc:///html/login_successful.html?code=<authCode>; we
 * intercept that navigation, swap the code for tokens at connect/token, and
 * confirm the token by reading the user's Juno identity.
 */
const openEaAuthWindow = async (
  _event: Electron.IpcMainInvokeEvent
): Promise<EaAuthResult | null> => {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 520,
      height: 760,
      backgroundColor: "#1c1c1c",
      title: "Sign in to EA",
      ...(WindowManager.mainWindow
        ? { parent: WindowManager.mainWindow, modal: true }
        : {}),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        partition: EA_AUTH_PARTITION,
      },
    });

    win.loadURL(buildEaLoginUrl());

    let handled = false;

    const completeWithCode = async (code: string) => {
      if (handled) return;
      handled = true;

      try {
        const tokens = await exchangeEaAuthCode(code);

        // Close the window immediately — identity fetch can take up to 25 s
        // and there's no reason to keep the popup open while we wait for it.
        if (!win.isDestroyed()) win.close();

        let username = "EA Account";
        let pid = "";
        try {
          const identity = await fetchEaIdentity(tokens.accessToken);
          username = identity.displayName || "EA Account";
          pid = identity.pid;
        } catch (err) {
          logger.warn("EA auth: identity fetch failed (continuing)", err);
        }

        await persistEaAuth(
          tokens.accessToken,
          tokens.refreshToken,
          tokens.expiresIn,
          username,
          pid
        );
        resolve({ accessToken: tokens.accessToken, username, pid });
      } catch (err) {
        logger.error("EA auth: token exchange failed", err);
        if (!win.isDestroyed()) win.close();
        resolve(null);
      }
    };

    // Intercept the post-login redirect to qrc:///html/login_successful.html.
    // The qrc:// scheme can't actually load, so we catch it before navigation.
    const handleRedirect = (event: Electron.Event, url: string) => {
      if (handled) return;
      if (!isEaLoginRedirect(url)) return;
      event.preventDefault();
      const code = extractEaAuthCode(url);
      if (code) {
        void completeWithCode(code);
      } else {
        logger.error(
          `EA auth: login redirect had no code: ${url.slice(0, 160)}`
        );
      }
    };

    win.webContents.on("will-redirect", handleRedirect);
    win.webContents.on("will-navigate", handleRedirect);
    // did-fail-load fires when the qrc:// navigation is rejected by Chromium —
    // recover the code from the attempted URL.
    win.webContents.on("did-fail-load", (_e, _code, _desc, validatedURL) => {
      if (validatedURL && isEaLoginRedirect(validatedURL)) {
        const code = extractEaAuthCode(validatedURL);
        if (code) void completeWithCode(code);
      }
    });

    win.on("closed", () => {
      if (!handled) resolve(null);
    });
  });
};

registerEvent("openEaAuthWindow", openEaAuthWindow);
