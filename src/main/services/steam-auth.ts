import { BrowserWindow } from "electron";
import { logger } from "./logger";
import {
  extractSteamId64FromXml,
  parseSteamGamesXml,
  type SteamOwnedGame,
} from "./steam-account";

/** Dedicated persistent session so the Steam login cookies live independently
 *  from the rest of the app and survive restarts (mirrors persist:exophase). */
export const STEAM_AUTH_PARTITION = "persist:steam";

/** Steam login page. `goto` makes Steam redirect straight to the games XML for
 *  the authenticated user once login completes. */
export const STEAM_LOGIN_URL =
  "https://steamcommunity.com/login/home/?goto=my/games?xml=1";

/** The authenticated owned-games XML. `/my/` resolves to the logged-in user,
 *  and an authenticated user sees their OWN games even when the list is private
 *  to the public — which is exactly why this beats the public XML endpoint. */
const STEAM_MY_GAMES_XML = "https://steamcommunity.com/my/games?xml=1";

/**
 * Fetches Steam pages through a hidden BrowserWindow bound to the
 * `persist:steam` session. Reused for the background re-sync so we never need
 * to pop the login window again once the session is established.
 */
export class SteamFetcher {
  private win: BrowserWindow | null = null;

  private ensureWindow(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win;
    this.win = new BrowserWindow({
      show: false,
      webPreferences: {
        partition: STEAM_AUTH_PARTITION,
        nodeIntegration: false,
        contextIsolation: true,
        offscreen: false,
        backgroundThrottling: false,
      },
    });
    return this.win;
  }

  /**
   * Navigates a hidden window DIRECTLY to `url` and returns the page's full
   * HTML/text via `document.documentElement.outerHTML`. This mirrors the
   * ExophaseFetcher pattern and reliably carries the partition's cookies
   * (unlike doing `fetch()` from JS inside a different page where httpOnly
   * cookies may not be visible to the JS context).
   */
  private navigateFetch(url: string, timeoutMs = 20_000): Promise<string> {
    const win = this.ensureWindow();
    return new Promise<string>((resolve, reject) => {
      let settled = false;
      const finish = async () => {
        if (settled) return;
        settled = true;
        win.webContents.off("did-finish-load", onLoad);
        clearTimeout(timer);
        try {
          const html: string = await win.webContents.executeJavaScript(
            "document.documentElement.outerHTML",
            true
          );
          resolve(html ?? "");
        } catch (err) {
          reject(err);
        }
      };
      const onLoad = () => void finish();
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        win.webContents.off("did-finish-load", onLoad);
        reject(new Error("Steam request timed out"));
      }, timeoutMs);

      win.webContents.on("did-finish-load", onLoad);
      win.loadURL(url).catch((err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  /** Fetches the authenticated user's owned-games XML by navigating directly. */
  fetchMyGamesXml(): Promise<string> {
    return this.navigateFetch(STEAM_MY_GAMES_XML);
  }

  close(): void {
    if (this.win && !this.win.isDestroyed()) this.win.close();
    this.win = null;
  }
}

export interface SteamAuthSession {
  steamId: string;
  games: SteamOwnedGame[];
}

/**
 * Reads the owned games for the currently logged-in Steam session (if any).
 * Returns null when the session is missing/expired — i.e. the XML came back as
 * the login HTML rather than a games document.
 */
export const getAuthenticatedSteamOwnedGames =
  async (): Promise<SteamAuthSession | null> => {
    const fetcher = new SteamFetcher();
    try {
      const xml = await fetcher.fetchMyGamesXml();

      // Not logged in → Steam serves the login page HTML, not the games XML.
      if (!xml.includes("<gamesList>") && !xml.includes("<steamID64>")) {
        return null;
      }

      const steamId = extractSteamId64FromXml(xml);
      if (!steamId) return null;

      const games = parseSteamGamesXml(xml);
      logger.log(
        `[SteamAuth] authenticated session: ${games.length} owned games for ${steamId}`
      );
      return { steamId, games };
    } catch (err) {
      logger.warn("[SteamAuth] authenticated owned-games fetch failed", err);
      return null;
    } finally {
      fetcher.close();
    }
  };

/** True when the persistent Steam session can read the owned-games list. */
export const isSteamSessionAuthenticated = async (): Promise<boolean> => {
  const session = await getAuthenticatedSteamOwnedGames();
  return session != null;
};
