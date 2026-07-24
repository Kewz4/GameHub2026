import crypto from "node:crypto";
import { BrowserWindow } from "electron";
import axios from "axios";

import { db, levelKeys } from "@main/level";
import {
  spotifyAuthSublevel,
  SPOTIFY_AUTH_KEY,
  type SpotifyAuth,
} from "@main/level/sublevels/spotify-auth";
import type {
  SpotifyControlAction,
  SpotifyNowPlaying,
  SpotifyStatus,
  UserPreferences,
} from "@types";
import { logger } from "./logger";

// Loopback redirect the user registers in their Spotify app. We never actually
// serve it — the auth window's navigation to it is intercepted to read `code`.
const REDIRECT_URI = "http://127.0.0.1:8888/callback";
const SCOPES = [
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
].join(" ");
const AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API = "https://api.spotify.com/v1";

interface SpotifyTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

interface SpotifyPlayerResponse {
  is_playing?: boolean;
  progress_ms?: number;
  device?: { name?: string } | null;
  item?: {
    name?: string;
    duration_ms?: number;
    artists?: { name?: string }[];
    album?: { name?: string; images?: { url?: string }[] };
    external_urls?: { spotify?: string };
  } | null;
}

const base64url = (buffer: Buffer) =>
  buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const resolveClientId = async (): Promise<string | null> => {
  const envId = process.env.MAIN_VITE_SPOTIFY_CLIENT_ID;
  if (envId) return envId;
  const prefs = await db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);
  return prefs?.spotifyClientId?.trim() || null;
};

/**
 * Spotify integration for the overlay's Now-playing widget. Auth is
 * Authorization Code + PKCE (no client secret): "Log in with Spotify" opens an
 * auth window, we intercept the redirect to grab the code, exchange it for
 * tokens, and refresh them as needed. Playback is read/controlled via the Web
 * API against whatever device the user is already playing on.
 */
export class SpotifyService {
  private static authWindow: BrowserWindow | null = null;

  static async getStatus(): Promise<SpotifyStatus> {
    const clientId = await resolveClientId();
    const tokens = await spotifyAuthSublevel
      .get(SPOTIFY_AUTH_KEY)
      .catch(() => null);
    return {
      configured: Boolean(clientId),
      connected: Boolean(tokens?.refreshToken),
    };
  }

  static async login(): Promise<SpotifyStatus> {
    const clientId = await resolveClientId();
    if (!clientId) throw new Error("spotify/not-configured");

    const verifier = base64url(crypto.randomBytes(64));
    const challenge = base64url(
      crypto.createHash("sha256").update(verifier).digest()
    );
    const state = base64url(crypto.randomBytes(16));

    const authUrl = `${AUTHORIZE_URL}?${new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      code_challenge_method: "S256",
      code_challenge: challenge,
      scope: SCOPES,
      state,
    }).toString()}`;

    const code = await this.runAuthWindow(authUrl, state);
    await this.exchangeCode(clientId, code, verifier);
    return this.getStatus();
  }

  static async logout(): Promise<SpotifyStatus> {
    await spotifyAuthSublevel.del(SPOTIFY_AUTH_KEY).catch(() => undefined);
    return this.getStatus();
  }

  static async getNowPlaying(): Promise<SpotifyNowPlaying | null> {
    const token = await this.getAccessToken();
    if (!token) return null;
    try {
      const resp = await axios.get<SpotifyPlayerResponse>(`${API}/me/player`, {
        headers: { Authorization: `Bearer ${token}` },
        validateStatus: (status) => status === 200 || status === 204,
      });
      const data = resp.data;
      const item = data?.item;
      if (resp.status === 204 || !item) return null;
      return {
        isPlaying: Boolean(data.is_playing),
        trackName: item.name ?? "",
        artists: (item.artists ?? [])
          .map((artist) => artist.name)
          .filter(Boolean)
          .join(", "),
        albumName: item.album?.name ?? "",
        albumImageUrl: item.album?.images?.[0]?.url ?? null,
        durationMs: item.duration_ms ?? 0,
        progressMs: data.progress_ms ?? 0,
        trackUrl: item.external_urls?.spotify ?? null,
        deviceName: data.device?.name ?? null,
      };
    } catch (err) {
      logger.debug("Spotify now-playing fetch failed", err);
      return null;
    }
  }

  static async control(action: SpotifyControlAction): Promise<boolean> {
    const token = await this.getAccessToken();
    if (!token) return false;
    const headers = { Authorization: `Bearer ${token}`, "Content-Length": "0" };
    try {
      if (action === "play") {
        await axios.put(`${API}/me/player/play`, null, { headers });
      } else if (action === "pause") {
        await axios.put(`${API}/me/player/pause`, null, { headers });
      } else if (action === "next") {
        await axios.post(`${API}/me/player/next`, null, { headers });
      } else {
        await axios.post(`${API}/me/player/previous`, null, { headers });
      }
      return true;
    } catch (err) {
      logger.debug(`Spotify control (${action}) failed`, err);
      return false;
    }
  }

  private static runAuthWindow(
    authUrl: string,
    expectedState: string
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      this.closeAuthWindow();
      const win = new BrowserWindow({
        width: 460,
        height: 760,
        title: "Log in with Spotify",
        autoHideMenuBar: true,
        webPreferences: {
          sandbox: true,
          nodeIntegration: false,
          contextIsolation: true,
        },
      });
      this.authWindow = win;

      let settled = false;
      const finish = (err: Error | null, code?: string) => {
        if (settled) return;
        settled = true;
        if (!win.isDestroyed()) win.destroy();
        this.authWindow = null;
        if (err) reject(err);
        else resolve(code as string);
      };

      const handleUrl = (url: string): boolean => {
        if (!url.startsWith(REDIRECT_URI)) return false;
        try {
          const parsed = new URL(url);
          const error = parsed.searchParams.get("error");
          const returnedState = parsed.searchParams.get("state");
          const code = parsed.searchParams.get("code");
          if (error) finish(new Error(`spotify/${error}`));
          else if (returnedState !== expectedState)
            finish(new Error("spotify/state-mismatch"));
          else if (code) finish(null, code);
          else finish(new Error("spotify/no-code"));
        } catch (err) {
          finish(err as Error);
        }
        return true;
      };

      win.webContents.on("will-redirect", (event, url) => {
        if (handleUrl(url)) event.preventDefault();
      });
      win.webContents.on("will-navigate", (event, url) => {
        if (handleUrl(url)) event.preventDefault();
      });
      win.on("closed", () => finish(new Error("spotify/window-closed")));
      win.loadURL(authUrl).catch(() => undefined);
    });
  }

  private static async exchangeCode(
    clientId: string,
    code: string,
    verifier: string
  ) {
    const resp = await axios.post<SpotifyTokenResponse>(
      TOKEN_URL,
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: clientId,
        code_verifier: verifier,
      }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    await this.storeTokens(resp.data);
  }

  private static async storeTokens(
    data: SpotifyTokenResponse,
    previousRefresh?: string
  ) {
    const auth: SpotifyAuth = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? previousRefresh ?? "",
      expiresAt: Date.now() + (Number(data.expires_in ?? 3600) - 60) * 1000,
    };
    await spotifyAuthSublevel.put(SPOTIFY_AUTH_KEY, auth);
  }

  private static async getAccessToken(): Promise<string | null> {
    const tokens = await spotifyAuthSublevel
      .get(SPOTIFY_AUTH_KEY)
      .catch(() => null);
    if (!tokens?.refreshToken) return null;
    if (Date.now() < tokens.expiresAt) return tokens.accessToken;

    const clientId = await resolveClientId();
    if (!clientId) return null;
    try {
      const resp = await axios.post<SpotifyTokenResponse>(
        TOKEN_URL,
        new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: tokens.refreshToken,
          client_id: clientId,
        }).toString(),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
      );
      await this.storeTokens(resp.data, tokens.refreshToken);
      return resp.data.access_token;
    } catch (err) {
      logger.warn("Spotify token refresh failed", err);
      return null;
    }
  }

  private static closeAuthWindow() {
    if (this.authWindow && !this.authWindow.isDestroyed()) {
      this.authWindow.destroy();
    }
    this.authWindow = null;
  }
}
