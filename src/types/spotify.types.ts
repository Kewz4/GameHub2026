/** Currently-playing track from the Spotify Web API, normalized for the
 *  overlay's Now-playing widget. */
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
}

export interface SpotifyStatus {
  /** A client ID is configured, so login is possible. */
  configured: boolean;
  /** The user has authorized and we hold (refreshable) tokens. */
  connected: boolean;
}

export type SpotifyControlAction = "play" | "pause" | "next" | "previous";
