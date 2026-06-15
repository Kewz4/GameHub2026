import axios from "axios";
import zlib from "node:zlib";
import { logger } from "./logger";

const CLIENT_ID = "46899977096215655";
const CLIENT_SECRET =
  "9d85c43b1482497dbbce61f6e4aa173a433796eeae2ca8c5f6129f2dc4de46d9";
// GOG's public client only accepts this exact redirect URI
const REDIRECT_URI = "https://embed.gog.com/on_login_success?origin=client";

export const GOG_AUTH_URL =
  `https://auth.gog.com/auth?client_id=${CLIENT_ID}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&response_type=code&layout=client2`;

export interface GogTokens {
  access_token: string;
  refresh_token: string;
  user_id: string;
  username: string;
}

export interface GogOwnedGame {
  id: number;
  title: string;
  image: string;
  url: string;
}

export const exchangeGogCode = async (code: string): Promise<GogTokens> => {
  const response = await axios.get("https://auth.gog.com/token", {
    params: {
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
    },
  });

  const { access_token, refresh_token, user_id, username } = response.data;
  return { access_token, refresh_token, user_id, username };
};

export const refreshGogToken = async (
  refreshToken: string
): Promise<GogTokens> => {
  const response = await axios.get("https://auth.gog.com/token", {
    params: {
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    },
  });

  const {
    access_token,
    refresh_token: newRefresh,
    user_id,
    username,
  } = response.data;
  return {
    access_token,
    refresh_token: newRefresh ?? refreshToken,
    user_id,
    username,
  };
};

export const getGogUserInfo = async (
  accessToken: string
): Promise<{ userId: string; username: string } | null> => {
  try {
    const response = await axios.get("https://embed.gog.com/userData.json", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return {
      userId: String(response.data.userId),
      username: response.data.username,
    };
  } catch (err) {
    logger.error("getGogUserInfo failed", err);
    return null;
  }
};

export const getGogOwnedGameIds = async (
  accessToken: string
): Promise<number[]> => {
  const response = await axios.get("https://embed.gog.com/user/data/games", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return response.data?.owned ?? [];
};

export interface GogRemoteAchievement {
  achievement_key: string;
  name: string;
  description: string;
  image_url_locked: string;
  image_url_unlocked: string;
  is_visible: boolean;
  date_unlocked: string | null;
}

export const getGogGamePlaytimeMs = async (
  accessToken: string,
  userId: string,
  clientId: string
): Promise<number> => {
  try {
    // Try the direct playtime summary endpoint first (fastest, single request)
    const playtimeRes = await axios.get(
      `https://gameplay.gog.com/clients/${clientId}/users/${userId}/playtime`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const totalSeconds =
      playtimeRes.data?.time_played ??
      playtimeRes.data?.playtime ??
      playtimeRes.data?.total_playtime;
    if (typeof totalSeconds === "number" && totalSeconds > 0) {
      return totalSeconds * 1000;
    }
  } catch {
    // fall through to sessions-based approach
  }

  try {
    // Fall back: sum all individual sessions (paginated)
    let totalSeconds = 0;
    let pageToken: string | undefined;

    do {
      const response = await axios.get(
        `https://gameplay.gog.com/clients/${clientId}/users/${userId}/sessions`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: {
            page_size: 200,
            ...(pageToken ? { page_token: pageToken } : {}),
          },
        }
      );
      const items: { time?: number }[] = response.data?.items ?? [];
      totalSeconds += items.reduce((sum, s) => sum + (s.time ?? 0), 0);
      pageToken = response.data?.next_page_token ?? undefined;
    } while (pageToken);

    return totalSeconds * 1000;
  } catch {
    return 0;
  }
};

export const getGogGameClientId = async (
  productId: string
): Promise<string | null> => {
  const credentials = await getGogGameCredentials(productId);
  return credentials?.clientId ?? null;
};

export interface GogGameCredentials {
  clientId: string;
  clientSecret: string;
}

const gameCredentialsCache = new Map<string, GogGameCredentials | null>();

/** Each GOG game has its own OAuth client (Galaxy "client_id"/"client_secret"),
 * stored in the game's v2 build meta JSON (zlib-compressed). The
 * gameplay.gog.com endpoints (achievements, playtime) only accept tokens
 * issued for the game's own client — the generic embed-client token is
 * rejected, which is why achievement fetches silently returned nothing. */
export const getGogGameCredentials = async (
  productId: string
): Promise<GogGameCredentials | null> => {
  if (gameCredentialsCache.has(productId)) {
    return gameCredentialsCache.get(productId)!;
  }

  try {
    const buildsRes = await axios.get(
      `https://content-system.gog.com/products/${productId}/os/windows/builds`,
      { params: { generation: 2 } }
    );
    const items: Array<{ link?: string }> = buildsRes.data?.items ?? [];
    const metaLink = items.find((i) => i.link)?.link;
    if (!metaLink) {
      gameCredentialsCache.set(productId, null);
      return null;
    }

    const metaRes = await axios.get<ArrayBuffer>(metaLink, {
      responseType: "arraybuffer",
      timeout: 15_000,
    });
    const raw = Buffer.from(metaRes.data);
    let meta: { clientId?: string; clientSecret?: string };
    try {
      meta = JSON.parse(zlib.inflateSync(raw).toString("utf8"));
    } catch {
      meta = JSON.parse(raw.toString("utf8"));
    }

    const credentials =
      meta.clientId && meta.clientSecret
        ? { clientId: meta.clientId, clientSecret: meta.clientSecret }
        : null;
    gameCredentialsCache.set(productId, credentials);
    return credentials;
  } catch (err) {
    logger.warn(`getGogGameCredentials failed for ${productId}`, err);
    gameCredentialsCache.set(productId, null);
    return null;
  }
};

/** Exchanges the user's refresh token for an access token scoped to a
 * specific game's OAuth client. `without_new_session=1` keeps the user's
 * main session/refresh token valid. */
export const getGogGameToken = async (
  refreshToken: string,
  credentials: GogGameCredentials
): Promise<string | null> => {
  try {
    const response = await axios.get("https://auth.gog.com/token", {
      params: {
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        without_new_session: 1,
      },
      timeout: 15_000,
    });
    return response.data?.access_token ?? null;
  } catch (err) {
    logger.warn("getGogGameToken failed", err);
    return null;
  }
};

export const getGogRemoteAchievements = async (
  accessToken: string,
  userId: string,
  clientId: string
): Promise<GogRemoteAchievement[]> => {
  try {
    const response = await axios.get(
      `https://gameplay.gog.com/clients/${clientId}/users/${userId}/achievements`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    return response.data?.items ?? [];
  } catch (err) {
    logger.error("getGogRemoteAchievements failed", err);
    return [];
  }
};

export const getGogGameDetails = async (
  productId: number
): Promise<{
  id: number;
  title: string;
  game_type: string;
  images: { logo2x: string; background: string };
} | null> => {
  try {
    const response = await axios.get(
      `https://api.gog.com/products/${productId}`,
      { params: { expand: "downloads" } }
    );
    return response.data;
  } catch {
    return null;
  }
};
