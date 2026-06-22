import { BrowserWindow, session } from "electron";
import { db, levelKeys } from "@main/level";
import type { UserPreferences } from "@types";
import { logger } from "@main/services/logger";
import { WindowManager } from "@main/services/window-manager";
import {
  EXOPHASE_ACCOUNT_URL,
  EXOPHASE_LOGIN_URL,
  EXOPHASE_PARTITION,
} from "./constants";
import { ExophaseFetcher } from "./exophase-web";
import { injectBrandedHeader } from "@main/services/auth-window-branding";

export interface ExophaseAuthState {
  authenticated: boolean;
  username: string | null;
}

const isAuthPageUrl = (url: string): boolean => {
  const u = url.toLowerCase();
  return (
    u.includes("/login") ||
    u.includes("/register") ||
    u.includes("/signup") ||
    u.includes("/password")
  );
};

/** Parses `window.me = { username: '...' }` out of raw account-page HTML, used
 *  as a fallback when we can't read the live `window.me` object. */
export function extractUsernameFromHtml(html: string): string | null {
  const idx = html.indexOf("window.me");
  const scope = idx >= 0 ? html.slice(idx, idx + 500) : "";
  const match = scope.match(/username:\s*['"]([^'"]+)['"]/);
  return match ? match[1] : null;
}

const getPrefs = (): Promise<UserPreferences | null> =>
  db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);

const patchPrefs = async (patch: Partial<UserPreferences>): Promise<void> => {
  const prefs = await getPrefs();
  await db.put<string, UserPreferences>(
    levelKeys.userPreferences,
    { ...(prefs ?? {}), ...patch },
    { valueEncoding: "json" }
  );
};

/**
 * Confirms whether the persisted Exophase session is still valid by loading the
 * account page in the Exophase partition and reading the username. Persists the
 * username when found.
 */
export async function probeExophaseAuth(): Promise<ExophaseAuthState> {
  const fetcher = new ExophaseFetcher();
  try {
    const html = await fetcher.fetchHtml(EXOPHASE_ACCOUNT_URL);
    const username =
      (await fetcher.readCurrentUsername()) ?? extractUsernameFromHtml(html);
    if (!username) return { authenticated: false, username: null };
    await patchPrefs({ exophaseUserId: username });
    return { authenticated: true, username };
  } catch (err) {
    logger.warn("[Exophase] auth probe failed", err);
    return { authenticated: false, username: null };
  } finally {
    fetcher.close();
  }
}

/**
 * Opens the Exophase login page in a modal window. Exophase exposes
 * `window.me.username` on every page once the user is authenticated, so we poll
 * for it and finish the moment it appears (without disturbing register/forgot
 * flows). Cookies persist automatically in the `persist:exophase` partition.
 */
export function openExophaseLoginWindow(): Promise<ExophaseAuthState> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 580,
      height: 700,
      title: "Sign in to Exophase",
      autoHideMenuBar: true,
      ...(WindowManager.mainWindow
        ? { parent: WindowManager.mainWindow, modal: true }
        : {}),
      webPreferences: {
        partition: EXOPHASE_PARTITION,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    let handled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const stopPolling = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const finish = async (username: string) => {
      if (handled) return;
      handled = true;
      stopPolling();
      await patchPrefs({ exophaseUserId: username, exophaseEnabled: true });
      try {
        if (!win.isDestroyed()) win.close();
      } catch {
        /* ignore */
      }
      resolve({ authenticated: true, username });
    };

    const checkLoggedIn = async () => {
      if (handled || win.isDestroyed()) return;
      const url = win.webContents.getURL();
      // Don't probe while the user is still on an auth page (login/register).
      if (!url || isAuthPageUrl(url)) return;
      try {
        const username: string | null = await win.webContents.executeJavaScript(
          "(window.me && window.me.username) ? String(window.me.username) : null",
          true
        );
        if (username) await finish(username);
      } catch {
        /* page not ready */
      }
    };

    injectBrandedHeader(win, "exophase");
    win.loadURL(EXOPHASE_LOGIN_URL).catch(() => {
      if (!handled) {
        handled = true;
        stopPolling();
        resolve({ authenticated: false, username: null });
      }
    });

    win.webContents.on("did-navigate", () => void checkLoggedIn());
    win.webContents.on("did-navigate-in-page", () => void checkLoggedIn());
    win.webContents.on("did-finish-load", () => {
      void checkLoggedIn();
      if (!pollTimer && !handled) {
        pollTimer = setInterval(() => void checkLoggedIn(), 1000);
      }
    });

    win.on("closed", () => {
      stopPolling();
      if (!handled) {
        handled = true;
        resolve({ authenticated: false, username: null });
      }
    });
  });
}

/** Logs out: wipes the Exophase session cookies/storage and clears the
 *  persisted username. */
export async function clearExophaseSession(): Promise<void> {
  try {
    await session.fromPartition(EXOPHASE_PARTITION).clearStorageData();
  } catch (err) {
    logger.warn("[Exophase] failed clearing session storage", err);
  }
  await patchPrefs({ exophaseUserId: null });
}
