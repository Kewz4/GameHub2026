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
}
