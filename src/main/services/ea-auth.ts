import axios from "axios";
import { logger } from "./logger";
import { generateEaPcSign } from "./ea-pcsign";

/**
 * EA OAuth — JUNO_PC_CLIENT (EA App) flow.
 *
 * The legacy ORIGIN_JS_SDK web token is rejected by EA's modern "Juno" backend
 * (service-aggregation-layer.juno.ea.com) with error 10007, and Origin's
 * ecommerce hosts were retired in 2025. The EA App itself authenticates with
 * the JUNO_PC_CLIENT client, which requires a `pc_sign` machine signature
 * (see ea-pcsign.ts) and uses the standard OAuth authorization-code grant:
 *
 *   1. LOGIN: open connect/auth?response_type=code&client_id=JUNO_PC_CLIENT
 *      &display=junoClient/login&redirect_uri=qrc:///html/login_successful.html
 *      &pc_sign=<sign>. After the user signs in, EA redirects to
 *      qrc:///html/login_successful.html?code=<authCode>.
 *   2. TOKEN: POST connect/token (authorization_code grant) with the client id,
 *      client secret, code_verifier and code → access_token + refresh_token.
 *
 * The resulting access token IS accepted by Juno, so owned-games queries work.
 */
export const EA_AUTH_PARTITION = "persist:ea-auth";

const JUNO_CLIENT_ID = "JUNO_PC_CLIENT";
// Client secret shared by the EA App (not user-specific). Required by the
// connect/token authorization-code + refresh_token grants for JUNO_PC_CLIENT.
const JUNO_CLIENT_SECRET =
  "4mRLtYMb6vq9qglomWEaT4ChxsXWcyqbQpuBNfMPOYOiDmYYQmjuaBsF2Zp0RyVeWkfqhE9TuGgAw7te";
const JUNO_REDIRECT_URI = "qrc:///html/login_successful.html";
const EA_TOKEN_ENDPOINT = "https://accounts.ea.com/connect/token";

/** The login URL the auth window navigates to. A fresh pc_sign is generated per
 *  call so the timestamp inside it is current. */
export const buildEaLoginUrl = (): string => {
  const pcSign = generateEaPcSign("v1");
  return (
    "https://accounts.ea.com/connect/auth" +
    "?response_type=code" +
    `&client_id=${JUNO_CLIENT_ID}` +
    "&display=junoClient/login" +
    `&redirect_uri=${encodeURIComponent(JUNO_REDIRECT_URI)}` +
    "&release_type=prod" +
    "&locale=en_US" +
    `&pc_sign=${encodeURIComponent(pcSign)}`
  );
};

/** True when a URL is the post-login redirect carrying the authorization code. */
export const isEaLoginRedirect = (url: string): boolean =>
  url.startsWith("qrc:") && url.includes("login_successful");

/** Extracts the `code` query param from the qrc:// login redirect (or null). */
export const extractEaAuthCode = (url: string): string | null => {
  const queryIdx = url.indexOf("?");
  if (queryIdx < 0) return null;
  const params = new URLSearchParams(url.slice(queryIdx + 1));
  return params.get("code");
};

export interface EaTokenResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/** A random PKCE-style code_verifier (EA accepts any URL-safe value here). */
const randomCodeVerifier = (): string => {
  const chars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let raw = "";
  for (let i = 0; i < 32; i++) {
    raw += chars[Math.floor(Math.random() * chars.length)];
  }
  return Buffer.from(raw).toString("base64").replace(/=+$/, "");
};

/** Exchanges the authorization code from the login redirect for tokens. */
export const exchangeEaAuthCode = async (
  code: string
): Promise<EaTokenResult> => {
  const body = new URLSearchParams({
    token_format: "JWS",
    client_id: JUNO_CLIENT_ID,
    client_secret: JUNO_CLIENT_SECRET,
    code_verifier: randomCodeVerifier(),
    grant_type: "authorization_code",
    redirect_uri: JUNO_REDIRECT_URI,
    code,
  });

  const res = await axios.post(EA_TOKEN_ENDPOINT, body.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 15_000,
  });

  const data = res.data ?? {};
  if (!data.access_token || !data.refresh_token) {
    throw new Error(
      `EA token exchange returned no token: ${JSON.stringify(data).slice(0, 200)}`
    );
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: Number(data.expires_in ?? 3600),
  };
};

/**
 * Refreshes the access token using a stored refresh token. Access tokens live
 * ~1h; this lets library syncs keep working without re-prompting the user.
 */
export const refreshEaAccessToken = async (
  refreshToken: string
): Promise<EaTokenResult | null> => {
  try {
    const body = new URLSearchParams({
      client_id: JUNO_CLIENT_ID,
      client_secret: JUNO_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    const res = await axios.post(EA_TOKEN_ENDPOINT, body.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15_000,
    });
    const data = res.data ?? {};
    if (!data.access_token) return null;
    return {
      accessToken: data.access_token,
      // EA may or may not rotate the refresh token; keep the old one if absent.
      refreshToken: data.refresh_token ?? refreshToken,
      expiresIn: Number(data.expires_in ?? 3600),
    };
  } catch (err) {
    logger.warn("EA token refresh failed", err);
    return null;
  }
};

/**
 * Back-compat shim for existing callers (sync-ea-library) that import
 * `refreshEaTokenSilently`. Reads the persisted refresh token and refreshes.
 */
export const refreshEaTokenSilently = async (): Promise<{
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
} | null> => {
  const { db, levelKeys } = await import("@main/level");
  const prefs = await db
    .get<
      string,
      { eaRefreshToken?: string } | null
    >(levelKeys.userPreferences, { valueEncoding: "json" })
    .catch(() => null);
  if (!prefs?.eaRefreshToken) return null;
  const refreshed = await refreshEaAccessToken(prefs.eaRefreshToken);
  if (!refreshed) return null;
  return {
    accessToken: refreshed.accessToken,
    expiresIn: refreshed.expiresIn,
    refreshToken: refreshed.refreshToken,
  };
};
