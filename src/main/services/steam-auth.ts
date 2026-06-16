import { net, session } from "electron";
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

/** The authenticated owned-games XML. `tab=all` returns the FULL owned list. */
const STEAM_MY_GAMES_XML =
  "https://steamcommunity.com/my/games?tab=all&xml=1";


/**
 * Reads the owned-games XML from the main process using Electron's `net.fetch`,
 * which uses Chromium's network stack (not Node's http). We manually extract
 * cookies from the `persist:steam` session partition (the main process CAN read
 * httpOnly cookies via `session.cookies.get`) and attach them as a Cookie header
 * — bypassing both the BrowserWindow XML-viewer problem (Chromium wraps XML in
 * its viewer DOM so `innerText` gives HTML, not raw XML) and the renderer-context
 * CORS/CSP issues that blocked in-page `fetch()` calls.
 */
async function fetchMyGamesXml(): Promise<string> {
  const ses = session.fromPartition(STEAM_AUTH_PARTITION);

  // Read ALL cookies for steamcommunity.com — includes httpOnly ones because
  // the main process is trusted and isn't subject to the JS httpOnly restriction.
  const cookies = await ses.cookies.get({ url: "https://steamcommunity.com" });
  if (cookies.length === 0) {
    throw new Error("No Steam session cookies found — user is not logged in");
  }

  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

  const response = await net.fetch(STEAM_MY_GAMES_XML, {
    headers: {
      Cookie: cookieHeader,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "text/xml,application/xml,*/*;q=0.9",
      Referer: "https://steamcommunity.com/",
    },
  });

  if (!response.ok) {
    throw new Error(`Steam XML fetch returned HTTP ${response.status}`);
  }

  return response.text();
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
