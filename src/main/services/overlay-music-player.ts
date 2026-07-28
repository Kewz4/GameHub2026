import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import axios from "axios";
import { app, BrowserWindow } from "electron";
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
const YOUTUBE_SEARCH_URL = "https://www.youtube.com/results";
const YOUTUBE_SEARCH_TIMEOUT_MS = 7_000;
const YT_DLP_RESOLVE_TIMEOUT_MS = 22_000;
const YT_DLP_MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const DEEZER_PREVIEW_DURATION_MS = 30_000;
const AUDIO_CACHE_TTL_MS = 20 * 60_000;
const AUDIO_CACHE_MAX_ENTRIES = 32;
const PLAYBACK_PROGRESS_BROADCAST_INTERVAL_MS = 500;

interface DeezerTrack {
  id: number;
  title: string;
  artist: { name: string };
  album: { title: string; cover_big?: string; cover_medium?: string };
  duration: number;
  preview?: string;
}

interface YoutubeAudioResult {
  url?: string;
  duration?: number | null;
  entries?: YoutubeAudioResult[];
}

interface ResolvedAudio {
  url: string;
  source: MusicAudioSource;
  durationMs: number;
  notice: string | null;
}

interface CachedAudio {
  audio: ResolvedAudio;
  expiresAt: number;
}

class AudioResolverUnavailableError extends Error {}

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
  private playbackId = 0;
  private progressMs = 0;
  private volume = 0.8;
  private muted = false;
  private seekId = 0;
  private preloadedNextIndex = -1;
  private preloadedTrack: MusicTrack | null = null;
  private preloadedAudio: ResolvedAudio | null = null;
  private audioCache = new Map<string, CachedAudio>();
  private resolutionPromises = new Map<string, Promise<ResolvedAudio>>();
  private preloadGeneration = 0;
  private lastProgressBroadcastAt = 0;
  private ytdlpPath: string | null | undefined;

  readonly events = new EventEmitter();

  private notify() {
    const state = this.getState();
    this.events.emit("state", state);
    for (const window of BrowserWindow.getAllWindows()) {
      try {
        if (window.isDestroyed() || window.webContents.isDestroyed()) continue;
        window.webContents.send("on-music-state", state);
      } catch {
        // A short-lived overlay window can close between enumeration and send.
      }
    }
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
      progressMs: this.progressMs,
      durationMs:
        this.resolvedDurationMs ||
        (nowPlaying ? Math.max(0, nowPlaying.duration * 1000) : 0),
      audioUrl: this.audioUrl,
      audioSource: this.audioSource,
      playbackError: this.playbackError,
      playbackNotice: this.playbackNotice,
      playbackId: this.playbackId,
      preloadedNextIndex: this.preloadedNextIndex,
      preloadedAudioUrl: this.preloadedAudio?.url ?? null,
      preloadedAudioSource: this.preloadedAudio?.source ?? null,
      volume: this.volume,
      muted: this.muted,
      seekId: this.seekId,
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
      const tracks = (data.data || []).map(this.mapDeezerTrack);
      // The first result is selected most often. Start resolving it while the
      // user is still reading the result list so a subsequent Play click can
      // reuse the same in-flight request or the completed cache entry.
      if (tracks[0]) {
        void this.resolveAudioCached(tracks[0]).catch(() => undefined);
      }
      return tracks;
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
    let videoId: string | null = null;
    try {
      const { data } = await axios.get<string>(YOUTUBE_SEARCH_URL, {
        params: { search_query: searchQuery, hl: "en" },
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/132 Safari/537.36",
        },
        responseType: "text",
        timeout: YOUTUBE_SEARCH_TIMEOUT_MS,
        maxContentLength: 4 * 1024 * 1024,
        signal,
      });
      videoId = /"videoId":"([A-Za-z0-9_-]{11})"/.exec(data)?.[1] ?? null;
    } catch (err) {
      if (signal.aborted) throw err;
      logger.debug("Fast YouTube music search unavailable; using yt-dlp", {
        track: track.title,
        err: String(err),
      });
    }

    // YouTube's search page supplies the video id in well under a second in
    // normal conditions, leaving yt-dlp to perform only the media extraction.
    // ytsearch remains a reliable fallback if the page shape ever changes.
    const target = videoId
      ? `https://www.youtube.com/watch?v=${videoId}`
      : `ytsearch1:${searchQuery}`;
    const audioOutput = await runYtDlp(
      binaryPath,
      [
        target,
        "--dump-single-json",
        "--playlist-end",
        "1",
        "--no-playlist",
        "--format",
        "bestaudio[acodec^=opus]/bestaudio[ext=m4a]/bestaudio",
        "--no-warnings",
        "--no-progress",
        "--socket-timeout",
        "8",
        "--retries",
        "1",
      ],
      YT_DLP_RESOLVE_TIMEOUT_MS,
      signal
    );
    if (signal.aborted) throw new Error("Audio resolution was cancelled");
    const output = parseJson<YoutubeAudioResult>(audioOutput);
    const audioResult = output.entries?.[0] ?? output;
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
      if (signal.aborted) throw err;
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

  private getTrackCacheKey(track: MusicTrack) {
    return `${track.id}\u0000${track.artist}\u0000${track.title}`;
  }

  private trimAudioCache() {
    const now = Date.now();
    for (const [key, cached] of this.audioCache) {
      if (cached.expiresAt <= now) this.audioCache.delete(key);
    }

    while (this.audioCache.size > AUDIO_CACHE_MAX_ENTRIES) {
      const oldestKey = this.audioCache.keys().next().value as
        | string
        | undefined;
      if (!oldestKey) break;
      this.audioCache.delete(oldestKey);
    }
  }

  private getCachedAudio(track: MusicTrack): ResolvedAudio | null {
    const key = this.getTrackCacheKey(track);
    const cached = this.audioCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      // Refresh insertion order so recently used streams stay in the LRU.
      this.audioCache.delete(key);
      this.audioCache.set(key, cached);
      return cached.audio;
    }
    if (cached) this.audioCache.delete(key);
    return null;
  }

  private resolveAudioCached(track: MusicTrack): Promise<ResolvedAudio> {
    const key = this.getTrackCacheKey(track);
    const cached = this.getCachedAudio(track);
    if (cached) return Promise.resolve(cached);

    const pending = this.resolutionPromises.get(key);
    if (pending) return pending;

    const controller = new AbortController();
    const resolution = this.resolveAudio(track, controller.signal)
      .then((audio) => {
        this.audioCache.set(key, {
          audio,
          expiresAt: Date.now() + AUDIO_CACHE_TTL_MS,
        });
        this.trimAudioCache();
        return audio;
      })
      .finally(() => {
        if (this.resolutionPromises.get(key) === resolution) {
          this.resolutionPromises.delete(key);
        }
      });

    this.resolutionPromises.set(key, resolution);
    return resolution;
  }

  private activateResolvedTrack(track: MusicTrack, resolved: ResolvedAudio) {
    this.audioUrl = resolved.url;
    this.audioSource = resolved.source;
    this.resolvedDurationMs = resolved.durationMs;
    this.resolvedTrack = track;
    this.playbackNotice = resolved.notice;
    this.playbackError = null;
    this.state = "playing";
    this.playbackId += 1;
  }

  private invalidateCachedAudio(track: MusicTrack | null) {
    if (!track) return;
    this.audioCache.delete(this.getTrackCacheKey(track));
  }

  private clearResolvedPlayback() {
    this.audioUrl = null;
    this.audioSource = null;
    this.resolvedDurationMs = 0;
    this.resolvedTrack = null;
    this.playbackError = null;
    this.playbackNotice = null;
  }

  private clearPreloadedPlayback() {
    this.preloadGeneration += 1;
    this.preloadedNextIndex = -1;
    this.preloadedTrack = null;
    this.preloadedAudio = null;
  }

  private getNextIndexForPreload() {
    if (this.queue.length === 0 || this.currentIndex < 0) return -1;
    if (this.repeat === "one") return -1;

    if (this.shuffleEnabled && this.queue.length > 1) {
      if (
        this.preloadedNextIndex >= 0 &&
        this.preloadedNextIndex < this.queue.length &&
        this.preloadedNextIndex !== this.currentIndex
      ) {
        return this.preloadedNextIndex;
      }

      let nextIndex = this.currentIndex;
      while (nextIndex === this.currentIndex) {
        nextIndex = Math.floor(Math.random() * this.queue.length);
      }
      return nextIndex;
    }

    const sequentialIndex = this.currentIndex + 1;
    if (sequentialIndex < this.queue.length) return sequentialIndex;
    return this.repeat === "all" ? 0 : -1;
  }

  private scheduleNextPreload() {
    const nextIndex = this.getNextIndexForPreload();
    if (nextIndex < 0) {
      if (this.preloadedNextIndex >= 0 || this.preloadedAudio) {
        this.clearPreloadedPlayback();
        this.notify();
      }
      return;
    }

    const track = this.queue[nextIndex];
    if (
      this.preloadedNextIndex === nextIndex &&
      this.preloadedTrack === track
    ) {
      return;
    }

    const generation = ++this.preloadGeneration;
    this.preloadedNextIndex = nextIndex;
    this.preloadedTrack = track;
    this.preloadedAudio = null;
    void this.resolveAudioCached(track)
      .then((audio) => {
        if (
          generation !== this.preloadGeneration ||
          this.queue[nextIndex] !== track ||
          this.preloadedNextIndex !== nextIndex
        ) {
          return;
        }
        this.preloadedAudio = audio;
        this.notify();
      })
      .catch((err) => {
        if (generation !== this.preloadGeneration) return;
        logger.warn("Could not preload the next music track", {
          track: track.title,
          err: String(err),
        });
        this.preloadedNextIndex = -1;
        this.preloadedTrack = null;
        this.preloadedAudio = null;
        this.notify();
      });
  }

  private warmCurrentAndNext() {
    const current = this.queue[this.currentIndex];
    if (current) {
      void this.resolveAudioCached(current).catch((err) => {
        logger.warn("Could not warm the current music track", {
          track: current.title,
          err: String(err),
        });
      });
    }
    this.scheduleNextPreload();
  }

  private stopPlayback() {
    this.resolutionGeneration += 1;
    this.state = "stopped";
    this.progressMs = 0;
    this.clearResolvedPlayback();
    this.clearPreloadedPlayback();
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
    this.warmCurrentAndNext();
  }

  addToQueue(track: MusicTrack) {
    this.queue.push(track);
    if (this.currentIndex < 0 && this.queue.length === 1) {
      this.currentIndex = 0;
    }
    this.notify();
    this.warmCurrentAndNext();
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
    this.clearPreloadedPlayback();
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
    this.warmCurrentAndNext();
  }

  clearQueue() {
    this.queue = [];
    this.currentIndex = -1;
    this.stopPlayback();
    this.notify();
  }

  async play(index?: number, forceRefresh = false): Promise<MusicTrack | null> {
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

    if (forceRefresh) this.invalidateCachedAudio(track);
    const cached = forceRefresh ? null : this.getCachedAudio(track);
    if (cached) {
      this.resolutionGeneration += 1;
      this.progressMs = 0;
      this.clearResolvedPlayback();
      this.clearPreloadedPlayback();
      this.activateResolvedTrack(track, cached);
      this.notify();
      this.scheduleNextPreload();
      return track;
    }

    const generation = ++this.resolutionGeneration;
    this.state = "resolving";
    this.progressMs = 0;
    this.clearResolvedPlayback();
    this.clearPreloadedPlayback();
    this.notify();
    this.scheduleNextPreload();

    try {
      const resolved = await this.resolveAudioCached(track);
      if (
        generation !== this.resolutionGeneration ||
        this.queue[this.currentIndex] !== track
      ) {
        return null;
      }
      this.activateResolvedTrack(track, resolved);
      this.notify();
      this.scheduleNextPreload();
      return track;
    } catch (err) {
      if (
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
    }
  }

  async refreshCurrent(): Promise<MusicTrack | null> {
    if (this.currentIndex < 0 || this.currentIndex >= this.queue.length) {
      return null;
    }
    return this.play(this.currentIndex, true);
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
    if (
      this.shuffleEnabled &&
      this.preloadedNextIndex >= 0 &&
      this.preloadedNextIndex < this.queue.length &&
      this.preloadedNextIndex !== this.currentIndex
    ) {
      nextIndex = this.preloadedNextIndex;
    } else if (this.shuffleEnabled && this.queue.length > 1) {
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
    this.clearPreloadedPlayback();
    this.notify();
    this.scheduleNextPreload();
  }

  setRepeat(mode: RepeatMode) {
    this.repeat = mode;
    this.clearPreloadedPlayback();
    this.notify();
    this.scheduleNextPreload();
  }

  setVolume(volume: number, muted?: boolean) {
    if (Number.isFinite(volume)) {
      this.volume = Math.max(0, Math.min(1, volume));
    }
    if (typeof muted === "boolean") this.muted = muted;
    this.notify();
  }

  seek(progressMs: number) {
    if (!Number.isFinite(progressMs)) return;
    const durationMs =
      this.resolvedDurationMs ||
      Math.max(0, (this.queue[this.currentIndex]?.duration ?? 0) * 1000);
    this.progressMs = Math.max(
      0,
      Math.min(progressMs, durationMs || progressMs)
    );
    this.seekId += 1;
    this.notify();
  }

  reportPlaybackProgress(progressMs: number, durationMs: number) {
    if (this.state !== "playing" && this.state !== "paused") return;
    if (!Number.isFinite(progressMs) || progressMs < 0) return;
    this.progressMs = progressMs;
    if (Number.isFinite(durationMs) && durationMs > 0) {
      this.resolvedDurationMs = durationMs;
    }

    const now = Date.now();
    if (
      now - this.lastProgressBroadcastAt >=
      PLAYBACK_PROGRESS_BROADCAST_INTERVAL_MS
    ) {
      this.lastProgressBroadcastAt = now;
      this.notify();
    }
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
