import { session } from "electron";
import { logger } from "./logger";
import {
  extractSteamId64FromXml,
  parseSteamGamesXml,
  type SteamOwnedGame,
} from "./steam-account";
import { db, levelKeys } from "@main/level";
import type { UserPreferences } from "@types";

/** Dedicated persistent session so the Steam login cookies live independently
 *  from the rest of the app and survive restarts (mirrors persist:exophase). */
export const STEAM_AUTH_PARTITION = "persist:steam";

/** Steam login page. `goto` makes Steam redirect straight to the games XML for
 *  the authenticated user once login completes. */
export const STEAM_LOGIN_URL =
  "https://steamcommunity.com/login/home/?goto=my/games?xml=1";

/**
 * Reads the owned-games XML using the `persist:steam` session's OWN `fetch`.
 *
 * We use the profile-specific URL (`/profiles/<steamId>/games`) instead of
 * `/my/games` to avoid ERR_TOO_MANY_REDIRECTS: `/my/` triggers a redirect
 * chain that Chromium sometimes detects as a loop when the session cookie
 * isn't re-sent to the redirect target. The profile URL skips that chain
 * entirely. When the steamId isn't known yet (first sync), we fall back to
 * `/my/` — the user will have the ID in prefs after a successful sync.
 */
async function fetchMyGamesXml(steamId?: string | null): Promise<string> {
  const ses = session.fromPartition(STEAM_AUTH_PARTITION);

  const url = steamId
    ? `https://steamcommunity.com/profiles/${steamId}/games?tab=all&xml=1`
    : "https://steamcommunity.com/my/games?tab=all&xml=1";

  logger.log(`[SteamAuth] fetching games XML from ${url}`);

  const response = await ses.fetch(url, {
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
      // Read persisted steamId so we can use the profile-specific URL and
      // avoid the /my/ → /profiles/<id>/ redirect loop (ERR_TOO_MANY_REDIRECTS).
      const prefs = await db
        .get<string, UserPreferences | null>(levelKeys.userPreferences, {
          valueEncoding: "json",
        })
        .catch(() => null);
      const xml = await fetchMyGamesXml(prefs?.steamId);

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
