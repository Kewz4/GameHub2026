import { session, net } from "electron";
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

/**
 * Reads the SteamID64 out of the session's `steamLoginSecure` login cookie.
 *
 * The cookie value is `<steamid64>||<token>` (URL-encoded, so the `||` arrives
 * as `%7C%7C`). Deriving the id from the cookie lets us hit the profile-specific
 * games URL directly (`/profiles/<id>/games`) and avoids Steam's `/my/` →
 * `/profiles/<id>/` redirect chain entirely.
 */
async function readSteamIdFromCookie(
  ses: Electron.Session
): Promise<string | null> {
  const cookies = await ses.cookies
    .get({ name: "steamLoginSecure" })
    .catch(() => []);
  for (const c of cookies) {
    // Prefer the community cookie, but accept any steamLoginSecure.
    const raw = decodeURIComponent(c.value ?? "");
    const id = raw.split("||")[0]?.trim();
    if (/^\d{17}$/.test(id)) return id;
  }
  return null;
}

/**
 * Fetches a URL through the `persist:steam` session using Electron's `net`
 * module bound to that session.
 *
 * This is the correct replacement for `Session.fetch`, which followed Steam's
 * redirect-to-login chain into an infinite loop (ERR_TOO_MANY_REDIRECTS):
 *   • `useSessionCookies: true` sends the session's cookies — INCLUDING the
 *     httpOnly `steamLoginSecure` login cookie — so authenticated requests work.
 *   • `redirect: "manual"` means we DETECT a 30x redirect (Steam bouncing an
 *     unauthenticated/expired request to /login) and treat it as "logged out"
 *     instead of following it and looping forever.
 *
 * Resolves `{ status, body, redirectedToLogin }`.
 */
function sessionGet(
  ses: Electron.Session,
  url: string
): Promise<{ status: number; body: string; redirectedToLogin: boolean }> {
  return new Promise((resolve, reject) => {
    const request = net.request({
      method: "GET",
      url,
      session: ses,
      useSessionCookies: true,
      redirect: "manual",
    });
    request.setHeader("Accept", "text/xml,application/xml,*/*;q=0.9");
    request.setHeader("Referer", "https://steamcommunity.com/");

    let settled = false;
    const settle = (
      fn: () => void
    ) => {
      if (settled) return;
      settled = true;
      fn();
    };

    // Steam bounces unauthenticated/expired requests to /login via a 30x.
    // In manual redirect mode the request is cancelled unless we follow it —
    // we deliberately don't, so this never loops (the old ERR_TOO_MANY_REDIRECTS).
    request.on("redirect", (statusCode, _method, redirectUrl) => {
      const toLogin = /\/login/i.test(redirectUrl);
      logger.warn(
        `[SteamAuth] request to ${url} redirected (${statusCode}) → ${redirectUrl} (login=${toLogin})`
      );
      settle(() =>
        resolve({ status: statusCode, body: "", redirectedToLogin: toLogin })
      );
      request.abort();
    });

    request.on("response", (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () =>
        settle(() =>
          resolve({
            status: response.statusCode,
            body: Buffer.concat(chunks).toString("utf8"),
            redirectedToLogin: false,
          })
        )
      );
      response.on("error", (err: Error) => settle(() => reject(err)));
    });

    request.on("error", (err) => settle(() => reject(err)));
    request.end();
  });
}

/**
 * Reads the owned-games XML for the authenticated `persist:steam` session.
 *
 * Steam now requires an authenticated session for the games XML on ALL profiles
 * (verified live 2026-06: an unauthenticated request — even for a PUBLIC
 * profile — 302-redirects to /login). We therefore derive the SteamID from the
 * login cookie and request the profile-specific games XML through the session.
 */
async function fetchMyGamesXml(): Promise<{
  xml: string | null;
  loggedOut: boolean;
}> {
  const ses = session.fromPartition(STEAM_AUTH_PARTITION);

  const steamId = await readSteamIdFromCookie(ses);
  if (!steamId) {
    logger.warn("[SteamAuth] no steamLoginSecure cookie — not logged in");
    return { xml: null, loggedOut: true };
  }

  const url = `https://steamcommunity.com/profiles/${steamId}/games?tab=all&xml=1`;
  logger.log(`[SteamAuth] fetching games XML for ${steamId}`);

  const { status, body, redirectedToLogin } = await sessionGet(ses, url);

  if (redirectedToLogin) {
    return { xml: null, loggedOut: true };
  }
  if (status < 200 || status >= 300) {
    throw new Error(`Steam XML fetch returned HTTP ${status}`);
  }
  return { xml: body, loggedOut: false };
}

export interface SteamAuthSession {
  steamId: string;
  games: SteamOwnedGame[];
}

/**
 * Reads the owned games for the currently logged-in Steam session (if any).
 * Returns null when the session is missing/expired — i.e. Steam redirected the
 * request to /login or the document wasn't a games XML.
 */
export const getAuthenticatedSteamOwnedGames =
  async (): Promise<SteamAuthSession | null> => {
    try {
      const { xml, loggedOut } = await fetchMyGamesXml();

      if (loggedOut || !xml) {
        logger.warn(
          "[SteamAuth] not authenticated (redirected to login or no cookie)"
        );
        return null;
      }

      logger.log(
        `[SteamAuth] games XML received (${xml.length} chars, first 200: ${xml
          .slice(0, 200)
          .replace(/\s+/g, " ")})`
      );

      // Defensive: if Steam ever serves login HTML at 200, bail out cleanly.
      if (!xml.includes("<gamesList>") && !xml.includes("<steamID64>")) {
        logger.warn(
          "[SteamAuth] response is not a games XML document (likely logged out)"
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
