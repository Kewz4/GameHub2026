import { BrowserWindow, session } from "electron";
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
 * Fetches the owned-games XML using `session.fetch()` from the persist:steam
 * session. This carries the session's httpOnly cookies (including
 * steamLoginSecure) without needing a BrowserWindow, and returns the raw XML
 * text rather than a serialized DOM — which avoids HTML-entity escaping issues
 * that could occur with executeJavaScript/outerHTML on an XML document.
 *
 * Falls back to a BrowserWindow if the session fetch fails (e.g. Cloudflare
 * challenge not yet solved on this session).
 */
async function fetchMyGamesXmlViaSession(): Promise<string> {
  const ses = session.fromPartition(STEAM_AUTH_PARTITION);
  const response = await ses.fetch(STEAM_MY_GAMES_XML, {
    headers: {
      Accept: "text/xml,application/xml,*/*",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!response.ok) {
    throw new Error(`Steam games XML returned HTTP ${response.status}`);
  }
  return response.text();
}

/**
 * Fallback: navigates a hidden BrowserWindow to the XML URL and reads the
 * raw response via XMLHttpRequest (not outerHTML) so we get the actual XML
 * bytes rather than Chromium's XML-viewer DOM serialization.
 */
function fetchMyGamesXmlViaBrowserWindow(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        partition: STEAM_AUTH_PARTITION,
        nodeIntegration: false,
        contextIsolation: true,
        offscreen: false,
        backgroundThrottling: false,
      },
    });

    const destroy = () => {
      if (!win.isDestroyed()) win.destroy();
    };

    const timer = setTimeout(() => {
      destroy();
      reject(new Error("Steam BrowserWindow fetch timed out"));
    }, 25_000);

    // Navigate to a blank page first, then XHR the XML URL from there so we
    // get the raw text rather than the browser's XML-viewer DOM.
    win.loadURL("about:blank")
      .then(() =>
        win.webContents.executeJavaScript(
          `(async () => {
            const r = await fetch(${JSON.stringify(STEAM_MY_GAMES_XML)}, {
              credentials: 'include',
              headers: { Accept: 'text/xml,application/xml,*/*' }
            });
            return r.text();
          })()`,
          true
        )
      )
      .then((text: string) => {
        clearTimeout(timer);
        destroy();
        resolve(text ?? "");
      })
      .catch((err) => {
        clearTimeout(timer);
        destroy();
        reject(err);
      });
  });
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
    try {
      // Prefer the lightweight session.fetch() path; fall back to BrowserWindow.
      let xml: string;
      try {
        xml = await fetchMyGamesXmlViaSession();
      } catch (sessionErr) {
        logger.warn(
          "[SteamAuth] session.fetch failed, falling back to BrowserWindow",
          sessionErr
        );
        xml = await fetchMyGamesXmlViaBrowserWindow();
      }

      logger.log(
        `[SteamAuth] games XML (first 300): ${xml.slice(0, 300).replace(/\s+/g, " ")}`
      );

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
    }
  };

/** True when the persistent Steam session can read the owned-games list. */
export const isSteamSessionAuthenticated = async (): Promise<boolean> => {
  const session = await getAuthenticatedSteamOwnedGames();
  return session != null;
};
