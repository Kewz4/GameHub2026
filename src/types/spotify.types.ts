export type MusicProvider = "gamehub" | "spotify";

export type SpotifyContentType = "track" | "playlist" | "show" | "episode";

export type SpotifySecureStorageStatus =
  | "available"
  | "linux-basic-text"
  | "unavailable";

export interface SpotifyAccount {
  id: string;
  displayName: string;
  imageUrl: string | null;
  externalUrl: string | null;
}

export interface SpotifyProviderError {
  code:
    | "AUTH_REQUIRED"
    | "CLIENT_ID_CHANGED"
    | "DEVELOPMENT_USER_NOT_ALLOWED"
    | "INVALID_REQUEST"
    | "NETWORK_ERROR"
    | "NO_ACTIVE_DEVICE"
    | "PREMIUM_REQUIRED"
    | "QUOTA_EXCEEDED"
    | "RATE_LIMITED"
    | "REDIRECT_URI_MISMATCH"
    | "RESTRICTED_DEVICE"
    | "SECURE_STORAGE_UNAVAILABLE"
    | "SPOTIFY_API_ERROR"
    | "TOKEN_EXPIRED"
    | "UNSUPPORTED_CONTENT"
    | "UNKNOWN";
  message: string;
  status?: number;
  retryAfterSeconds?: number;
}

export interface SpotifyStatus {
  /** A public client ID is configured, so PKCE authorization is possible. */
  configured: boolean;
  /** The user has authorized and GameHub can refresh the access token. */
  connected: boolean;
  /** Loopback URI that must be registered exactly in the Spotify dashboard. */
  redirectUri: string;
  scopes: string[];
  secureStorage: SpotifySecureStorageStatus;
  account: SpotifyAccount | null;
  authorizedAt: number | null;
  /** Spotify refresh tokens expire six months after original authorization. */
  reauthorizationAt: number | null;
  needsReauth: boolean;
  lastError: SpotifyProviderError | null;
}

export interface SpotifyImage {
  url: string;
  width?: number | null;
  height?: number | null;
}

/** A normalized Spotify track, playlist, show, or podcast episode. */
export interface SpotifyContentItem {
  id: string;
  uri: string;
  type: SpotifyContentType;
  title: string;
  subtitle: string;
  description: string | null;
  imageUrl: string | null;
  externalUrl: string | null;
  durationMs: number | null;
  itemCount: number | null;
  contextUri: string | null;
  playable: boolean;
  explicit: boolean;
  /** Playlist items are readable only for playlists this user owns or collaborates on. */
  canBrowseItems: boolean;
}

export interface SpotifyPage<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  nextOffset: number | null;
}

export interface SpotifySearchResults {
  tracks: SpotifyPage<SpotifyContentItem>;
  playlists: SpotifyPage<SpotifyContentItem>;
  shows: SpotifyPage<SpotifyContentItem>;
  episodes: SpotifyPage<SpotifyContentItem>;
}

/**
 * Development-mode-safe shelves. Spotify's removed recommendations/radio
 * endpoints are deliberately not represented here.
 */
export interface SpotifyHome {
  forYou: SpotifyContentItem[];
  playlists: SpotifyPage<SpotifyContentItem>;
  savedTracks: SpotifyPage<SpotifyContentItem>;
  savedShows: SpotifyPage<SpotifyContentItem>;
  savedEpisodes: SpotifyPage<SpotifyContentItem>;
  topTracks: SpotifyPage<SpotifyContentItem>;
  recentTracks: SpotifyPage<SpotifyContentItem>;
}

export interface SpotifyDevice {
  /** Spotify documents device IDs as nullable for some active devices. */
  id: string | null;
  name: string;
  type: string;
  isActive: boolean;
  isPrivateSession: boolean;
  isRestricted: boolean;
  volumePercent: number | null;
  supportsVolume: boolean;
}

export interface SpotifyPlaybackState {
  isPlaying: boolean;
  progressMs: number;
  repeatState: "off" | "track" | "context";
  shuffleState: boolean;
  contextUri: string | null;
  item: SpotifyContentItem | null;
  device: SpotifyDevice | null;
  disallows: string[];
}

/** Compatibility shape consumed by the overlay's compact Now-playing widget. */
export interface SpotifyNowPlaying {
  isPlaying: boolean;
  trackName: string;
  artists: string;
  albumName: string;
  albumImageUrl: string | null;
  durationMs: number;
  progressMs: number;
  trackUrl: string | null;
  deviceName: string | null;
  contentType: "track" | "episode";
  uri: string | null;
}

export interface SpotifyQueue {
  currentlyPlaying: SpotifyContentItem | null;
  queue: SpotifyContentItem[];
}

export type SpotifyPlaybackCommand =
  | { type: "play"; deviceId?: string }
  | { type: "pause"; deviceId?: string }
  | { type: "next"; deviceId?: string }
  | { type: "previous"; deviceId?: string }
  | {
      type: "play-item";
      uri: string;
      itemType: "track" | "playlist";
      deviceId?: string;
      offsetUri?: string;
    }
  | { type: "add-to-queue"; uri: string; deviceId?: string }
  | { type: "seek"; positionMs: number; deviceId?: string }
  | { type: "volume"; volumePercent: number; deviceId?: string }
  | { type: "shuffle"; enabled: boolean; deviceId?: string }
  | {
      type: "repeat";
      state: "off" | "track" | "context";
      deviceId?: string;
    }
  | { type: "transfer"; deviceId: string; play?: boolean };

export type SpotifyControlAction = "play" | "pause" | "next" | "previous";

export type SpotifyResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: SpotifyProviderError };
