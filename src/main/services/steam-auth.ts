import { session } from "electron";
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
 * Reads the owned-games XML using the `persist:steam` session's OWN `fetch`.
 *
 * `Session.fetch` (Electron ≥22) issues the request through Chromium's network
 * stack *bound to that session's cookie jar* — so it automatically sends the
 * httpOnly `steamLoginSecure` login cookie and follows Steam's in-session
 * redirects. This is what makes it work where the alternatives failed:
 *   • A BrowserWindow navigated to the XML URL wraps the document in Chromium's
 *     XML viewer, so `innerText` returns HTML, not the raw XML.
 *   • A renderer-context `fetch()` is blocked by CORS/CSP.
 *   • `net.fetch` (default session) and a hand-built Cookie header don't carry
 *     the partition's httpOnly cookies, so Steam 302-redirects to /login.
 *
 * Verified live (2026-06): the games XML now requires an authenticated session
 * for ALL profiles — an unauthenticated request 302-redirects to /login, which
 * we detect below (no <gamesList>/<steamID64>) and treat as "logged out".
 */
async function fetchMyGamesXml(): Promise<string> {
  const ses = session.fromPartition(STEAM_AUTH_PARTITION);

  const response = await ses.fetch(STEAM_MY_GAMES_XML, {
    // Follow the /my/ → /profiles/<id>/games redirect within the session so the
    // login cookie is re-sent to the resolved URL.
    redirect: "follow",
    headers: {
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
