import { BrowserWindow } from "electron";
import { registerEvent } from "../register-event";
import {
  authenticateLegendary,
  findLegendaryBinary,
  downloadLegendary,
  getLegendaryStatus,
} from "@main/services/legendary";
import { db, levelKeys } from "@main/level";
import type { UserPreferences } from "@types";
import { logger } from "@main/services";
import { WindowManager } from "@main/services/window-manager";

const REDIRECT_API =
  "https://www.epicgames.com/id/api/redirect" +
  "?clientId=34a02cf8f4414e29b15921876da36f9a&responseType=code";

const EPIC_LOGIN_URL =
  "https://www.epicgames.com/id/login" +
  "?redirectUrl=" +
  encodeURIComponent(REDIRECT_API) +
  "&noRedirect=true";

const extractCode = (bodyText: string): string | null => {
  try {
    const json = JSON.parse(bodyText.trim());
    const code =
      json?.authorizationCode || json?.exchangeCode || json?.code || null;
    if (code && typeof code === "string" && code.length > 8) return code;
  } catch (_) {
    // ignore parse errors
  }
  return null;
};

const openLegendaryAuthWindow = async (
  _event: Electron.IpcMainInvokeEvent
): Promise<{ success: boolean; account?: string }> => {
  const prefs = await db
    .get<
      string,
      UserPreferences | null
    >(levelKeys.userPreferences, { valueEncoding: "json" })
    .catch(() => null);

  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 640,
      height: 800,
      backgroundColor: "#1c1c1c",
      title: "Sign in to Epic Games",
      ...(WindowManager.mainWindow
        ? { parent: WindowManager.mainWindow, modal: true }
        : {}),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
      },
    });

    win.loadURL(EPIC_LOGIN_URL);

    let handled = false;

    const tryExtract = async (url: string) => {
      if (handled) return;
      if (!url.includes("/id/api/redirect")) return;

      let bodyText = "";
      try {
        bodyText = await win.webContents.executeJavaScript(
          "document.body.innerText"
        );
      } catch {
        return;
      }

      const code = extractCode(bodyText);
      if (!code) return;

      handled = true;
      win.close();

      try {
        // Auto-install legendary if not present before attempting auth
        let binary = findLegendaryBinary(prefs?.legendaryBinaryPath);
        if (!binary) {
          logger.log("legendary not found — downloading before auth...");
          binary = await downloadLegendary();
        }

        await authenticateLegendary(code, binary);
        // Legendary writes config asynchronously after auth; retry until account appears
        let status = await getLegendaryStatus(binary);
        for (let i = 0; i < 5 && !status.account; i++) {
          await new Promise((r) => setTimeout(r, 600));
          status = await getLegendaryStatus(binary);
        }
        resolve({ success: true, account: status.account ?? "Epic Games" });
      } catch (err) {
        logger.error("legendary auth --code failed", err);
        resolve({ success: false });
      }
    };

    // Listen on all navigation events to catch every possible redirect path
    win.webContents.on("will-navigate", (_e, url) => tryExtract(url));
    win.webContents.on("will-redirect", (_e, url) => tryExtract(url));
    win.webContents.on("did-navigate", (_e, url) => tryExtract(url));
    win.webContents.on("did-navigate-in-page", (_e, url) => tryExtract(url));
    win.webContents.on("dom-ready", () => tryExtract(win.webContents.getURL()));
    win.webContents.on("did-finish-load", () =>
      tryExtract(win.webContents.getURL())
    );

    win.on("closed", () => {
      if (!handled) resolve({ success: false });
    });
  });
};

registerEvent("openLegendaryAuthWindow", openLegendaryAuthWindow);
