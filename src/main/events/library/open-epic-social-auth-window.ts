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

function buildSocialUrl(provider: string): string {
  return (
    "https://www.epicgames.com/id/login" +
    "?lang=en&noRedirect=true" +
    `&redirectUrl=${encodeURIComponent(REDIRECT_API)}` +
    `&provider=${encodeURIComponent(provider)}`
  );
}

const openEpicSocialAuthWindow = async (
  _event: Electron.IpcMainInvokeEvent,
  provider: "google" | "facebook" | "apple"
): Promise<{ success: boolean; account?: string }> => {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 520,
      height: 680,
      title: `Sign in with ${provider.charAt(0).toUpperCase() + provider.slice(1)}`,
      ...(WindowManager.mainWindow
        ? { parent: WindowManager.mainWindow, modal: true }
        : {}),
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    win.loadURL(buildSocialUrl(provider));

    let handled = false;

    const tryHandle = async (url: string) => {
      if (handled) return;
      if (!url.includes("/id/api/redirect")) return;

      handled = true;
      win.close();

      try {
        // The redirect URL may have an exchange code in the body or search params.
        // We need to fetch the page to get the JSON body.
        const { net } = await import("electron");
        const res = await net.fetch(url);
        const text = await res.text();

        let code: string | null = null;
        try {
          const json = JSON.parse(text.trim());
          code =
            json?.authorizationCode ?? json?.exchangeCode ?? json?.code ?? null;
        } catch {
          try {
            code = new URL(url).searchParams.get("code");
          } catch {
            // ignore
          }
        }

        if (!code) {
          resolve({ success: false });
          return;
        }

        const prefs = await db
          .get<string, UserPreferences | null>(levelKeys.userPreferences, {
            valueEncoding: "json",
          })
          .catch(() => null);

        let binary = findLegendaryBinary(prefs?.legendaryBinaryPath);
        if (!binary) binary = await downloadLegendary();

        await authenticateLegendary(code, binary);
        let status = await getLegendaryStatus(binary);
        for (let i = 0; i < 5 && !status.account; i++) {
          await new Promise((r) => setTimeout(r, 600));
          status = await getLegendaryStatus(binary);
        }
        resolve({ success: true, account: status.account ?? "Epic Games" });
      } catch (err) {
        logger.error("Epic social auth failed", err);
        resolve({ success: false });
      }
    };

    win.webContents.on("will-navigate", (_e, url) => void tryHandle(url));
    win.webContents.on("will-redirect", (_e, url) => void tryHandle(url));
    win.webContents.on("did-navigate", (_e, url) => void tryHandle(url));

    win.on("closed", () => {
      if (!handled) resolve({ success: false });
    });
  });
};

registerEvent("openEpicSocialAuthWindow", openEpicSocialAuthWindow);
