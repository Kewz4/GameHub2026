import { session, net } from "electron";
import { logger } from "./logger";
import { type SteamOwnedGame } from "./steam-account";

/** Dedicated persistent session so the Steam login cookies live independently
 *  from the rest of the app and survive restarts (mirrors persist:exophase). */
export const STEAM_AUTH_PARTITION = "persist:steam";

/** Steam login page. */
export const STEAM_LOGIN_URL = "https://steamcommunity.com/login/home/";

/**
 * Reads the SteamID64 and JWT access token from the session's `steamLoginSecure`
 * login cookie.
 *
 * The cookie value is `<steamid64>||<jwt_token>` (URL-encoded, so the `||`
 * arrives as `%7C%7C`).
 */
async function readSteamCredentialsFromCookie(
  ses: Electron.Session
): Promise<{ steamId: string; accessToken: string } | null> {
  const cookies = await ses.cookies
    .get({ name: "steamLoginSecure" })
    .catch(() => []);
  for (const c of cookies) {
    const raw = decodeURIComponent(c.value ?? "");
    const [id, token] = raw.split("||");
    const steamId = id?.trim();
    const accessToken = token?.trim();
    if (/^\d{17}$/.test(steamId) && accessToken) {
      return { steamId, accessToken };
    }
  }
  return null;
}

/**
 * Fetches a URL through the `persist:steam` session using Electron's `net`
 * module bound to that session.
 *
 * Uses `useSessionCookies: true` so authenticated requests work, and
 * `redirect: "manual"` to detect Steam's login redirect without looping.
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
    request.setHeader("Accept", "application/json,*/*;q=0.9");
    request.setHeader("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)");

    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    request.on("redirect", (statusCode, _method, redirectUrl) => {
      const toLogin = /\/login/i.test(redirectUrl);
      logger.warn(
        `[SteamAuth] request to ${url} redirected (${statusCode}) → ${redirectUrl}`
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
 * Fetches the owned games for the authenticated `persist:steam` session by
 * using the JWT access token from the `steamLoginSecure` cookie as an
 * `access_token` parameter to `IPlayerService/GetOwnedGames/v1`.
 *
 * Steam removed the community XML endpoint (`/games?xml=1`) in 2026 — it now
 * returns HTML for all profiles regardless of auth status. The JWT token in the
 * login cookie is a valid OAuth2-style bearer that the Web API accepts without
 * a separate API key.
 */
async function fetchMyGamesViaApi(): Promise<{
  steamId: string | null;
  games: SteamOwnedGame[];
  loggedOut: boolean;
}> {
  const ses = session.fromPartition(STEAM_AUTH_PARTITION);

  const credentials = await readSteamCredentialsFromCookie(ses);
  if (!credentials) {
    logger.warn("[SteamAuth] no steamLoginSecure cookie — not logged in");
    return { steamId: null, games: [], loggedOut: true };
  }

  const { steamId, accessToken } = credentials;
  const url =
    `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/` +
    `?access_token=${encodeURIComponent(accessToken)}` +
    `&steamid=${steamId}` +
    `&include_appinfo=true` +
    `&include_played_free_games=true` +
    `&format=json`;

  logger.log(`[SteamAuth] fetching owned games via IPlayerService for ${steamId}`);

  const { status, body, redirectedToLogin } = await sessionGet(ses, url);

  if (redirectedToLogin) {
    return { steamId: null, games: [], loggedOut: true };
  }
  if (status === 401 || status === 403) {
    logger.warn(`[SteamAuth] access token rejected (HTTP ${status}) — session expired`);
    return { steamId: null, games: [], loggedOut: true };
  }
  if (status < 200 || status >= 300) {
    throw new Error(`Steam IPlayerService returned HTTP ${status}`);
  }

  let parsed: { response?: { game_count?: number; games?: RawApiGame[] } };
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("Steam IPlayerService returned non-JSON response");
  }

  const raw = parsed?.response?.games ?? [];
  const games: SteamOwnedGame[] = raw.map((g) => ({
    appid: g.appid,
    name: g.name,
    img_icon_url: g.img_icon_url ?? "",
    playtime_forever: g.playtime_forever ?? 0,
  }));

  return { steamId, games, loggedOut: false };
}

interface RawApiGame {
  appid: number;
  name: string;
  img_icon_url?: string;
  playtime_forever?: number;
}

export interface SteamAuthSession {
  steamId: string;
  games: SteamOwnedGame[];
}

/**
 * Reads the owned games for the currently logged-in Steam session (if any).
 * Returns null when the session is missing/expired.
 */
export const getAuthenticatedSteamOwnedGames =
  async (): Promise<SteamAuthSession | null> => {
    try {
      const { steamId, games, loggedOut } = await fetchMyGamesViaApi();

      if (loggedOut || !steamId) {
        logger.warn("[SteamAuth] not authenticated (no cookie or token rejected)");
        return null;
      }

      logger.log(
        `[SteamAuth] authenticated session: ${games.length} owned games for ${steamId}`
      );
      return { steamId, games };
    } catch (err) {
      logger.warn(
        "[SteamAuth] owned-games fetch failed:",
        err instanceof Error ? err.message : String(err)
      );
      return null;
    }
  };

/** True when the persistent Steam session can read the owned-games list. */
export const isSteamSessionAuthenticated = async (): Promise<boolean> => {
  const result = await getAuthenticatedSteamOwnedGames();
  return result != null;
};
