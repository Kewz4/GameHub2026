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


/**
 * Reads the owned-games XML by navigating a hidden BrowserWindow directly to
 * the games XML URL. Because we navigate to the URL itself (not a page that
 * then fetches it), Chromium carries the session cookies automatically and
 * renders the raw XML. We read `document.body.innerText` which returns the
 * plain XML text — this avoids both CORS issues (no cross-origin fetch needed)
 * and Chromium's XML-viewer DOM serialization artifacts.
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
        // -3 (ERR_ABORTED) fires for redirects — ignore (Steam redirects /my/ to
        // /profiles/<id>/ and we still get did-finish-load for the final URL).
        if (errorCode === -3) return;
        fail(
          new Error(
            `Steam XML page load failed (${errorCode} ${errorDescription}) for ${validatedURL}`
          )
        );
      }
    );

    win.webContents.on("did-finish-load", () => {
      if (settled) return;
      // The page is the XML document (or the login page if not authenticated).
      // document.body.innerText gives us the raw text of what the browser loaded.
      win.webContents
        .executeJavaScript(`document.body ? document.body.innerText : document.documentElement.innerText`, true)
        .then((text: string) => done(typeof text === "string" ? text : ""))
        .catch((err) =>
          fail(err instanceof Error ? err : new Error(String(err)))
        );
    });

    // Navigate directly to the XML URL. Chromium sends the session cookies
    // automatically and parses the XML — no fetch() call needed.
    win.loadURL(STEAM_MY_GAMES_XML).catch((err) => {
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
