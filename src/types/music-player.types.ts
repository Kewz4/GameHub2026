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

export interface MusicPlayerState {
  queue: MusicTrack[];
  currentIndex: number;
  nowPlaying: MusicTrack | null;
  state: "playing" | "paused" | "stopped";
  shuffle: boolean;
  repeat: RepeatMode;
  progressMs: number;
  durationMs: number;
  audioUrl: string | null;
}