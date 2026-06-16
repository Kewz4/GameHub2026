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
 *  `tab=all` returns the FULL owned list (without it Steam returns only the
 *  recently-played subset), and an authenticated user sees their OWN games even
 *  when the list is private — which is exactly why this beats the public XML. */
const STEAM_MY_GAMES_XML =
  "https://steamcommunity.com/my/games?tab=all&xml=1";

/** A lightweight steamcommunity.com page used as the navigation origin before
 *  we issue the same-origin XHR for the games XML. */
const STEAM_ORIGIN_PAGE = "https://steamcommunity.com/my/";

/**
 * Reads the owned-games XML by:
 *   1. navigating a hidden BrowserWindow to a steamcommunity.com page so the
 *      document origin IS steamcommunity.com, and
 *   2. running an in-page `fetch()` for the games XML.
 *
 * Because the fetch runs from a steamcommunity.com document it is SAME-ORIGIN,
 * so it carries the session's httpOnly login cookies and is not blocked by
 * CORS (the previous about:blank approach failed CORS), and it returns the RAW
 * XML text rather than Chromium's XML-viewer DOM serialization.
 */
function fetchMyGamesXml(): Promise<string> {
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

    let settled = false;
    const destroy = () => {
      if (!win.isDestroyed()) win.destroy();
    };
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      destroy();
      reject(err);
    };
    const done = (text: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      destroy();
      resolve(text ?? "");
    };

    const timer = setTimeout(
      () => fail(new Error("Steam games XML fetch timed out")),
      30_000
    );

    win.webContents.on(
      "did-fail-load",
      (_e, errorCode, errorDescription, validatedURL) => {
        // -3 (ERR_ABORTED) fires for client-side redirects — ignore.
        if (errorCode === -3) return;
        fail(
          new Error(
            `Steam origin page load failed (${errorCode} ${errorDescription}) for ${validatedURL}`
          )
        );
      }
    );

    win.webContents.on("did-finish-load", () => {
      if (settled) return;
      // Now on a steamcommunity.com document → same-origin XHR for the XML.
      win.webContents
        .executeJavaScript(
          `(async () => {
            try {
              const r = await fetch(${JSON.stringify(STEAM_MY_GAMES_XML)}, {
                credentials: 'include',
                headers: { 'Accept': 'text/xml,application/xml,*/*' }
              });
              return await r.text();
            } catch (e) {
              return 'FETCH_ERROR:' + (e && e.message ? e.message : String(e));
            }
          })()`,
          true
        )
        .then((text: string) => {
          if (typeof text === "string" && text.startsWith("FETCH_ERROR:")) {
            fail(new Error(`Steam in-page fetch failed: ${text.slice(12)}`));
            return;
          }
          done(text);
        })
        .catch((err) =>
          fail(err instanceof Error ? err : new Error(String(err)))
        );
    });

    win.loadURL(STEAM_ORIGIN_PAGE).catch((err) => {
      // ERR_ABORTED from the /my/ → /profiles/<id>/ redirect is expected; the
      // did-finish-load handler will still fire for the final page.
      if (String(err).includes("ERR_ABORTED")) return;
      fail(err instanceof Error ? err : new Error(String(err)));
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
      const xml = await fetchMyGamesXml();

      logger.log(
        `[SteamAuth] games XML received (${xml.length} chars, first 200: ${xml
          .slice(0, 200)
          .replace(/\s+/g, " ")})`
      );

      // Not logged in → Steam serves the login page HTML, not the games XML.
      if (!xml.includes("<gamesList>") && !xml.includes("<steamID64>")) {
        logger.warn(
          "[SteamAuth] response is not a games XML document (likely logged out / redirected to login)"
        );
        return null;
      }

      const steamId = extractSteamId64FromXml(xml);
      if (!steamId) {
        logger.warn("[SteamAuth] could not extract steamID64 from XML");
        return null;
      }

      const games = parseSteamGamesXml(xml);
      logger.log(
        `[SteamAuth] authenticated session: ${games.length} owned games for ${steamId}`
      );
      return { steamId, games };
    } catch (err) {
      logger.warn(
        "[SteamAuth] authenticated owned-games fetch failed:",
        err instanceof Error ? err.message : String(err)
      );
      return null;
    }
  };

/** True when the persistent Steam session can read the owned-games list. */
export const isSteamSessionAuthenticated = async (): Promise<boolean> => {
  const session = await getAuthenticatedSteamOwnedGames();
  return session != null;
};
