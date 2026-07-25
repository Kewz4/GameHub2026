import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import axios from "axios";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const youtubedl = require("youtube-dl-exec");
import { db, levelKeys } from "@main/level";
import type {
  MusicTrack,
  MusicPlaylist,
  MusicPlayerState,
  RepeatMode,
} from "@types";
import { logger } from "./logger";

const DEEZER_API = "https://api.deezer.com";

interface DeezerTrack {
  id: number;
  title: string;
  artist: { name: string };
  album: { title: string; cover_big?: string; cover_medium?: string };
  duration: number;
  preview?: string;
}

export class OverlayMusicPlayer {
  private queue: MusicTrack[] = [];
  private currentIndex = -1;
  private shuffleEnabled = false;
  private repeat: RepeatMode = "none";
  private state: "playing" | "paused" | "stopped" = "stopped";
  private audioUrl: string | null = null;

  readonly events = new EventEmitter();

  private notify() {
    this.events.emit("state", this.getState());
  }

  getState(): MusicPlayerState {
    return {
      queue: this.queue,
      currentIndex: this.currentIndex,
      nowPlaying:
        this.currentIndex >= 0 && this.currentIndex < this.queue.length
          ? this.queue[this.currentIndex]
          : null,
      state: this.state,
      shuffle: this.shuffleEnabled,
      repeat: this.repeat,
      progressMs: 0,
      durationMs:
        this.currentIndex >= 0 && this.currentIndex < this.queue.length
          ? this.queue[this.currentIndex].duration * 1000
          : 0,
      audioUrl: this.audioUrl,
    };
  }

  async search(query: string): Promise<MusicTrack[]> {
    try {
      const { data } = await axios.get<{ data: DeezerTrack[] }>(
        `${DEEZER_API}/search/track`,
        { params: { q: query, limit: 20 }, timeout: 8000 }
      );
      return (data.data || []).map(this.mapDeezerTrack);
    } catch (err) {
      logger.warn("Deezer search failed", err);
      return [];
    }
  }

  async resolveAudio(track: MusicTrack): Promise<string | null> {
    try {
      const searchQuery = `${track.title} ${track.artist}`;

      const searchResult = await youtubedl(
        `ytsearch1:${searchQuery}`,
        {
          dumpSingleJson: true,
          noWarnings: true,
          flatPlaylist: true,
          noCheckCertificates: true,
        },
        { timeout: 15000 }
      );

      const videoId = searchResult.id || searchResult.entries?.[0]?.id;
      if (!videoId) return null;

      const audioResult = await youtubedl(
        `https://www.youtube.com/watch?v=${videoId}`,
        {
          dumpSingleJson: true,
          format: "bestaudio[ext=m4a]/bestaudio",
          noWarnings: true,
          noCheckCertificates: true,
          preferFreeFormats: true,
          addHeader: ["referer:youtube.com", "user-agent:Mozilla/5.0"],
        },
        { timeout: 20000 }
      );

      this.audioUrl = audioResult.url || null;
      return this.audioUrl;
    } catch (err) {
      logger.warn("yt-dlp audio resolution failed", {
        track: track.title,
        err: String(err),
      });
      return null;
    }
  }

  setQueue(tracks: MusicTrack[], startIndex = 0) {
    this.queue = tracks;
    this.currentIndex =
      tracks.length > 0 ? Math.min(startIndex, tracks.length - 1) : -1;
    this.state = "stopped";
    this.audioUrl = null;
    this.notify();
  }

  addToQueue(track: MusicTrack) {
    this.queue.push(track);
    if (this.currentIndex < 0 && this.queue.length === 1) {
      this.currentIndex = 0;
    }
    this.notify();
  }

  removeFromQueue(index: number) {
    if (index < 0 || index >= this.queue.length) return;
    this.queue.splice(index, 1);
    if (this.queue.length === 0) {
      this.currentIndex = -1;
      this.state = "stopped";
      this.audioUrl = null;
    } else if (this.currentIndex >= this.queue.length) {
      this.currentIndex = this.queue.length - 1;
    }
    this.notify();
  }

  clearQueue() {
    this.queue = [];
    this.currentIndex = -1;
    this.state = "stopped";
    this.audioUrl = null;
    this.notify();
  }

  async play(index?: number): Promise<MusicTrack | null> {
    if (index !== undefined) {
      if (index < 0 || index >= this.queue.length) return null;
      this.currentIndex = index;
    }
    if (this.currentIndex < 0 || this.queue.length === 0) return null;

    const track = this.queue[this.currentIndex];
    await this.resolveAudio(track);
    this.state = "playing";
    this.notify();
    return track;
  }

  pause() {
    this.state = "paused";
    this.notify();
  }

  resume() {
    this.state = "playing";
    this.notify();
  }

  stop() {
    this.state = "stopped";
    this.audioUrl = null;
    this.notify();
  }

  async next(): Promise<MusicTrack | null> {
    if (this.queue.length === 0) return null;

    if (this.repeat === "one") {
      return this.play();
    }

    let nextIndex: number;
    if (this.shuffleEnabled && this.queue.length > 1) {
      do {
        nextIndex = Math.floor(Math.random() * this.queue.length);
      } while (nextIndex === this.currentIndex);
    } else {
      nextIndex = this.currentIndex + 1;
    }

    if (nextIndex >= this.queue.length) {
      if (this.repeat === "all") {
        nextIndex = 0;
      } else {
        this.state = "stopped";
        this.audioUrl = null;
        this.notify();
        return null;
      }
    }

    this.currentIndex = nextIndex;
    return this.play();
  }

  async previous(): Promise<MusicTrack | null> {
    if (this.queue.length === 0) return null;

    let prevIndex: number;
    if (this.shuffleEnabled && this.queue.length > 1) {
      do {
        prevIndex = Math.floor(Math.random() * this.queue.length);
      } while (prevIndex === this.currentIndex);
    } else {
      prevIndex = this.currentIndex - 1;
    }

    if (prevIndex < 0) {
      if (this.repeat === "all") {
        prevIndex = this.queue.length - 1;
      } else {
        prevIndex = 0;
      }
    }

    this.currentIndex = prevIndex;
    return this.play();
  }

  setShuffle(enabled: boolean) {
    this.shuffleEnabled = enabled;
    this.notify();
  }

  setRepeat(mode: RepeatMode) {
    this.repeat = mode;
    this.notify();
  }

  async getPlaylists(): Promise<MusicPlaylist[]> {
    try {
      const data = await db.get<string, MusicPlaylist[] | null>(
        levelKeys.musicPlaylists,
        { valueEncoding: "json" }
      );
      return data || [];
    } catch {
      return [];
    }
  }

  async createPlaylist(name: string): Promise<MusicPlaylist> {
    const playlists = await this.getPlaylists();
    const playlist: MusicPlaylist = {
      id: randomUUID(),
      name,
      tracks: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    playlists.push(playlist);
    await db.put(levelKeys.musicPlaylists, playlists, {
      valueEncoding: "json",
    });
    return playlist;
  }

  async deletePlaylist(id: string) {
    const playlists = await this.getPlaylists();
    const index = playlists.findIndex((p) => p.id === id);
    if (index < 0) return;
    playlists.splice(index, 1);
    await db.put(levelKeys.musicPlaylists, playlists, {
      valueEncoding: "json",
    });
  }

  async renamePlaylist(id: string, name: string) {
    const playlists = await this.getPlaylists();
    const playlist = playlists.find((p) => p.id === id);
    if (!playlist) return;
    playlist.name = name;
    playlist.updatedAt = Date.now();
    await db.put(levelKeys.musicPlaylists, playlists, {
      valueEncoding: "json",
    });
  }

  async addToPlaylist(playlistId: string, track: MusicTrack) {
    const playlists = await this.getPlaylists();
    const playlist = playlists.find((p) => p.id === playlistId);
    if (!playlist) return;
    playlist.tracks.push(track);
    playlist.updatedAt = Date.now();
    await db.put(levelKeys.musicPlaylists, playlists, {
      valueEncoding: "json",
    });
  }

  async removeFromPlaylist(playlistId: string, trackIndex: number) {
    const playlists = await this.getPlaylists();
    const playlist = playlists.find((p) => p.id === playlistId);
    if (!playlist || trackIndex < 0 || trackIndex >= playlist.tracks.length)
      return;
    playlist.tracks.splice(trackIndex, 1);
    playlist.updatedAt = Date.now();
    await db.put(levelKeys.musicPlaylists, playlists, {
      valueEncoding: "json",
    });
  }

  async playPlaylist(playlistId: string, startIndex = 0) {
    const playlists = await this.getPlaylists();
    const playlist = playlists.find((p) => p.id === playlistId);
    if (!playlist || playlist.tracks.length === 0) return null;
    this.setQueue(playlist.tracks, startIndex);
    return this.play();
  }

  private mapDeezerTrack(d: DeezerTrack): MusicTrack {
    return {
      id: String(d.id),
      title: d.title,
      artist: d.artist?.name || "Unknown",
      album: d.album?.title || "Unknown",
      coverArt: d.album?.cover_big || d.album?.cover_medium || null,
      duration: d.duration || 0,
      previewUrl: d.preview,
    };
  }
}

export const overlayMusicPlayer = new OverlayMusicPlayer();
