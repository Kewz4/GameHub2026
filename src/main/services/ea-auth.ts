import axios from "axios";
import { session } from "electron";
import { logger } from "./logger";

/**
 * EA OAuth — cookie-based two-step flow.
 *
 * EA's OAuth server rejects many redirect_uri values for ORIGIN_SPA_ID,
 * so instead of relying on an OAuth redirect we:
 *   1. LOGIN: render the EA accounts login page directly (no OAuth params that
 *      require a whitelisted redirect_uri). The user signs in; EA sets the
 *      `remid` and `sid` session cookies on .ea.com.
 *   2. TOKEN: once those cookies exist in the session partition, GET
 *      connect/auth with client_id=ORIGIN_JS_SDK, response_type=token,
 *      redirect_uri=nucleus:rest, prompt=none — EA replies with a JSON body
 *      {"access_token": ...} which we parse from the page text.
 *
 * No redirect_uri needed for the login step, so no "redirect_uri is invalid"
 * error. The `remid` cookie is our signal that the user logged in.
 */
export const EA_AUTH_PARTITION = "persist:ea-auth";

// Step 1 — direct EA login page, no OAuth params needed.
export const EA_LOGIN_URL = "https://accounts.ea.com/p/web2/login";

// Step 2 — silent token exchange (token-capable client + prompt=none).
export const EA_TOKEN_URL =
  "https://accounts.ea.com/connect/auth" +
  "?response_type=token" +
  "&client_id=ORIGIN_JS_SDK" +
  "&redirect_uri=nucleus:rest" +
  "&release_type=prod" +
  "&prompt=none" +
  "&locale=en_US";

export interface EaTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: string | number;
  error?: string;
  error_description?: string;
}

export const parseEaAuthJson = (text: string): EaTokenResponse | null => {
  try {
    const parsed = JSON.parse(text.trim());
    return parsed && typeof parsed === "object"
      ? (parsed as EaTokenResponse)
      : null;
  } catch {
    return null;
  }
};

/**
 * Re-acquire an access token using the remid/sid cookies persisted in the
 * auth window's session partition — lets library syncs keep working after
 * the short-lived (1h) access token expires, without prompting the user.
 */
export const refreshEaTokenSilently = async (): Promise<{
  accessToken: string;
  expiresIn: number;
} | null> => {
  try {
    const ses = session.fromPartition(EA_AUTH_PARTITION);
    const cookies = await ses.cookies.get({ domain: ".ea.com" });
    if (cookies.length === 0) return null;

    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const res = await axios.get<EaTokenResponse>(EA_TOKEN_URL, {
      headers: { Cookie: cookieHeader },
      timeout: 15_000,
    });

    const data = res.data;
    if (data?.access_token) {
      return {
        accessToken: data.access_token,
        expiresIn: Number(data.expires_in ?? 3600),
      };
    }
    return null;
  } catch (err) {
    logger.warn("EA silent token refresh failed", err);
    return null;
  }
};
