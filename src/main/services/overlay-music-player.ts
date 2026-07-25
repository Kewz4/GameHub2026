import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import axios from "axios";
import { app } from "electron";
import { db, levelKeys } from "@main/level";
import type {
  MusicAudioSource,
  MusicTrack,
  MusicPlaylist,
  MusicPlaybackState,
  MusicPlayerState,
  RepeatMode,
} from "@types";
import { logger } from "./logger";

const DEEZER_API = "https://api.deezer.com";
const YT_DLP_SEARCH_TIMEOUT_MS = 15_000;
const YT_DLP_RESOLVE_TIMEOUT_MS = 25_000;
const YT_DLP_MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const DEEZER_PREVIEW_DURATION_MS = 30_000;

interface DeezerTrack {
  id: number;
  title: string;
  artist: { name: string };
  album: { title: string; cover_big?: string; cover_medium?: string };
  duration: number;
  preview?: string;
}

interface YoutubeSearchEntry {
  id?: string;
  title?: string;
  duration?: number | null;
}

interface YoutubeSearchResult {
  entries?: YoutubeSearchEntry[];
}

interface YoutubeAudioResult {
  url?: string;
  duration?: number | null;
}

interface ResolvedAudio {
  url: string;
  source: MusicAudioSource;
  durationMs: number;
  notice: string | null;
}

class AudioResolverUnavailableError extends Error {}
class AudioResolutionCancelledError extends Error {}

const getYtDlpFilename = () =>
  process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";

const resolveYtDlpPath = (): string | null => {
  const filename = getYtDlpFilename();
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, "yt-dlp", filename)]
    : [
        path.join(app.getAppPath(), "yt-dlp", filename),
        path.join(process.cwd(), "yt-dlp", filename),
      ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
};

const runYtDlp = (
  binaryPath: string,
  args: string[],
  timeout: number,
  signal: AbortSignal
): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(
      binaryPath,
      args,
      {
        encoding: "utf8",
        maxBuffer: YT_DLP_MAX_BUFFER_BYTES,
        shell: false,
        signal,
        timeout,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        resolve(stdout.trim());
      }
    );
  });

const parseJson = <T>(stdout: string): T => {
  if (!stdout) throw new Error("yt-dlp returned an empty response");
  return JSON.parse(stdout) as T;
};

const getHttpsUrl = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
};

const selectSearchEntry = (
  entries: YoutubeSearchEntry[],
  expectedDurationSeconds: number
): YoutubeSearchEntry | null => {
  const playable = entries.filter(
    (entry) =>
      typeof entry.id === "string" && /^[A-Za-z0-9_-]{6,20}$/.test(entry.id)
  );
  if (!playable.length) return null;
  if (!Number.isFinite(expectedDurationSeconds) || expectedDurationSeconds <= 0)
    return playable[0];

  const tolerance = Math.max(20, expectedDurationSeconds * 0.35);
  const closeMatches = playable.filter(
    (entry) =>
      typeof entry.duration === "number" &&
      Math.abs(entry.duration - expectedDurationSeconds) <= tolerance
  );
  const pool = closeMatches.length ? closeMatches : playable;

  return [...pool].sort((a, b) => {
    const aDelta =
      typeof a.duration === "number"
        ? Math.abs(a.duration - expectedDurationSeconds)
        : Number.MAX_SAFE_INTEGER;
    const bDelta =
      typeof b.duration === "number"
        ? Math.abs(b.duration - expectedDurationSeconds)
        : Number.MAX_SAFE_INTEGER;
    return aDelta - bDelta;
  })[0];
};

export class OverlayMusicPlayer {
  private queue: MusicTrack[] = [];
  private currentIndex = -1;
  private shuffleEnabled = false;
  private repeat: RepeatMode = "none";
  private state: MusicPlaybackState = "stopped";
  private audioUrl: string | null = null;
  private audioSource: MusicAudioSource | null = null;
  private playbackError: string | null = null;
  private playbackNotice: string | null = null;
  private resolvedDurationMs = 0;
  private resolvedTrack: MusicTrack | null = null;
  private resolutionGeneration = 0;
  private resolutionAbortController: AbortController | null = null;
  private ytdlpPath: string | null | undefined;

  readonly events = new EventEmitter();

  private notify() {
    this.events.emit("state", this.getState());
  }

  getState(): MusicPlayerState {
    const nowPlaying =
      this.currentIndex >= 0 && this.currentIndex < this.queue.length
        ? this.queue[this.currentIndex]
        : null;

    return {
      queue: [...this.queue],
      currentIndex: this.currentIndex,
      nowPlaying,
      state: this.state,
      shuffle: this.shuffleEnabled,
      repeat: this.repeat,
      progressMs: 0,
      durationMs:
        this.resolvedDurationMs ||
        (nowPlaying ? Math.max(0, nowPlaying.duration * 1000) : 0),
      audioUrl: this.audioUrl,
      audioSource: this.audioSource,
      playbackError: this.playbackError,
      playbackNotice: this.playbackNotice,
    };
  }

  async search(query: string): Promise<MusicTrack[]> {
    const normalizedQuery = query.trim().slice(0, 200);
    if (!normalizedQuery) return [];
    try {
      const { data } = await axios.get<{ data: DeezerTrack[] }>(
        `${DEEZER_API}/search/track`,
        { params: { q: normalizedQuery, limit: 20 }, timeout: 8000 }
      );
      return (data.data || []).map(this.mapDeezerTrack);
    } catch (err) {
      logger.warn("Deezer search failed", err);
      return [];
    }
  }

  private getYtDlp(): string {
    if (this.ytdlpPath === undefined) {
      this.ytdlpPath = resolveYtDlpPath();
    }
    if (!this.ytdlpPath) {
      throw new AudioResolverUnavailableError(
        "The bundled yt-dlp executable could not be found"
      );
    }
    return this.ytdlpPath;
  }

  private async resolveYoutubeAudio(
    track: MusicTrack,
    signal: AbortSignal
  ): Promise<ResolvedAudio> {
    const binaryPath = this.getYtDlp();
    const searchQuery = `${track.artist} - ${track.title} official audio`;
    const searchOutput = await runYtDlp(
      binaryPath,
      [
        `ytsearch5:${searchQuery}`,
        "--dump-single-json",
        "--flat-playlist",
        "--no-warnings",
        "--no-progress",
      ],
      YT_DLP_SEARCH_TIMEOUT_MS,
      signal
    );
    if (signal.aborted) throw new AudioResolutionCancelledError();
    const searchResult = parseJson<YoutubeSearchResult>(searchOutput);
    const entry = selectSearchEntry(searchResult.entries ?? [], track.duration);
    if (!entry?.id) {
      throw new Error("YouTube search returned no playable result");
    }

    const audioOutput = await runYtDlp(
      binaryPath,
      [
        `https://www.youtube.com/watch?v=${entry.id}`,
        "--dump-single-json",
        "--no-playlist",
        "--format",
        "bestaudio[ext=m4a]/bestaudio",
        "--no-warnings",
        "--no-progress",
        "--socket-timeout",
        "10",
        "--retries",
        "2",
      ],
      YT_DLP_RESOLVE_TIMEOUT_MS,
      signal
    );
    if (signal.aborted) throw new AudioResolutionCancelledError();
    const audioResult = parseJson<YoutubeAudioResult>(audioOutput);
    const url = getHttpsUrl(audioResult.url);
    if (!url) throw new Error("yt-dlp returned no secure audio URL");

    return {
      url,
      source: "youtube",
      durationMs:
        typeof audioResult.duration === "number" && audioResult.duration > 0
          ? audioResult.duration * 1000
          : Math.max(0, track.duration * 1000),
      notice: null,
    };
  }

  private async resolveAudio(
    track: MusicTrack,
    signal: AbortSignal
  ): Promise<ResolvedAudio> {
    try {
      return await this.resolveYoutubeAudio(track, signal);
    } catch (err) {
      if (signal.aborted || err instanceof AudioResolutionCancelledError) {
        throw new AudioResolutionCancelledError();
      }
      logger.warn("yt-dlp audio resolution failed", {
        track: track.title,
        err: String(err),
      });

      const previewUrl = getHttpsUrl(track.previewUrl);
      if (previewUrl) {
        return {
          url: previewUrl,
          source: "deezer-preview",
          durationMs: Math.min(
            DEEZER_PREVIEW_DURATION_MS,
            Math.max(0, track.duration * 1000) || DEEZER_PREVIEW_DURATION_MS
          ),
          notice:
            "Full playback is unavailable. Playing a 30-second Deezer preview.",
        };
      }
      throw err;
    }
  }

  private clearResolvedPlayback() {
    this.audioUrl = null;
    this.audioSource = null;
    this.resolvedDurationMs = 0;
    this.resolvedTrack = null;
    this.playbackError = null;
    this.playbackNotice = null;
  }

  private abortResolution() {
    const controller = this.resolutionAbortController;
    this.resolutionAbortController = null;
    controller?.abort();
  }

  private stopPlayback() {
    this.resolutionGeneration += 1;
    this.abortResolution();
    this.state = "stopped";
    this.clearResolvedPlayback();
  }

  setQueue(tracks: MusicTrack[], startIndex = 0) {
    this.queue = [...tracks];
    const requestedIndex = Number.isFinite(startIndex)
      ? Math.trunc(startIndex)
      : 0;
    this.currentIndex =
      tracks.length > 0
        ? Math.max(0, Math.min(requestedIndex, tracks.length - 1))
        : -1;
    this.stopPlayback();
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
    const safeIndex = Math.trunc(index);
    if (
      !Number.isFinite(safeIndex) ||
      safeIndex < 0 ||
      safeIndex >= this.queue.length
    )
      return;
    const removedCurrent = safeIndex === this.currentIndex;
    this.queue.splice(safeIndex, 1);
    if (this.queue.length === 0) {
      this.currentIndex = -1;
      this.stopPlayback();
    } else if (safeIndex < this.currentIndex) {
      this.currentIndex -= 1;
    } else if (removedCurrent) {
      this.currentIndex = Math.min(safeIndex, this.queue.length - 1);
      this.stopPlayback();
    }
    this.notify();
  }

  clearQueue() {
    this.queue = [];
    this.currentIndex = -1;
    this.stopPlayback();
    this.notify();
  }

  async play(index?: number): Promise<MusicTrack | null> {
    if (index !== undefined) {
      const safeIndex = Math.trunc(index);
      if (
        !Number.isFinite(safeIndex) ||
        safeIndex < 0 ||
        safeIndex >= this.queue.length
      )
        return null;
      this.currentIndex = safeIndex;
    } else if (this.currentIndex < 0 && this.queue.length > 0) {
      this.currentIndex = 0;
    }
    if (this.currentIndex < 0 || this.queue.length === 0) return null;

    const track = this.queue[this.currentIndex];
    if (
      index === undefined &&
      this.audioUrl &&
      this.resolvedTrack === track &&
      (this.state === "paused" || this.state === "playing")
    ) {
      this.state = "playing";
      this.playbackError = null;
      this.notify();
      return track;
    }

    this.abortResolution();
    const generation = ++this.resolutionGeneration;
    const resolutionController = new AbortController();
    this.resolutionAbortController = resolutionController;
    this.state = "resolving";
    this.clearResolvedPlayback();
    this.notify();

    try {
      const resolved = await this.resolveAudio(
        track,
        resolutionController.signal
      );
      if (
        generation !== this.resolutionGeneration ||
        this.queue[this.currentIndex] !== track
      ) {
        return null;
      }
      this.audioUrl = resolved.url;
      this.audioSource = resolved.source;
      this.resolvedDurationMs = resolved.durationMs;
      this.resolvedTrack = track;
      this.playbackNotice = resolved.notice;
      this.playbackError = null;
      this.state = "playing";
      this.notify();
      return track;
    } catch (err) {
      if (
        resolutionController.signal.aborted ||
        generation !== this.resolutionGeneration ||
        this.queue[this.currentIndex] !== track
      ) {
        return null;
      }
      this.clearResolvedPlayback();
      this.state = "error";
      this.playbackError =
        err instanceof AudioResolverUnavailableError
          ? "GameHub's audio resolver is missing. Reinstall or update GameHub."
          : "GameHub couldn't resolve a playable audio stream for this track.";
      this.notify();
      return null;
    } finally {
      if (this.resolutionAbortController === resolutionController) {
        this.resolutionAbortController = null;
      }
    }
  }

  pause() {
    if (this.state !== "playing" || !this.audioUrl) return;
    this.state = "paused";
    this.notify();
  }

  async resume(): Promise<MusicTrack | null> {
    if (this.state === "paused" && this.audioUrl) {
      this.state = "playing";
      this.playbackError = null;
      this.notify();
      return this.queue[this.currentIndex] ?? null;
    }
    if (this.state === "stopped" || this.state === "error") {
      return this.play();
    }
    return this.queue[this.currentIndex] ?? null;
  }

  stop() {
    this.stopPlayback();
    this.notify();
  }

  async next(): Promise<MusicTrack | null> {
    if (this.queue.length === 0) return null;

    if (this.repeat === "one") {
      return this.play(this.currentIndex);
    }

    let nextIndex: number;
    if (this.shuffleEnabled && this.queue.length > 1) {
      do {
        nextIndex = Math.floor(Math.random() * this.queue.length);
      } while (nextIndex === this.currentIndex);
    } else {
      nextIndex = this.currentIndex < 0 ? 0 : this.currentIndex + 1;
    }

    if (nextIndex >= this.queue.length) {
      if (this.repeat === "all") {
        nextIndex = 0;
      } else {
        this.stopPlayback();
        this.notify();
        return null;
      }
    }

    return this.play(nextIndex);
  }

  async previous(): Promise<MusicTrack | null> {
    if (this.queue.length === 0) return null;

    let prevIndex: number;
    if (this.shuffleEnabled && this.queue.length > 1) {
      do {
        prevIndex = Math.floor(Math.random() * this.queue.length);
      } while (prevIndex === this.currentIndex);
    } else {
      prevIndex = this.currentIndex < 0 ? 0 : this.currentIndex - 1;
    }

    if (prevIndex < 0) {
      if (this.repeat === "all") {
        prevIndex = this.queue.length - 1;
      } else {
        prevIndex = 0;
      }
    }

    return this.play(prevIndex);
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
