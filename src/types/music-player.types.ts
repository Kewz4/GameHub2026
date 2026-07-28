export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  coverArt: string | null;
  duration: number;
  previewUrl?: string;
}

export interface MusicPlaylist {
  id: string;
  name: string;
  tracks: MusicTrack[];
  createdAt: number;
  updatedAt: number;
}

export type RepeatMode = "none" | "one" | "all";

export type MusicPlaybackState =
  | "stopped"
  | "resolving"
  | "playing"
  | "paused"
  | "error";

export type MusicAudioSource = "youtube" | "deezer-preview";

export interface MusicPlayerState {
  queue: MusicTrack[];
  currentIndex: number;
  nowPlaying: MusicTrack | null;
  state: MusicPlaybackState;
  shuffle: boolean;
  repeat: RepeatMode;
  progressMs: number;
  durationMs: number;
  audioUrl: string | null;
  audioSource: MusicAudioSource | null;
  playbackError: string | null;
  playbackNotice: string | null;
  /**
   * Changes whenever the active audio element should start from the beginning,
   * including replaying the same URL in repeat-one mode.
   */
  playbackId: number;
  /**
   * The next deterministic queue entry is resolved while the current song is
   * playing. Renderers can buffer this URL in a second audio element and swap
   * it in without waiting for yt-dlp when Next is pressed.
   */
  preloadedNextIndex: number;
  preloadedAudioUrl: string | null;
  preloadedAudioSource: MusicAudioSource | null;
  volume: number;
  muted: boolean;
  /**
   * Incremented for explicit cross-window seek requests. The audio host reports
   * progress without changing this value.
   */
  seekId: number;
}
