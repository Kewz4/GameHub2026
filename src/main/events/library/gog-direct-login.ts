import { registerEvent } from "../register-event";
import axios from "axios";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";
import { exchangeGogCode } from "@main/services/gog-account";
import { writeGogdlAuthConfig } from "@main/services/gogdl";
import { logger } from "@main/services";

const GOG_CLIENT_ID = "46899977096215655";
const GOG_REDIRECT_URI = "https://embed.gog.com/on_login_success?origin=client";
const GOG_AUTH_URL =
  `https://auth.gog.com/auth?client_id=${GOG_CLIENT_ID}` +
  `&redirect_uri=${encodeURIComponent(GOG_REDIRECT_URI)}` +
  `&response_type=code&layout=client2`;

export type GogLoginResult =
  | { success: true; username: string; refresh_token: string }
  | { success: false; error: string };

const gogDirectLogin = async (
  _event: Electron.IpcMainInvokeEvent,
  email: string,
  password: string
): Promise<GogLoginResult> => {
  try {
    const jar = new CookieJar();
    const client = wrapper(axios.create({
      jar,
      maxRedirects: 10,
      withCredentials: true,
    }));

    // Step 1: GET the auth page to collect cookies and CSRF token from the login form
    const authResp = await client.get(GOG_AUTH_URL, {
      headers: { "User-Agent": "GameHub Launcher" },
    });

    const html = authResp.data as string;
    // Extract CSRF token from the form field: name="login[_token]" value="..."
    const csrfMatch = html.match(/name="login\[_token\]"\s+value="([^"]+)"/);
    if (!csrfMatch) {
      // Try alternate pattern
      const altMatch = html.match(/"_token[^"]*"\s*value="([^"]+)"/);
      if (!altMatch) {
        logger.error("GOG direct login: could not extract CSRF token from login form");
        return { success: false, error: "Unable to reach GOG login servers. Please try again." };
      }
    }
    const csrfToken = csrfMatch?.[1] ?? html.match(/"_token[^"]*"\s*value="([^"]+)"/)?.[1] ?? "";

    // Step 2: POST credentials to the GOG login endpoint
    const loginResp = await client.post(
      "https://login.gog.com/login_check",
      new URLSearchParams({
        "login[username]": email,
        "login[password]": password,
        "login[_token]": csrfToken,
        "login[remember]": "1",
      }).toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "GameHub Launcher",
          Referer: "https://login.gog.com/login",
        },
        maxRedirects: 0,
        validateStatus: (s) => s < 400 || s === 302,
      }
    );

    // Step 3: Follow redirects manually to find the code
    let code: string | null = null;
    let location = loginResp.headers.location as string | undefined;

    // Follow up to 10 redirects to find the code
    for (let i = 0; i < 10 && location && !code; i++) {
      if (location.includes("on_login_success")) {
        try { code = new URL(location).searchParams.get("code"); } catch { /* ignore */ }
        break;
      }
      const nextResp = await client.get(location.startsWith("http") ? location : `https://login.gog.com${location}`, {
        maxRedirects: 0,
        validateStatus: (s) => s < 400 || s === 302,
      });
      location = nextResp.headers.location as string | undefined;
      if (!location && nextResp.request?.res?.responseUrl) {
        location = nextResp.request.res.responseUrl;
      }
    }

    if (!code) {
      // Check if login failed (still on login page)
      return { success: false, error: "Invalid email or password." };
    }

    // Step 4: Exchange code for tokens
    const tokens = await exchangeGogCode(code);
    writeGogdlAuthConfig(tokens.access_token, tokens.refresh_token);

    return { success: true, username: tokens.username, refresh_token: tokens.refresh_token };
  } catch (err) {
    logger.error("GOG direct login failed", err);
    return { success: false, error: "Login failed. Check your credentials and try again." };
  }
};

registerEvent("gogDirectLogin", gogDirectLogin);
