import axios from "axios";
import { BrowserWindow } from "electron";
import { registerEvent } from "../register-event";
import { db, levelKeys } from "@main/level";
import type { UserPreferences } from "@types";
import { logger } from "@main/services";
import { WindowManager } from "@main/services/window-manager";
import {
  EA_AUTH_PARTITION,
  EA_LOGIN_URL,
  EA_TOKEN_URL,
  parseEaAuthJson,
} from "@main/services/ea-auth";

export interface EaAuthResult {
  accessToken: string;
  username: string;
  pid: string;
}

const persistEaAuth = async (
  accessToken: string,
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
      eaTokenExpiry: expiry,
      eaUsername: username,
      eaPid: pid,
    },
    { valueEncoding: "json" }
  );
};

const openEaAuthWindow = async (
  _event: Electron.IpcMainInvokeEvent
): Promise<EaAuthResult | null> => {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 520,
      height: 720,
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

    // Step 1: load the EA login page directly — no OAuth redirect_uri needed.
    win.loadURL(EA_LOGIN_URL);

    let handled = false;
    let exchanging = false;
    let cookieCheckInterval: ReturnType<typeof setInterval> | null = null;

    const clearCookieCheck = () => {
      if (cookieCheckInterval) {
        clearInterval(cookieCheckInterval);
        cookieCheckInterval = null;
      }
    };

    const completeWithToken = async (accessToken: string, expiresIn: number) => {
      if (handled) return;
      handled = true;
      clearCookieCheck();
      if (!win.isDestroyed()) win.close();

      try {
        const infoRes = await axios.get(
          "https://gateway.ea.com/proxy/identity/pids/me",
          {
            headers: { Authorization: `Bearer ${accessToken}` },
            timeout: 10_000,
          }
        );
        const pidData = infoRes.data?.pid ?? {};
        const username =
          pidData.displayName ?? pidData.email ?? pidData.pidId ?? "EA Account";
        const pid = String(pidData.pidId ?? "");
        await persistEaAuth(accessToken, expiresIn, username, pid);
        resolve({ accessToken, username, pid });
      } catch (err) {
        logger.error("EA auth: identity fetch failed", err);
        await persistEaAuth(accessToken, expiresIn, "EA Account", "").catch(
          () => {}
        );
        resolve({ accessToken, username: "EA Account", pid: "" });
      }
    };

    // Step 2: once logged in, the session holds remid/sid cookies. Navigate
    // to the token endpoint which renders the access token as JSON page body.
    const runTokenExchange = () => {
      if (handled || exchanging || win.isDestroyed()) return;
      exchanging = true;
      win.loadURL(EA_TOKEN_URL);
    };

    const checkPageForToken = async () => {
      if (handled || win.isDestroyed()) return;
      const url = win.webContents.getURL();
      if (!url.startsWith("https://accounts.ea.com/connect/auth")) return;

      try {
        const bodyText: string = await win.webContents.executeJavaScript(
          "document.body ? document.body.innerText : ''",
          true
        );
        const data = parseEaAuthJson(bodyText);
        if (data?.access_token) {
          await completeWithToken(
            data.access_token,
            Number(data.expires_in ?? 3600)
          );
        } else if (data?.error) {
          logger.error(`EA token exchange returned error: ${bodyText}`);
        }
      } catch {
        // page not JSON yet — ignore
      }
    };

    // Fallback: some EA stacks redirect straight to nucleus:rest#access_token=
    const handleNucleusRedirect = (url: string) => {
      if (handled || !url.startsWith("nucleus:")) return;
      const hashIdx = url.indexOf("#");
      const queryStr =
        hashIdx >= 0 ? url.slice(hashIdx + 1) : (url.split("?")[1] ?? "");
      const params = new URLSearchParams(queryStr);
      const accessToken = params.get("access_token");
      if (accessToken) {
        void completeWithToken(
          accessToken,
          Number(params.get("expires_in") ?? 3600)
        );
      }
    };

    // Cookie-based login detection: poll for the EA `remid` cookie which is set
    // after successful login. Avoids any OAuth redirect_uri validation issue.
    const ses = win.webContents.session;
    const checkForLoginCookie = async () => {
      if (handled || exchanging || win.isDestroyed()) return;
      try {
        const cookies = await ses.cookies.get({
          domain: ".ea.com",
          name: "remid",
        });
        if (cookies.length > 0) {
          runTokenExchange();
        }
      } catch {
        // session gone
      }
    };

    // Also detect nucleus: redirects and the token page finishing
    win.webContents.on("did-finish-load", () => void checkPageForToken());
    win.webContents.on("did-redirect-navigation", (_e, url) => {
      handleNucleusRedirect(url);
    });
    win.webContents.on("will-navigate", (_e, url) => {
      handleNucleusRedirect(url);
    });
    win.webContents.on("will-redirect", (_e, url) => handleNucleusRedirect(url));

    // Poll for the remid cookie every second after the page loads
    win.webContents.on("did-finish-load", () => {
      if (!cookieCheckInterval && !handled) {
        cookieCheckInterval = setInterval(() => void checkForLoginCookie(), 1000);
      }
    });

    win.on("closed", () => {
      clearCookieCheck();
      if (!handled) resolve(null);
    });
  });
};

registerEvent("openEaAuthWindow", openEaAuthWindow);
