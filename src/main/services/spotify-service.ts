import crypto from "node:crypto";
import http from "node:http";
import { safeStorage, shell } from "electron";
import axios, { type AxiosRequestConfig } from "axios";

import { db, levelKeys } from "@main/level";
import {
  spotifyAuthSublevel,
  SPOTIFY_AUTH_KEY,
  type SpotifyEncryptedAuth,
  type SpotifyLegacyAuth,
} from "@main/level/sublevels/spotify-auth";
import type {
  SpotifyAccount,
  SpotifyContentItem,
  SpotifyContentType,
  SpotifyControlAction,
  SpotifyDevice,
  SpotifyHome,
  SpotifyNowPlaying,
  SpotifyPage,
  SpotifyPlaybackState,
  SpotifyProviderError,
  SpotifyQueue,
  SpotifyResult,
  SpotifySearchResults,
  SpotifySecureStorageStatus,
  SpotifyStatus,
  UserPreferences,
} from "@types";
import {
  parseSpotifyCallbackRequest,
  parseSpotifyControlAction,
  parseSpotifyLibraryUris,
  parseSpotifyPlaybackCommand,
  parseSpotifyPlaylistItemsRequest,
  parseSpotifySavedItemRequest,
  parseSpotifySearchQuery,
  sixCalendarMonthsAfter,
  SpotifyInputValidationError,
  SpotifyRateLimitGate,
} from "./spotify-helpers";
import { logger } from "./logger";
import { SpotifyReadCache } from "./spotify-read-cache";

/**
 * Spotify treats a loopback URI registered without a port as matching any
 * ephemeral loopback port. Using a random port avoids collisions while keeping
 * the callback bound to this machine only. "localhost" is intentionally not
 * used because Spotify requires an explicit loopback literal.
 */
const REDIRECT_REGISTRATION_URI = "http://127.0.0.1/callback";
const AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API_URL = "https://api.spotify.com/v1";
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_RATE_LIMIT_BACKOFF_SECONDS = 30;
const DEFAULT_QUOTA_BACKOFF_SECONDS = 60;

/**
 * This is a Spotify Connect controller, not an embedded streaming client.
 * Deliberately omit `streaming`: GameHub does not use the Web Playback SDK and
 * therefore does not create a playback device or receive Spotify audio.
 */
const SPOTIFY_SCOPES = [
  "playlist-read-collaborative",
  "playlist-read-private",
  "user-library-modify",
  "user-library-read",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "user-read-playback-position",
  "user-read-playback-state",
  "user-read-private",
  "user-read-recently-played",
  "user-top-read",
] as const;

interface SpotifyTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

interface SpotifyTokenPayload {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  authorizedAt: number;
  clientId: string;
}

type JsonObject = Record<string, unknown>;

class SpotifyServiceError extends Error {
  constructor(public readonly providerError: SpotifyProviderError) {
    super(providerError.message);
    this.name = "SpotifyServiceError";
  }
}

const asObject = (value: unknown): JsonObject | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;

const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

const asString = (value: unknown): string =>
  typeof value === "string" ? value : "";

const asOptionalString = (value: unknown): string | null => {
  const stringValue = asString(value);
  return stringValue || null;
};

const asNumber = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const asBoolean = (value: unknown, fallback = false): boolean =>
  typeof value === "boolean" ? value : fallback;

const nested = (value: unknown, ...keys: string[]): unknown => {
  let current = value;
  for (const key of keys) {
    const object = asObject(current);
    if (!object) return undefined;
    current = object[key];
  }
  return current;
};

const base64Url = (buffer: Buffer) =>
  buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const emptyPage = (): SpotifyPage<SpotifyContentItem> => ({
  items: [],
  total: 0,
  limit: 0,
  offset: 0,
  nextOffset: null,
});

const resolveClientId = async (): Promise<string | null> => {
  const envId = process.env.MAIN_VITE_SPOTIFY_CLIENT_ID?.trim();
  if (envId) return envId;
  const preferences = await db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);
  return preferences?.spotifyClientId?.trim() || null;
};

/**
 * Opt-in Spotify Connect provider.
 *
 * Authorization uses Authorization Code with PKCE. Only the public client ID
 * is configured by the user; a client secret is never requested or stored.
 * OAuth tokens are encrypted with Electron safeStorage before LevelDB sees
 * them. Playback commands target a Spotify app/device and Spotify audio never
 * enters GameHub's player or yt-dlp queue.
 */
export class SpotifyService {
  private static readonly readCache = new SpotifyReadCache();
  private static cancelAuth: (() => void) | null = null;
  private static authServer: http.Server | null = null;
  private static accountCache: SpotifyAccount | null = null;
  private static lastError: SpotifyProviderError | null = null;
  private static refreshPromise: Promise<string | null> | null = null;
  private static loginPromise: Promise<SpotifyStatus> | null = null;
  private static credentialMutationTail: Promise<void> = Promise.resolve();
  private static rateLimitGate = new SpotifyRateLimitGate(
    DEFAULT_RATE_LIMIT_BACKOFF_SECONDS,
    DEFAULT_QUOTA_BACKOFF_SECONDS
  );
  /** Invalidates every pending token mutation when login/logout state changes. */
  private static credentialEpoch = 0;

  static async getStatus(): Promise<SpotifyStatus> {
    const clientId = await resolveClientId();
    const secureStorage = this.getSecureStorageStatus();
    let tokens: SpotifyTokenPayload | null = null;
    let credentialLoadFailed = false;
    let profileRequiresReauthorization = false;

    try {
      tokens = await this.loadTokens(clientId);
    } catch (error) {
      credentialLoadFailed = true;
      this.setLastError(error);
    }

    const deriveAuthState = () => {
      const reauthorizationAt = tokens
        ? sixCalendarMonthsAfter(tokens.authorizedAt)
        : null;
      const clientIdChanged = Boolean(
        tokens && clientId && tokens.clientId !== clientId
      );
      const tokenNeedsReauth = Boolean(
        tokens &&
          (tokens.authorizedAt <= 0 ||
            (reauthorizationAt !== null && Date.now() >= reauthorizationAt) ||
            clientIdChanged)
      );
      return {
        clientIdChanged,
        connected: Boolean(
          clientId &&
            tokens?.refreshToken &&
            !tokenNeedsReauth &&
            secureStorage === "available"
        ),
        reauthorizationAt,
        tokenNeedsReauth,
      };
    };

    let authState = deriveAuthState();
    if (authState.clientIdChanged) {
      this.lastError = {
        code: "CLIENT_ID_CHANGED",
        message:
          "The Spotify Client ID changed. Reconnect Spotify to authorize the new app.",
      };
    }

    if (authState.connected && !this.accountCache) {
      const profile = await this.capture(() => this.fetchAccount());
      if (profile.ok) {
        this.accountCache = profile.data;
      } else if (
        profile.error.code === "TOKEN_EXPIRED" ||
        profile.error.code === "AUTH_REQUIRED" ||
        profile.error.code === "CLIENT_ID_CHANGED"
      ) {
        profileRequiresReauthorization = true;
        this.accountCache = null;
        try {
          // A failed refresh can delete the stored token. Re-read it so this
          // status response never reports a connection from a stale snapshot.
          tokens = await this.loadTokens(clientId);
        } catch (error) {
          credentialLoadFailed = true;
          this.setLastError(error);
          tokens = null;
        }
        authState = deriveAuthState();
      }
    }

    const rememberedReauthorizationFailure = Boolean(
      clientId &&
        !tokens &&
        (this.lastError?.code === "TOKEN_EXPIRED" ||
          this.lastError?.code === "AUTH_REQUIRED" ||
          this.lastError?.code === "CLIENT_ID_CHANGED")
    );
    const needsReauth = Boolean(
      authState.tokenNeedsReauth ||
        profileRequiresReauthorization ||
        (clientId && credentialLoadFailed) ||
        rememberedReauthorizationFailure
    );

    return {
      configured: Boolean(clientId),
      connected: authState.connected && !profileRequiresReauthorization,
      redirectUri: REDIRECT_REGISTRATION_URI,
      scopes: [...SPOTIFY_SCOPES],
      secureStorage,
      account:
        authState.connected && !profileRequiresReauthorization
          ? this.accountCache
          : null,
      authorizedAt: tokens?.authorizedAt || null,
      reauthorizationAt: authState.reauthorizationAt,
      needsReauth,
      lastError: this.lastError,
    };
  }

  static login(): Promise<SpotifyStatus> {
    if (this.loginPromise) return this.loginPromise;
    const operationEpoch = ++this.credentialEpoch;
    this.closeAuthWindow();
    const loginOperation = this.performLogin(operationEpoch).finally(() => {
      if (this.loginPromise === loginOperation) this.loginPromise = null;
    });
    this.loginPromise = loginOperation;
    return loginOperation;
  }

  private static async performLogin(
    operationEpoch: number
  ): Promise<SpotifyStatus> {
    let activeEpoch = operationEpoch;
    const clientId = await resolveClientId();
    this.assertCredentialEpoch(activeEpoch);
    if (!clientId) {
      throw new SpotifyServiceError({
        code: "AUTH_REQUIRED",
        message:
          "Add and save a Spotify Client ID before connecting the provider.",
      });
    }
    if (this.getSecureStorageStatus() !== "available") {
      throw new SpotifyServiceError({
        code: "SECURE_STORAGE_UNAVAILABLE",
        message:
          process.platform === "linux"
            ? "A Linux Secret Service or KWallet keyring is required. Unlock a supported keyring and restart GameHub; Spotify tokens will never be stored with Electron's basic_text fallback."
            : "Secure credential storage is unavailable. GameHub will not store Spotify tokens in plaintext.",
      });
    }

    const verifier = base64Url(crypto.randomBytes(64));
    const challenge = base64Url(
      crypto.createHash("sha256").update(verifier).digest()
    );
    const state = base64Url(crypto.randomBytes(24));

    try {
      const { code, redirectUri } = await this.runAuthorizationFlow(
        clientId,
        challenge,
        state,
        activeEpoch
      );
      this.assertCredentialEpoch(activeEpoch);
      // Invalidate refreshes that may have started while the authorization
      // window was open, before exchanging the one-time code.
      activeEpoch = ++this.credentialEpoch;
      await this.exchangeCode(
        clientId,
        code,
        verifier,
        redirectUri,
        activeEpoch
      );
      this.assertCredentialEpoch(activeEpoch);
      this.accountCache = null;
      this.lastError = null;
      return this.getStatus();
    } catch (error) {
      if (this.credentialEpoch === activeEpoch) this.setLastError(error);
      throw error;
    }
  }

  static async logout(): Promise<SpotifyStatus> {
    const logoutEpoch = ++this.credentialEpoch;
    this.closeAuthWindow();
    const pendingOperations: Promise<unknown>[] = [];
    if (this.loginPromise) pendingOperations.push(this.loginPromise);
    if (this.refreshPromise) pendingOperations.push(this.refreshPromise);
    await Promise.allSettled(pendingOperations);
    if (this.credentialEpoch === logoutEpoch) {
      await this.serializeCredentialMutation(async () => {
        if (this.credentialEpoch !== logoutEpoch) return;
        await spotifyAuthSublevel.del(SPOTIFY_AUTH_KEY).catch(() => undefined);
      });
      this.accountCache = null;
      this.lastError = null;
    }
    return this.getStatus();
  }

  static async getPlayback(): Promise<
    SpotifyResult<SpotifyPlaybackState | null>
  > {
    return this.capture(async () => {
      const response = await this.apiRequest<unknown>({
        method: "GET",
        url: "/me/player",
        params: { additional_types: "episode" },
        validateStatus: (status) => status === 200 || status === 204,
      });
      if (response.status === 204 || !response.data) return null;
      return this.normalizePlayback(response.data);
    });
  }

  static async getNowPlaying(): Promise<SpotifyNowPlaying | null> {
    const result = await this.capture(async () => {
      const response = await this.apiRequest<unknown>({
        method: "GET",
        url: "/me/player",
        params: { additional_types: "episode" },
        validateStatus: (status) => status === 200 || status === 204,
      });
      if (response.status === 204) return null;

      const root = asObject(response.data);
      const rawItem = asObject(root?.item);
      if (!root || !rawItem) return null;
      const item = this.normalizeContent(rawItem);
      if (!item || (item.type !== "track" && item.type !== "episode")) {
        return null;
      }

      const album =
        item.type === "track"
          ? asObject(rawItem.album)
          : asObject(rawItem.show);
      return {
        isPlaying: asBoolean(root.is_playing),
        trackName: item.title,
        artists: item.subtitle,
        albumName:
          asString(album?.name) ||
          (item.type === "episode" ? "Podcast episode" : ""),
        albumImageUrl: item.imageUrl,
        durationMs: item.durationMs ?? 0,
        progressMs: asNumber(root.progress_ms),
        trackUrl: item.externalUrl,
        deviceName: asOptionalString(nested(root, "device", "name")),
        contentType: item.type,
        uri: item.uri || null,
      } satisfies SpotifyNowPlaying;
    });
    return result.ok ? result.data : null;
  }

  static async getDevices(): Promise<SpotifyResult<SpotifyDevice[]>> {
    return this.capture(async () => {
      const response = await this.apiRequest<unknown>({
        method: "GET",
        url: "/me/player/devices",
      });
      return asArray(nested(response.data, "devices"))
        .map((device) => this.normalizeDevice(device))
        .filter((device): device is SpotifyDevice => Boolean(device));
    });
  }

  static async getQueue(): Promise<SpotifyResult<SpotifyQueue>> {
    return this.capture(async () => {
      const response = await this.apiRequest<unknown>({
        method: "GET",
        url: "/me/player/queue",
      });
      return {
        currentlyPlaying: this.normalizeContent(
          nested(response.data, "currently_playing")
        ),
        queue: asArray(nested(response.data, "queue"))
          .map((item) => this.normalizeContent(item))
          .filter((item): item is SpotifyContentItem => Boolean(item)),
      };
    });
  }

  static async getHome(): Promise<SpotifyResult<SpotifyHome>> {
    return this.capture(async () => {
      // Playlist item reads are limited to playlists the current user owns or
      // collaborates on. Fetch the account first so every playlist receives a
      // reliable canBrowseItems capability.
      if (!this.accountCache) {
        this.accountCache = await this.fetchAccount();
      }
      const [
        playlists,
        savedTracks,
        savedShows,
        savedEpisodes,
        topTracks,
        recentTracks,
      ] = await Promise.all([
        this.getContentPage("/me/playlists", "playlist"),
        this.getContentPage("/me/tracks", "track", "track"),
        this.getContentPage("/me/shows", "show", "show", true),
        this.getContentPage("/me/episodes", "episode", "episode", true),
        this.getContentPage("/me/top/tracks", "track", undefined, true),
        this.getContentPage(
          "/me/player/recently-played",
          "track",
          "track",
          true
        ),
      ]);

      const seen = new Set<string>();
      const forYou = [
        ...topTracks.items,
        ...recentTracks.items,
        ...savedTracks.items,
      ]
        .filter((item) => {
          if (seen.has(item.uri)) return false;
          seen.add(item.uri);
          return true;
        })
        .slice(0, 12);

      return {
        forYou,
        playlists,
        savedTracks,
        savedShows,
        savedEpisodes,
        topTracks,
        recentTracks,
      };
    });
  }

  static async search(
    query: unknown
  ): Promise<SpotifyResult<SpotifySearchResults>> {
    return this.capture(async () => {
      const normalizedQuery = parseSpotifySearchQuery(query);
      if (!normalizedQuery) {
        return {
          tracks: emptyPage(),
          playlists: emptyPage(),
          shows: emptyPage(),
          episodes: emptyPage(),
        };
      }
      const response = await this.apiRequest<unknown>({
        method: "GET",
        url: "/search",
        params: {
          q: normalizedQuery,
          type: "track,playlist,show,episode",
          // February 2026 Development Mode search limit is at most 10.
          limit: 10,
        },
      });
      return {
        tracks: this.normalizePage(nested(response.data, "tracks"), "track"),
        playlists: this.normalizePage(
          nested(response.data, "playlists"),
          "playlist"
        ),
        shows: this.normalizePage(nested(response.data, "shows"), "show"),
        episodes: this.normalizePage(
          nested(response.data, "episodes"),
          "episode"
        ),
      };
    });
  }

  static async getPlaylistItems(
    playlistIdValue: unknown,
    offsetValue?: unknown
  ): Promise<SpotifyResult<SpotifyPage<SpotifyContentItem>>> {
    return this.capture(async () => {
      const { playlistId, offset } = parseSpotifyPlaylistItemsRequest(
        playlistIdValue,
        offsetValue
      );
      const response = await this.apiRequest<unknown>({
        method: "GET",
        url: `/playlists/${encodeURIComponent(playlistId)}/items`,
        params: {
          limit: 50,
          offset,
          additional_types: "episode",
        },
      });
      return this.normalizePage(response.data, undefined, "item");
    });
  }

  static async playbackCommand(
    commandValue: unknown
  ): Promise<SpotifyResult<true>> {
    return this.capture(async () => {
      const command = parseSpotifyPlaybackCommand(commandValue);
      const deviceParams = command.deviceId
        ? { device_id: command.deviceId }
        : undefined;

      switch (command.type) {
        case "play":
          await this.apiRequest({
            method: "PUT",
            url: "/me/player/play",
            params: deviceParams,
          });
          break;
        case "pause":
          await this.apiRequest({
            method: "PUT",
            url: "/me/player/pause",
            params: deviceParams,
          });
          break;
        case "next":
          await this.apiRequest({
            method: "POST",
            url: "/me/player/next",
            params: deviceParams,
          });
          break;
        case "previous":
          await this.apiRequest({
            method: "POST",
            url: "/me/player/previous",
            params: deviceParams,
          });
          break;
        case "play-item": {
          if (command.itemType !== "track" && command.itemType !== "playlist") {
            throw new SpotifyServiceError({
              code: "UNSUPPORTED_CONTENT",
              message:
                "Spotify Connect can start tracks and playlist contexts from GameHub. Open other content in Spotify.",
            });
          }
          const usesContext = command.itemType === "playlist";
          const data: JsonObject = usesContext
            ? { context_uri: command.uri }
            : { uris: [command.uri] };
          if (usesContext && command.offsetUri) {
            data.offset = { uri: command.offsetUri };
          }
          await this.apiRequest({
            method: "PUT",
            url: "/me/player/play",
            params: deviceParams,
            data,
          });
          break;
        }
        case "add-to-queue":
          await this.apiRequest({
            method: "POST",
            url: "/me/player/queue",
            params: { ...deviceParams, uri: command.uri },
          });
          break;
        case "seek":
          await this.apiRequest({
            method: "PUT",
            url: "/me/player/seek",
            params: {
              ...deviceParams,
              position_ms: Math.max(0, Math.round(command.positionMs)),
            },
          });
          break;
        case "volume":
          await this.apiRequest({
            method: "PUT",
            url: "/me/player/volume",
            params: {
              ...deviceParams,
              volume_percent: Math.min(
                100,
                Math.max(0, Math.round(command.volumePercent))
              ),
            },
          });
          break;
        case "shuffle":
          await this.apiRequest({
            method: "PUT",
            url: "/me/player/shuffle",
            params: { ...deviceParams, state: command.enabled },
          });
          break;
        case "repeat":
          await this.apiRequest({
            method: "PUT",
            url: "/me/player/repeat",
            params: { ...deviceParams, state: command.state },
          });
          break;
        case "transfer":
          await this.apiRequest({
            method: "PUT",
            url: "/me/player",
            data: {
              device_ids: [command.deviceId],
              play: command.play ?? false,
            },
          });
          break;
        default: {
          const unsupportedCommand: never = command;
          throw new SpotifyInputValidationError(
            `Unsupported Spotify playback command: ${JSON.stringify(unsupportedCommand)}`
          );
        }
      }
      return true as const;
    });
  }

  static async setSaved(
    uriValue: unknown,
    savedValue: unknown
  ): Promise<SpotifyResult<true>> {
    return this.capture(async () => {
      const { uri, saved } = parseSpotifySavedItemRequest(uriValue, savedValue);
      await this.apiRequest({
        method: saved ? "PUT" : "DELETE",
        url: "/me/library",
        params: { uris: uri },
      });
      return true as const;
    });
  }

  static async libraryContains(
    uriValues: unknown
  ): Promise<SpotifyResult<Record<string, boolean>>> {
    return this.capture(async () => {
      const supportedUris = parseSpotifyLibraryUris(uriValues);
      const contains: Record<string, boolean> = {};
      for (let offset = 0; offset < supportedUris.length; offset += 40) {
        const chunk = supportedUris.slice(offset, offset + 40);
        const response = await this.apiRequest<unknown>({
          method: "GET",
          url: "/me/library/contains",
          params: { uris: chunk.join(",") },
        });
        const directArray = asArray(response.data);
        const nestedArray = asArray(nested(response.data, "contains"));
        const values = directArray.length > 0 ? directArray : nestedArray;
        const objectValues = asObject(response.data);
        chunk.forEach((uri, index) => {
          const objectValue = objectValues?.[uri];
          contains[uri] =
            typeof values[index] === "boolean"
              ? values[index] === true
              : objectValue === true;
        });
      }
      return contains;
    });
  }

  /** Backward-compatible compact control used by the current overlay. */
  static async control(actionValue: unknown): Promise<boolean> {
    let action: SpotifyControlAction;
    try {
      action = parseSpotifyControlAction(actionValue);
    } catch (error) {
      this.setLastError(error);
      return false;
    }
    const result = await this.playbackCommand({ type: action });
    return result.ok;
  }

  private static async getContentPage(
    path: string,
    type: SpotifyContentType,
    wrapperKey?: string,
    optional = false
  ): Promise<SpotifyPage<SpotifyContentItem>> {
    try {
      const response = await this.apiRequest<unknown>({
        method: "GET",
        url: path,
        params: { limit: 50 },
      });
      return this.normalizePage(response.data, type, wrapperKey);
    } catch (error) {
      const providerError =
        error instanceof SpotifyServiceError
          ? error.providerError
          : this.normalizeApiError(error);
      if (
        optional &&
        providerError.status === 403 &&
        providerError.code === "SPOTIFY_API_ERROR"
      ) {
        logger.debug(`Optional Spotify shelf ${path} was unavailable`, error);
        return emptyPage();
      }
      throw error;
    }
  }

  private static normalizePage(
    value: unknown,
    forcedType?: SpotifyContentType,
    wrapperKey?: string
  ): SpotifyPage<SpotifyContentItem> {
    const page = asObject(value);
    if (!page) return emptyPage();
    const rawItems = asArray(page.items);
    const items = rawItems
      .map((entry) => {
        const object = asObject(entry);
        const item = wrapperKey && object ? object[wrapperKey] : entry;
        return this.normalizeContent(item, forcedType);
      })
      .filter((item): item is SpotifyContentItem => Boolean(item));
    const limit = asNumber(page.limit, items.length);
    const offset = asNumber(page.offset);
    const total = asNumber(page.total, items.length);
    const hasNext = Boolean(page.next) || offset + items.length < total;
    return {
      items,
      total,
      limit,
      offset,
      nextOffset: hasNext ? offset + Math.max(limit, items.length) : null,
    };
  }

  private static normalizeContent(
    value: unknown,
    forcedType?: SpotifyContentType
  ): SpotifyContentItem | null {
    const item = asObject(value);
    if (!item) return null;
    const rawType = forcedType ?? asString(item.type);
    if (
      rawType !== "track" &&
      rawType !== "playlist" &&
      rawType !== "show" &&
      rawType !== "episode"
    ) {
      return null;
    }

    const type = rawType as SpotifyContentType;
    const album = asObject(item.album);
    const show = asObject(item.show);
    const owner = asObject(item.owner);
    const artists = asArray(item.artists)
      .map((artist) => asString(asObject(artist)?.name))
      .filter(Boolean)
      .join(", ");

    const subtitle =
      type === "track"
        ? artists || "Unknown artist"
        : type === "playlist"
          ? asString(owner?.display_name) || "Spotify playlist"
          : type === "show"
            ? asString(item.publisher) || "Podcast"
            : asString(show?.name) ||
              asString(item.publisher) ||
              "Podcast episode";

    const imageOwner =
      type === "track" ? album : type === "episode" ? (show ?? item) : item;
    const image = asArray(imageOwner?.images)
      .map((candidate) => asObject(candidate))
      .find((candidate) => Boolean(candidate?.url));

    const externalUrl = asOptionalString(
      nested(item, "external_urls", "spotify")
    );
    const uri = asString(item.uri);
    const id = asString(item.id) || uri;
    if (!id || !uri) return null;
    const ownerId = asString(owner?.id);
    const canBrowseItems =
      type === "playlist" &&
      (asBoolean(item.collaborative) ||
        Boolean(this.accountCache?.id && ownerId === this.accountCache.id));

    const itemCount =
      type === "playlist"
        ? asNumber(nested(item, "items", "total"), -1) >= 0
          ? asNumber(nested(item, "items", "total"))
          : asNumber(nested(item, "tracks", "total"), -1)
        : type === "show"
          ? asNumber(item.total_episodes, -1)
          : -1;

    return {
      id,
      uri,
      type,
      title: asString(item.name) || "Untitled",
      subtitle,
      description: asOptionalString(item.description),
      imageUrl: asOptionalString(image?.url),
      externalUrl,
      durationMs:
        type === "track" || type === "episode"
          ? asNumber(item.duration_ms, 0)
          : null,
      itemCount: itemCount >= 0 ? itemCount : null,
      contextUri:
        type === "playlist" || type === "show"
          ? uri
          : type === "episode"
            ? asOptionalString(show?.uri)
            : asOptionalString(album?.uri),
      playable: item.is_playable !== false,
      explicit: asBoolean(item.explicit),
      canBrowseItems,
    };
  }

  private static normalizeDevice(value: unknown): SpotifyDevice | null {
    const device = asObject(value);
    if (!device) return null;
    const volume = device.volume_percent;
    return {
      id: asOptionalString(device.id),
      name: asString(device.name) || "Spotify device",
      type: asString(device.type) || "Unknown",
      isActive: asBoolean(device.is_active),
      isPrivateSession: asBoolean(device.is_private_session),
      isRestricted: asBoolean(device.is_restricted),
      volumePercent:
        typeof volume === "number" && Number.isFinite(volume) ? volume : null,
      supportsVolume: device.supports_volume !== false,
    };
  }

  private static normalizePlayback(value: unknown): SpotifyPlaybackState {
    const playback = asObject(value) ?? {};
    const rawActions = asObject(playback.actions);
    const rawDisallows = asObject(rawActions?.disallows) ?? rawActions;
    return {
      isPlaying: asBoolean(playback.is_playing),
      progressMs: asNumber(playback.progress_ms),
      repeatState:
        playback.repeat_state === "track" || playback.repeat_state === "context"
          ? playback.repeat_state
          : "off",
      shuffleState: asBoolean(playback.shuffle_state),
      contextUri: asOptionalString(nested(playback, "context", "uri")),
      item: this.normalizeContent(playback.item),
      device: this.normalizeDevice(playback.device),
      disallows: rawDisallows
        ? Object.entries(rawDisallows)
            .filter(
              ([action, disallowed]) =>
                action !== "disallows" && disallowed === true
            )
            .map(([action]) => action)
        : [],
    };
  }

  private static async fetchAccount(): Promise<SpotifyAccount> {
    const response = await this.apiRequest<unknown>({
      method: "GET",
      url: "/me",
    });
    const profile = asObject(response.data) ?? {};
    return {
      id: asString(profile.id),
      displayName:
        asString(profile.display_name) ||
        asString(profile.id) ||
        "Spotify user",
      imageUrl: asOptionalString(asObject(asArray(profile.images)[0])?.url),
      externalUrl: asOptionalString(
        nested(profile, "external_urls", "spotify")
      ),
    };
  }

  private static async apiRequest<T = unknown>(
    config: AxiosRequestConfig
  ): Promise<{ data: T; status: number }> {
    if ((config.method ?? "GET").toUpperCase() === "GET") {
      const key = `${this.credentialEpoch}:${config.url}:${JSON.stringify(config.params ?? {})}`;
      return this.readCache.read(key, () => this.performApiRequest<T>(config));
    }
    this.readCache.clear();
    try {
      return await this.performApiRequest<T>(config);
    } finally {
      this.readCache.clear();
    }
  }

  private static async performApiRequest<T = unknown>(
    config: AxiosRequestConfig
  ): Promise<{ data: T; status: number }> {
    this.assertApiRateLimitWindow();
    let accessToken = await this.getAccessToken();
    if (!accessToken) {
      throw new SpotifyServiceError({
        code: "AUTH_REQUIRED",
        message: "Connect Spotify again to continue.",
      });
    }

    const execute = (token: string) =>
      axios.request<T>({
        ...config,
        baseURL: API_URL,
        timeout: config.timeout ?? 15000,
        headers: {
          ...config.headers,
          Authorization: `Bearer ${token}`,
        },
      });

    try {
      const response = await execute(accessToken);
      return { data: response.data, status: response.status };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        const latestToken = await this.getAccessToken();
        accessToken =
          latestToken && latestToken !== accessToken
            ? latestToken
            : await this.refreshAccessToken(true);
        if (accessToken) {
          try {
            const retried = await execute(accessToken);
            return { data: retried.data, status: retried.status };
          } catch (retryError) {
            throw this.serviceErrorForApi(retryError);
          }
        }
      }
      throw this.serviceErrorForApi(error);
    }
  }

  private static assertApiRateLimitWindow() {
    const error = this.rateLimitGate.getBlockedError();
    if (error) throw new SpotifyServiceError(error);
  }

  private static serviceErrorForApi(error: unknown): SpotifyServiceError {
    const providerError = this.normalizeApiError(error);
    this.rateLimitGate.remember(providerError);
    return new SpotifyServiceError(providerError);
  }

  private static async capture<T>(
    operation: () => Promise<T>
  ): Promise<SpotifyResult<T>> {
    try {
      const data = await operation();
      this.lastError = null;
      return { ok: true, data };
    } catch (error) {
      const providerError = this.setLastError(error);
      logger.debug(`Spotify operation failed: ${providerError.code}`, error);
      return { ok: false, error: providerError };
    }
  }

  private static setLastError(error: unknown): SpotifyProviderError {
    const providerError =
      error instanceof SpotifyServiceError
        ? error.providerError
        : this.normalizeApiError(error);
    this.lastError = providerError;
    return providerError;
  }

  private static normalizeApiError(error: unknown): SpotifyProviderError {
    if (error instanceof SpotifyServiceError) return error.providerError;
    if (error instanceof SpotifyInputValidationError) {
      return {
        code: "INVALID_REQUEST",
        message: error.message,
      };
    }
    if (!axios.isAxiosError(error)) {
      return {
        code: "UNKNOWN",
        message:
          error instanceof Error
            ? error.message
            : "Spotify encountered an unknown error.",
      };
    }

    const status = error.response?.status;
    const response = asObject(error.response?.data);
    const errorObject = asObject(response?.error);
    const reason =
      asString(errorObject?.reason) ||
      asString(response?.reason) ||
      asString(response?.error);
    const apiMessage =
      asString(errorObject?.message) ||
      asString(response?.error_description) ||
      error.message;
    const normalized = `${reason} ${apiMessage}`.toLowerCase();
    const retryAfter = Number(error.response?.headers?.["retry-after"]);

    if (status === 429 && reason.toUpperCase() === "QUOTA_EXCEEDED") {
      return {
        code: "QUOTA_EXCEEDED",
        message:
          "This Spotify developer account has reached its shared Web API quota. Try again later or use another Client ID.",
        status,
        retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : undefined,
      };
    }
    if (status === 429) {
      return {
        code: "RATE_LIMITED",
        message: "Spotify is rate limiting this app. Try again shortly.",
        status,
        retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : undefined,
      };
    }
    if (
      status === 404 &&
      (normalized.includes("device") || normalized.includes("player"))
    ) {
      return {
        code: "NO_ACTIVE_DEVICE",
        message:
          "No active Spotify device was found. Open Spotify on a device, start playback once, then select that device in GameHub.",
        status,
      };
    }
    if (
      status === 403 &&
      (normalized.includes("premium") ||
        normalized.includes("player command failed"))
    ) {
      return {
        code: "PREMIUM_REQUIRED",
        message:
          "Spotify Connect playback control requires Spotify Premium. Browsing and opening content in Spotify can still work.",
        status,
      };
    }
    if (status === 403 && normalized.includes("restricted")) {
      return {
        code: "RESTRICTED_DEVICE",
        message:
          "The selected Spotify device does not accept remote commands. Choose another device.",
        status,
      };
    }
    if (
      status === 403 &&
      (normalized.includes("allowlist") ||
        normalized.includes("development") ||
        normalized.includes("user not registered"))
    ) {
      return {
        code: "DEVELOPMENT_USER_NOT_ALLOWED",
        message:
          "This Spotify account is not allowlisted for the Development Mode app. Add it under Users and Access in the Spotify dashboard.",
        status,
      };
    }
    if (
      normalized.includes("redirect_uri") ||
      normalized.includes("redirect uri")
    ) {
      return {
        code: "REDIRECT_URI_MISMATCH",
        message: `Register ${REDIRECT_REGISTRATION_URI} exactly in the Spotify dashboard, then try again.`,
        status,
      };
    }
    if (!error.response) {
      return {
        code: "NETWORK_ERROR",
        message:
          "GameHub could not reach Spotify. Check the connection and try again.",
      };
    }
    return {
      code: "SPOTIFY_API_ERROR",
      message: apiMessage || "Spotify rejected the request.",
      status,
    };
  }

  private static getSecureStorageStatus(): SpotifySecureStorageStatus {
    if (!safeStorage.isEncryptionAvailable()) return "unavailable";
    if (
      process.platform === "linux" &&
      safeStorage.getSelectedStorageBackend() === "basic_text"
    ) {
      return "linux-basic-text";
    }
    return "available";
  }

  private static isEncryptedAuth(auth: unknown): auth is SpotifyEncryptedAuth {
    const candidate = asObject(auth);
    return (
      candidate?.version === 2 && typeof candidate.encryptedPayload === "string"
    );
  }

  private static isLegacyAuth(auth: unknown): auth is SpotifyLegacyAuth {
    const candidate = asObject(auth);
    return Boolean(
      candidate &&
        typeof candidate.accessToken === "string" &&
        candidate.accessToken.length > 0 &&
        typeof candidate.refreshToken === "string" &&
        candidate.refreshToken.length > 0 &&
        typeof candidate.expiresAt === "number" &&
        Number.isFinite(candidate.expiresAt)
    );
  }

  private static decryptTokens(
    stored: SpotifyEncryptedAuth
  ): SpotifyTokenPayload {
    try {
      const decrypted = safeStorage.decryptString(
        Buffer.from(stored.encryptedPayload, "base64")
      );
      const parsed = asObject(JSON.parse(decrypted));
      if (
        !parsed ||
        typeof parsed.accessToken !== "string" ||
        !parsed.accessToken ||
        typeof parsed.refreshToken !== "string" ||
        !parsed.refreshToken ||
        typeof parsed.clientId !== "string" ||
        !parsed.clientId ||
        typeof parsed.expiresAt !== "number" ||
        !Number.isFinite(parsed.expiresAt) ||
        typeof parsed.authorizedAt !== "number" ||
        !Number.isFinite(parsed.authorizedAt)
      ) {
        throw new Error("Invalid Spotify credential payload");
      }
      return {
        accessToken: parsed.accessToken,
        refreshToken: parsed.refreshToken,
        expiresAt: parsed.expiresAt,
        authorizedAt: parsed.authorizedAt,
        clientId: parsed.clientId,
      };
    } catch (error) {
      logger.warn("Unable to decrypt Spotify credentials", error);
      throw new SpotifyServiceError({
        code: "AUTH_REQUIRED",
        message:
          "Spotify credentials could not be decrypted on this device. Reconnect Spotify.",
      });
    }
  }

  private static async loadTokens(
    currentClientId: string | null
  ): Promise<SpotifyTokenPayload | null> {
    const loadEpoch = this.credentialEpoch;
    const stored = await spotifyAuthSublevel
      .get(SPOTIFY_AUTH_KEY)
      .catch(() => null);
    if (!stored) return null;
    if (this.getSecureStorageStatus() !== "available") {
      if (!this.isEncryptedAuth(stored)) {
        // Never leave the old proof-of-concept's plaintext OAuth row around
        // when the OS cannot provide a real credential store.
        await this.serializeCredentialMutation(async () => {
          this.assertCredentialEpoch(loadEpoch);
          const current = await spotifyAuthSublevel
            .get(SPOTIFY_AUTH_KEY)
            .catch(() => null);
          this.assertCredentialEpoch(loadEpoch);
          if (current && !this.isEncryptedAuth(current)) {
            await spotifyAuthSublevel
              .del(SPOTIFY_AUTH_KEY)
              .catch(() => undefined);
          }
        });
      }
      throw new SpotifyServiceError({
        code: "SECURE_STORAGE_UNAVAILABLE",
        message:
          process.platform === "linux"
            ? "A Linux Secret Service or KWallet keyring is required. Unlock a supported keyring and restart GameHub before reconnecting Spotify."
            : "Secure credential storage is unavailable. Reconnect after the operating-system credential store is available.",
      });
    }

    if (this.isEncryptedAuth(stored)) {
      return this.decryptTokens(stored);
    }

    /**
     * Migrate the original plaintext row immediately. Its original
     * authorization time was not stored, so it is encrypted but marked for
     * reauthorization instead of guessing a new six-month lifetime.
     */
    return this.serializeCredentialMutation(async () => {
      this.assertCredentialEpoch(loadEpoch);
      const current = await spotifyAuthSublevel
        .get(SPOTIFY_AUTH_KEY)
        .catch(() => null);
      this.assertCredentialEpoch(loadEpoch);
      if (!current) return null;
      if (this.isEncryptedAuth(current)) return this.decryptTokens(current);
      if (!this.isLegacyAuth(current)) {
        await spotifyAuthSublevel.del(SPOTIFY_AUTH_KEY).catch(() => undefined);
        throw new SpotifyServiceError({
          code: "AUTH_REQUIRED",
          message:
            "GameHub removed malformed legacy Spotify credentials. Reconnect Spotify.",
        });
      }

      const migrated: SpotifyTokenPayload = {
        accessToken: current.accessToken,
        refreshToken: current.refreshToken,
        expiresAt: current.expiresAt,
        authorizedAt: 0,
        clientId: currentClientId ?? "__legacy_reconnect_required__",
      };
      await this.writeEncryptedTokensUnlocked(migrated, loadEpoch);
      return migrated;
    });
  }

  private static async writeEncryptedTokens(
    tokens: SpotifyTokenPayload,
    operationEpoch: number
  ) {
    return this.serializeCredentialMutation(() =>
      this.writeEncryptedTokensUnlocked(tokens, operationEpoch)
    );
  }

  private static async writeEncryptedTokensUnlocked(
    tokens: SpotifyTokenPayload,
    operationEpoch: number
  ) {
    this.assertCredentialEpoch(operationEpoch);
    if (this.getSecureStorageStatus() !== "available") {
      throw new SpotifyServiceError({
        code: "SECURE_STORAGE_UNAVAILABLE",
        message:
          process.platform === "linux"
            ? "Spotify tokens were not saved because Electron selected the insecure basic_text backend. Configure Secret Service or KWallet and restart GameHub."
            : "Secure credential storage is unavailable. Spotify tokens were not saved.",
      });
    }
    const encryptedPayload = safeStorage
      .encryptString(JSON.stringify(tokens))
      .toString("base64");
    const stored: SpotifyEncryptedAuth = {
      version: 2,
      encryptedPayload,
      authorizedAt: tokens.authorizedAt,
    };
    this.assertCredentialEpoch(operationEpoch);
    await spotifyAuthSublevel.put(SPOTIFY_AUTH_KEY, stored);
    if (this.credentialEpoch !== operationEpoch) {
      const current = await spotifyAuthSublevel
        .get(SPOTIFY_AUTH_KEY)
        .catch(() => null);
      if (
        this.isEncryptedAuth(current) &&
        current.encryptedPayload === stored.encryptedPayload
      ) {
        await spotifyAuthSublevel.del(SPOTIFY_AUTH_KEY).catch(() => undefined);
      }
      this.assertCredentialEpoch(operationEpoch);
    }
  }

  private static serializeCredentialMutation<T>(
    operation: () => Promise<T>
  ): Promise<T> {
    const pending = this.credentialMutationTail.then(operation, operation);
    this.credentialMutationTail = pending.then(
      () => undefined,
      () => undefined
    );
    return pending;
  }

  private static async getAccessToken(): Promise<string | null> {
    const clientId = await resolveClientId();
    if (!clientId) return null;
    const tokens = await this.loadTokens(clientId);
    if (!tokens?.refreshToken || tokens.clientId !== clientId) return null;
    const reauthorizationAt = sixCalendarMonthsAfter(tokens.authorizedAt);
    if (
      tokens.authorizedAt <= 0 ||
      (reauthorizationAt > 0 && Date.now() >= reauthorizationAt)
    ) {
      this.lastError = {
        code: "TOKEN_EXPIRED",
        message:
          "Spotify authorization reached its six-month limit. Reconnect Spotify.",
      };
      return null;
    }
    if (Date.now() < tokens.expiresAt) return tokens.accessToken;
    return this.refreshAccessToken(false);
  }

  private static async refreshAccessToken(
    force: boolean
  ): Promise<string | null> {
    if (this.loginPromise) return null;
    if (this.refreshPromise) return this.refreshPromise;
    const refreshOperation = this.performRefreshAccessToken(force).finally(
      () => {
        if (this.refreshPromise === refreshOperation) {
          this.refreshPromise = null;
        }
      }
    );
    this.refreshPromise = refreshOperation;
    return refreshOperation;
  }

  private static async performRefreshAccessToken(
    force: boolean
  ): Promise<string | null> {
    const operationEpoch = this.credentialEpoch;
    const clientId = await resolveClientId();
    this.assertCredentialEpoch(operationEpoch);
    if (!clientId) return null;
    const tokens = await this.loadTokens(clientId);
    this.assertCredentialEpoch(operationEpoch);
    if (!tokens?.refreshToken || tokens.clientId !== clientId) return null;
    if (!force && Date.now() < tokens.expiresAt) return tokens.accessToken;

    try {
      const response = await axios.post<SpotifyTokenResponse>(
        TOKEN_URL,
        new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: tokens.refreshToken,
          client_id: clientId,
        }).toString(),
        {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          timeout: 15000,
        }
      );
      this.assertCredentialEpoch(operationEpoch);
      await this.storeTokenResponse(
        response.data,
        clientId,
        tokens.authorizedAt,
        tokens.refreshToken,
        operationEpoch
      );
      return response.data.access_token;
    } catch (error) {
      const response = axios.isAxiosError(error)
        ? asObject(error.response?.data)
        : null;
      const oauthError = asString(response?.error);
      if (oauthError === "invalid_grant") {
        await this.serializeCredentialMutation(async () => {
          this.assertCredentialEpoch(operationEpoch);
          await spotifyAuthSublevel
            .del(SPOTIFY_AUTH_KEY)
            .catch(() => undefined);
          this.accountCache = null;
          this.assertCredentialEpoch(operationEpoch);
        });
        throw new SpotifyServiceError({
          code: "TOKEN_EXPIRED",
          message:
            "Spotify authorization expired. GameHub removed the unusable token; reconnect Spotify.",
        });
      }
      throw this.serviceErrorForApi(error);
    }
  }

  private static async exchangeCode(
    clientId: string,
    code: string,
    verifier: string,
    redirectUri: string,
    operationEpoch: number
  ) {
    try {
      const response = await axios.post<SpotifyTokenResponse>(
        TOKEN_URL,
        new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          client_id: clientId,
          code_verifier: verifier,
        }).toString(),
        {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          timeout: 15000,
        }
      );
      this.assertCredentialEpoch(operationEpoch);
      await this.storeTokenResponse(
        response.data,
        clientId,
        Date.now(),
        undefined,
        operationEpoch
      );
    } catch (error) {
      throw this.serviceErrorForApi(error);
    }
  }

  private static async storeTokenResponse(
    response: SpotifyTokenResponse,
    clientId: string,
    authorizedAt: number,
    previousRefreshToken: string | undefined,
    operationEpoch: number
  ) {
    const refreshToken = response.refresh_token ?? previousRefreshToken ?? "";
    if (!response.access_token || !refreshToken) {
      throw new SpotifyServiceError({
        code: "AUTH_REQUIRED",
        message: "Spotify did not return refreshable credentials.",
      });
    }
    await this.writeEncryptedTokens(
      {
        accessToken: response.access_token,
        refreshToken,
        expiresAt:
          Date.now() +
          Math.max(60, Number(response.expires_in ?? 3600) - 60) * 1000,
        authorizedAt,
        clientId,
      },
      operationEpoch
    );
  }

  private static async runAuthorizationFlow(
    clientId: string,
    challenge: string,
    expectedState: string,
    operationEpoch: number
  ): Promise<{ code: string; redirectUri: string }> {
    this.assertCredentialEpoch(operationEpoch);
    this.closeAuthWindow();

    const server = http.createServer();
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      server.once("error", onError);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", onError);
        resolve();
      });
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new SpotifyServiceError({
        code: "REDIRECT_URI_MISMATCH",
        message: "GameHub could not start the local Spotify callback.",
      });
    }
    try {
      this.assertCredentialEpoch(operationEpoch);
    } catch (error) {
      server.close();
      throw error;
    }
    const redirectUri = `http://127.0.0.1:${address.port}/callback`;
    this.authServer = server;
    const authorizationUrl = `${AUTHORIZE_URL}?${new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge_method: "S256",
      code_challenge: challenge,
      scope: SPOTIFY_SCOPES.join(" "),
      state: expectedState,
    }).toString()}`;

    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        finish(
          new SpotifyServiceError({
            code: "AUTH_REQUIRED",
            message: "Spotify authorization timed out. Try connecting again.",
          })
        );
      }, AUTH_TIMEOUT_MS);

      const finish = (error: Error | null, code?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        server.off("error", onServerError);
        if (server.listening) server.close();
        if (this.authServer === server) this.authServer = null;
        if (this.cancelAuth === cancel) this.cancelAuth = null;
        if (error) reject(error);
        else if (code) resolve({ code, redirectUri });
        else {
          reject(
            new SpotifyServiceError({
              code: "AUTH_REQUIRED",
              message: "Spotify did not return an authorization code.",
            })
          );
        }
      };

      const cancel = () =>
        finish(
          new SpotifyServiceError({
            code: "AUTH_REQUIRED",
            message: "Spotify connection was cancelled.",
          })
        );
      this.cancelAuth = cancel;
      const onServerError = (error: Error) => finish(error);
      server.on("error", onServerError);
      server.on("request", (request, response) => {
        if (
          settled ||
          this.authServer !== server ||
          this.cancelAuth !== cancel
        ) {
          response.writeHead(410, {
            "Cache-Control": "no-store",
            "Content-Type": "text/plain; charset=utf-8",
          });
          response.end();
          return;
        }

        const callback = parseSpotifyCallbackRequest({
          expectedState,
          method: request.method,
          redirectUri,
          requestUrl: request.url,
        });
        if (callback.kind === "ignore") {
          response.writeHead(callback.status, {
            ...(callback.status === 405 ? { Allow: "GET" } : {}),
            "Cache-Control": "no-store",
            "Content-Type": "text/plain; charset=utf-8",
          });
          response.end();
          return;
        }

        const success = callback.kind === "success";
        response.writeHead(callback.status, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Content-Security-Policy":
            "default-src 'none'; style-src 'unsafe-inline'; img-src 'none'",
        });
        response.end(`<!doctype html>
<html lang="en"><meta charset="utf-8"><title>Spotify connection</title>
<style>html{color-scheme:dark;font-family:system-ui;background:#0b0b0b;color:#fff}body{display:grid;min-height:100vh;place-items:center;margin:0}.card{max-width:28rem;padding:2rem;border:1px solid #333;border-radius:12px;background:#151515}h1{font-size:1.25rem}p{color:#bbb;line-height:1.5}</style>
<body><main class="card"><h1>${success ? "Spotify connected" : "Spotify could not connect"}</h1><p>${success ? "You can close this window and return to GameHub." : "Return to GameHub, check the setup guide, and try again."}</p></main></body></html>`);

        if (callback.kind === "oauth-error") {
          const normalizedDescription = callback.description.toLowerCase();
          const isDevelopmentAccessError =
            normalizedDescription.includes("allowlist") ||
            normalizedDescription.includes("development") ||
            normalizedDescription.includes("not registered");
          finish(
            new SpotifyServiceError({
              code: isDevelopmentAccessError
                ? "DEVELOPMENT_USER_NOT_ALLOWED"
                : callback.error === "access_denied"
                  ? "AUTH_REQUIRED"
                  : "SPOTIFY_API_ERROR",
              message: isDevelopmentAccessError
                ? "This Spotify account is not allowlisted for the Development Mode app. Add it under Users and Access in the Spotify dashboard."
                : callback.error === "access_denied"
                  ? "Spotify connection was cancelled."
                  : `Spotify authorization failed: ${callback.description || callback.error}`,
            })
          );
        } else if (callback.kind === "missing-code") {
          finish(
            new SpotifyServiceError({
              code: "AUTH_REQUIRED",
              message: "Spotify did not return an authorization code.",
            })
          );
        } else {
          finish(null, callback.code);
        }
      });

      // The system browser supports existing sessions, passkeys and social
      // sign-in. Authorization returns to our state-checked PKCE listener.
      void shell.openExternal(authorizationUrl).catch((error) => finish(error));
    });
  }

  private static closeAuthWindow() {
    this.cancelAuth?.();
    this.cancelAuth = null;
    const server = this.authServer;
    this.authServer = null;
    if (server?.listening) server.close();
  }

  private static assertCredentialEpoch(expectedEpoch: number) {
    if (this.credentialEpoch !== expectedEpoch) {
      throw new SpotifyServiceError({
        code: "AUTH_REQUIRED",
        message: "The Spotify connection operation was cancelled.",
      });
    }
  }
}
