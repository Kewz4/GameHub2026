import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import type {
  AudioSession,
  HydraOverlayContext,
  HydraOverlayPerformance,
  MusicPlayerState,
  MusicPlaylist,
  MusicTrack,
  PinnedApp,
  ProfileFriends,
  RepeatMode,
  UserFriend,
} from "@types";
import "./overlay.scss";

type OverlayMode = "hidden" | "toast" | "pinned" | "full";
type MusicTab = "now-playing" | "search" | "playlists";

const formatSessionTime = (startedAt: number) => {
  if (!startedAt) return "0:00";
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
};

const metricValue = (value: number | null) =>
  value === null || value === undefined ? "—" : String(value);

const formatDuration = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

export default function Overlay() {
  const location = useLocation();
  const initialMode: OverlayMode = location.pathname.includes("overlay-fps")
    ? "pinned"
    : location.pathname.includes("overlay-toast")
      ? "toast"
      : "full";

  const [mode, setMode] = useState<OverlayMode>(initialMode);
  const [context, setContext] = useState<HydraOverlayContext | null>(null);
  const [performance, setPerformance] =
    useState<HydraOverlayPerformance | null>(null);
  const [note, setNote] = useState("");
  const [noteSaved, setNoteSaved] = useState(true);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [friends, setFriends] = useState<UserFriend[]>([]);
  const [pinnedApps, setPinnedApps] = useState<PinnedApp[]>([]);
  const [audioSessions, setAudioSessions] = useState<AudioSession[]>([]);
  const draggingPidRef = useRef<number | null>(null);

  // ── Music player state ─────────────────────────────────────────────────────
  const [musicState, setMusicState] = useState<MusicPlayerState | null>(null);
  const [musicTab, setMusicTab] = useState<MusicTab>("now-playing");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<MusicTrack[]>([]);
  const [searching, setSearching] = useState(false);
  const [playlists, setPlaylists] = useState<MusicPlaylist[]>([]);
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [localProgressMs, setLocalProgressMs] = useState(0);

  const refreshMusicState = useCallback(() => {
    window.electron
      .musicGetState()
      .then(setMusicState)
      .catch(() => undefined);
  }, []);

  const refreshPlaylists = useCallback(() => {
    window.electron
      .musicGetPlaylists()
      .then(setPlaylists)
      .catch(() => undefined);
  }, []);

  // Poll music state while full overlay is open.
  useEffect(() => {
    if (mode !== "full") return;
    refreshMusicState();
    refreshPlaylists();
    const id = setInterval(refreshMusicState, 2000);
    return () => clearInterval(id);
  }, [mode, refreshMusicState, refreshPlaylists]);

  // ── Search with debounce ────────────────────────────────────────────────────
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearching(true);
      window.electron
        .musicSearch(searchQuery.trim())
        .then(setSearchResults)
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, 400);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [searchQuery]);

  // ── Audio playback ──────────────────────────────────────────────────────────
  const audioUrl = musicState?.audioUrl;
  const audioState = musicState?.state;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (audioState === "playing" && audioUrl) {
      if (audio.src !== audioUrl) {
        audio.src = audioUrl;
        audio.load();
      }
      audio.play().catch(() => undefined);
    } else if (audioState === "paused") {
      audio.pause();
    } else if (audioState === "stopped") {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
  }, [audioUrl, audioState]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => {
      setLocalProgressMs(audio.currentTime * 1000);
    };

    const onLoadedMetadata = () => {
      setLocalProgressMs(0);
    };

    const onEnded = () => {
      window.electron
        .musicNext()
        .then(refreshMusicState)
        .catch(() => undefined);
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("ended", onEnded);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("ended", onEnded);
    };
  }, [refreshMusicState]);

  const handlePauseResume = useCallback(() => {
    if (!musicState) return;
    if (musicState.state === "playing") {
      window.electron.musicPause().catch(() => undefined);
      setMusicState((prev) => (prev ? { ...prev, state: "paused" } : prev));
    } else {
      window.electron.musicResume().catch(() => undefined);
      setMusicState((prev) => (prev ? { ...prev, state: "playing" } : prev));
    }
  }, [musicState]);

  const handleNext = useCallback(() => {
    window.electron
      .musicNext()
      .then(refreshMusicState)
      .catch(() => undefined);
  }, [refreshMusicState]);

  const handlePrevious = useCallback(() => {
    window.electron
      .musicPrevious()
      .then(refreshMusicState)
      .catch(() => undefined);
  }, [refreshMusicState]);

  const handleStop = useCallback(() => {
    window.electron.musicStop().catch(() => undefined);
    setMusicState((prev) =>
      prev
        ? { ...prev, state: "stopped", nowPlaying: null, audioUrl: null }
        : prev
    );
  }, []);

  const handleShuffleToggle = useCallback(() => {
    const next = !musicState?.shuffle;
    window.electron.musicSetShuffle(next).catch(() => undefined);
    setMusicState((prev) => (prev ? { ...prev, shuffle: next } : prev));
  }, [musicState]);

  const handleRepeatCycle = useCallback(() => {
    const cycle: RepeatMode[] = ["none", "all", "one"];
    const current = musicState?.repeat ?? "none";
    const next = cycle[(cycle.indexOf(current) + 1) % cycle.length];
    window.electron.musicSetRepeat(next).catch(() => undefined);
    setMusicState((prev) => (prev ? { ...prev, repeat: next } : prev));
  }, [musicState]);

  const handleAddToQueue = useCallback(
    (track: MusicTrack) => {
      window.electron
        .musicAddToQueue(track)
        .then(refreshMusicState)
        .catch(() => undefined);
    },
    [refreshMusicState]
  );

  const handleRemoveFromQueue = useCallback(
    (index: number) => {
      window.electron
        .musicRemoveFromQueue(index)
        .then(refreshMusicState)
        .catch(() => undefined);
    },
    [refreshMusicState]
  );

  const handleClearQueue = useCallback(() => {
    window.electron.musicClearQueue().catch(() => undefined);
    setMusicState((prev) =>
      prev ? { ...prev, queue: [], currentIndex: -1 } : prev
    );
  }, []);

  const handleCreatePlaylist = useCallback(() => {
    if (!newPlaylistName.trim()) return;
    window.electron
      .musicCreatePlaylist(newPlaylistName.trim())
      .then(() => {
        setNewPlaylistName("");
        setCreatingPlaylist(false);
        refreshPlaylists();
      })
      .catch(() => undefined);
  }, [newPlaylistName, refreshPlaylists]);

  const handleDeletePlaylist = useCallback(
    (id: string) => {
      window.electron
        .musicDeletePlaylist(id)
        .then(refreshPlaylists)
        .catch(() => undefined);
    },
    [refreshPlaylists]
  );

  const handlePlayPlaylist = useCallback(
    (id: string) => {
      window.electron
        .musicPlayPlaylist(id)
        .then(() => {
          setMusicTab("now-playing");
          refreshMusicState();
        })
        .catch(() => undefined);
    },
    [refreshMusicState]
  );

  const handleAddToPlaylist = useCallback(
    (playlistId: string, track: MusicTrack) => {
      window.electron
        .musicAddToPlaylist(playlistId, track)
        .then(refreshPlaylists)
        .catch(() => undefined);
    },
    [refreshPlaylists]
  );

  // ── General overlay state ───────────────────────────────────────────────────
  const refreshContext = useCallback(() => {
    window.electron
      .getOverlayContext()
      .then((next) => {
        if (next) {
          setContext(next);
          setPerformance(next.performance);
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refreshContext();
    window.electron
      .getOverlayNote()
      .then(setNote)
      .catch(() => undefined);

    const unsubscribers = [
      window.electron.onOverlayMode((next) => setMode(next as OverlayMode)),
      window.electron.onOverlayShown(() => {
        setMode("full");
        refreshContext();
      }),
      window.electron.onOverlayPerformance((value) => setPerformance(value)),
      window.electron.onOverlayGamepadAction((action) => {
        if (action === "back") void window.electron.closeHydraOverlay();
      }),
    ];
    return () => unsubscribers.forEach((off) => off?.());
  }, [refreshContext]);

  const [, forceTick] = useState(0);
  useEffect(() => {
    if (mode === "hidden") return;
    const id = setInterval(() => forceTick((value) => value + 1), 1000);
    return () => clearInterval(id);
  }, [mode]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") void window.electron.closeHydraOverlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    document.body.classList.add("overlay-window");
    return () => document.body.classList.remove("overlay-window");
  }, []);

  // Pinned quick-launch apps.
  useEffect(() => {
    window.electron
      .getPinnedApps()
      .then(setPinnedApps)
      .catch(() => undefined);
  }, []);

  const pinApp = useCallback(() => {
    window.electron
      .pickPinnedApp()
      .then(setPinnedApps)
      .catch(() => undefined);
  }, []);

  const unpinApp = useCallback((appPath: string) => {
    window.electron
      .removePinnedApp(appPath)
      .then(setPinnedApps)
      .catch(() => undefined);
  }, []);

  // Per-app volume mixer.
  useEffect(() => {
    if (mode !== "full") return;
    let active = true;
    const load = () =>
      window.electron
        .getAudioSessions()
        .then((sessions) => {
          if (!active) return;
          setAudioSessions((prev) => {
            const dragging = draggingPidRef.current;
            if (dragging === null) return sessions;
            const held = prev.find((s) => s.pid === dragging)?.volume;
            return sessions.map((s) =>
              s.pid === dragging && held !== undefined
                ? { ...s, volume: held }
                : s
            );
          });
        })
        .catch(() => undefined);
    load();
    const id = setInterval(load, 3000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [mode]);

  const changeSessionVolume = useCallback((pid: number, volume: number) => {
    setAudioSessions((prev) =>
      prev.map((s) => (s.pid === pid ? { ...s, volume } : s))
    );
    void window.electron.setAudioSessionVolume(pid, volume);
  }, []);

  const toggleSessionMute = useCallback((pid: number, muted: boolean) => {
    setAudioSessions((prev) =>
      prev.map((s) => (s.pid === pid ? { ...s, muted } : s))
    );
    void window.electron.setAudioSessionMute(pid, muted);
  }, []);

  // Friends presence.
  const isSignedIn = Boolean(context?.user);
  useEffect(() => {
    if (mode !== "full" || !isSignedIn) return;
    let active = true;
    const load = () =>
      window.electron.hydraApi
        .get<ProfileFriends>("/profile/friends", {
          params: { take: 12, skip: 0 },
        })
        .then((res) => active && setFriends(res.friends ?? []))
        .catch(() => undefined);
    load();
    const id = setInterval(load, 30_000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [mode, isSignedIn]);

  const handleNoteChange = (value: string) => {
    setNote(value);
    setNoteSaved(false);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => {
      window.electron
        .saveOverlayNote(value)
        .then(() => setNoteSaved(true))
        .catch(() => undefined);
    }, 600);
  };

  const perfRows = useMemo(() => {
    const rows = context?.settings.performanceRows;
    const perf = performance;
    if (!rows || !perf) return [];
    return [
      rows.fps && { label: "FPS", value: metricValue(perf.fps) },
      rows.averageFps && { label: "Avg", value: metricValue(perf.averageFps) },
      rows.onePercentLow && {
        label: "1% low",
        value: metricValue(perf.onePercentLow),
      },
      rows.frameTime && {
        label: "Frame",
        value: perf.frameTimeMs === null ? "—" : `${perf.frameTimeMs} ms`,
      },
    ].filter(Boolean) as { label: string; value: string }[];
  }, [context, performance]);

  if (mode === "hidden") return null;

  const performanceEnabled = context?.settings.performanceEnabled ?? false;

  if (mode === "pinned") {
    if (!performanceEnabled || !perfRows.length) return null;
    return (
      <div className="overlay overlay--pinned">
        <div className="overlay-hud">
          {perfRows.map((row) => (
            <div key={row.label} className="overlay-hud__row">
              <span className="overlay-hud__label">{row.label}</span>
              <span className="overlay-hud__value">{row.value}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (mode === "toast") {
    return (
      <div className="overlay overlay--toast">
        <div className="overlay-toast">
          <span className="overlay-toast__dot" />
          <div>
            <strong>Overlay ready</strong>
            <p>
              Press <kbd>{context?.shortcut ?? "Shift+F3"}</kbd> or hold the
              Guide button to open it.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const game = context?.game;
  const achievements = context?.achievements ?? [];
  const unlocked = achievements.filter((a) => a.unlocked).length;

  const nowPlaying = musicState?.nowPlaying;
  const npProgress =
    nowPlaying && musicState.durationMs > 0
      ? Math.min(100, (localProgressMs / musicState.durationMs) * 100)
      : 0;

  return (
    <div className="overlay overlay--full">
      <div className="overlay-panel">
        <header className="overlay-header">
          <div className="overlay-header__game">
            {game?.coverImageUrl || game?.iconUrl ? (
              <img
                className="overlay-header__cover"
                src={game.coverImageUrl ?? game.iconUrl ?? undefined}
                alt=""
              />
            ) : (
              <div className="overlay-header__cover overlay-header__cover--empty" />
            )}
            <div>
              <h1 className="overlay-header__title">
                {game?.title ?? "In-game overlay"}
              </h1>
              <p className="overlay-header__meta">
                {game ? formatSessionTime(game.sessionStartedAt) : ""} this
                session
                {context?.user ? ` · ${context.user.displayName}` : ""}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="overlay-close"
            onClick={() => void window.electron.closeHydraOverlay()}
            aria-label="Close overlay"
          >
            ✕
          </button>
        </header>

        <div className="overlay-grid">
          <div className="overlay-col overlay-col--left">
            {performanceEnabled && (
              <section className="overlay-card overlay-card--perf">
                {/* perf content */}
                <div className="overlay-card__head">
                  <h2>Performance</h2>
                  <label className="overlay-pin">
                    <input
                      type="checkbox"
                      checked={context?.performancePinned ?? false}
                      onChange={(event) =>
                        void window.electron.setOverlayPerformancePinned(
                          event.target.checked
                        )
                      }
                    />
                    Pin HUD
                  </label>
                </div>
                <div className="overlay-perf">
                  <div className="overlay-perf__fps">
                    {metricValue(performance?.fps ?? null)}
                    <span>fps</span>
                  </div>
                  <div className="overlay-perf__rows">
                    {perfRows
                      .filter((row) => row.label !== "FPS")
                      .map((row) => (
                        <div key={row.label} className="overlay-perf__row">
                          <span>{row.label}</span>
                          <b>{row.value}</b>
                        </div>
                      ))}
                  </div>
                </div>
              </section>
            )}

            <section className="overlay-card overlay-card--ach">
              <div className="overlay-card__head">
                <h2>Achievements</h2>
                <span className="overlay-card__count">
                  {unlocked}/{achievements.length}
                </span>
              </div>
              <ul className="overlay-ach">
                {achievements.slice(0, 6).map((achievement) => (
                  <li
                    key={achievement.name}
                    className={`overlay-ach__item ${achievement.unlocked ? "is-unlocked" : ""}`}
                  >
                    <img src={achievement.icon} alt="" loading="lazy" />
                    <div>
                      <p>{achievement.displayName}</p>
                      <small>{achievement.description}</small>
                    </div>
                  </li>
                ))}
                {achievements.length === 0 && (
                  <li className="overlay-ach__empty">
                    No achievements tracked for this game.
                  </li>
                )}
              </ul>
            </section>
          </div>

          <div className="overlay-col overlay-col--center">
            <section className="overlay-card overlay-card--music">
              {/* music card head */}
              <div className="overlay-card__head">
                <h2>Music Player</h2>
                <div className="overlay-music__tabs">
                  <button
                    type="button"
                    className={`overlay-music__tab ${musicTab === "now-playing" ? "is-active" : ""}`}
                    onClick={() => setMusicTab("now-playing")}
                  >
                    Now Playing
                  </button>
                  <button
                    type="button"
                    className={`overlay-music__tab ${musicTab === "search" ? "is-active" : ""}`}
                    onClick={() => setMusicTab("search")}
                  >
                    Search
                  </button>
                  <button
                    type="button"
                    className={`overlay-music__tab ${musicTab === "playlists" ? "is-active" : ""}`}
                    onClick={() => setMusicTab("playlists")}
                  >
                    Playlists
                  </button>
                </div>
              </div>

              {musicTab === "now-playing" && (
                <div className="overlay-music__np">
                  {nowPlaying ? (
                    <>
                      <div className="overlay-music__np-top">
                        {nowPlaying.coverArt ? (
                          <img
                            className="overlay-music__np-art"
                            src={nowPlaying.coverArt}
                            alt=""
                          />
                        ) : (
                          <div className="overlay-music__np-art overlay-music__np-art--empty" />
                        )}
                        <div className="overlay-music__np-body">
                          <p className="overlay-music__np-track">
                            {nowPlaying.title}
                          </p>
                          <p className="overlay-music__np-artist">
                            {nowPlaying.artist}
                          </p>
                          <p className="overlay-music__np-album">
                            {nowPlaying.album}
                          </p>
                        </div>
                      </div>
                      <div className="overlay-music__np-bar">
                        <i style={{ width: `${npProgress}%` }} />
                      </div>
                      <div className="overlay-music__np-time">
                        <span>{formatDuration(localProgressMs / 1000)}</span>
                        <span>
                          {formatDuration(musicState.durationMs / 1000)}
                        </span>
                      </div>
                      <div className="overlay-music__np-ctrls">
                        <button
                          type="button"
                          className={`overlay-music__mode ${musicState.shuffle ? "is-active" : ""}`}
                          onClick={handleShuffleToggle}
                          title="Shuffle"
                        >
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="16 3 21 3 21 8" />
                            <line x1="4" y1="20" x2="21" y2="3" />
                            <polyline points="21 16 21 21 16 21" />
                            <line x1="15" y1="15" x2="21" y2="21" />
                            <line x1="4" y1="4" x2="9" y2="9" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={handlePrevious}
                          aria-label="Previous track"
                        >
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                          >
                            <polygon points="19 20 9 12 19 4 19 20" />
                            <line
                              y1="4"
                              x2="4"
                              y2="20"
                              stroke="currentColor"
                              strokeWidth="2"
                            />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="overlay-music__play"
                          onClick={handlePauseResume}
                          aria-label={
                            musicState.state === "playing" ? "Pause" : "Play"
                          }
                        >
                          {musicState.state === "playing" ? (
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="currentColor"
                            >
                              <rect x="6" y="4" width="4" height="16" />
                              <rect x="14" y="4" width="4" height="16" />
                            </svg>
                          ) : (
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="currentColor"
                            >
                              <polygon points="8 5 19 12 8 19 8 5" />
                            </svg>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={handleNext}
                          aria-label="Next track"
                        >
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                          >
                            <polygon points="5 4 15 12 5 20 5 4" />
                            <line
                              x1="15"
                              y1="4"
                              x2="15"
                              y2="20"
                              stroke="currentColor"
                              strokeWidth="2"
                            />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={handleStop}
                          aria-label="Stop"
                        >
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                          >
                            <rect x="6" y="6" width="12" height="12" rx="1" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className={`overlay-music__mode ${musicState.repeat !== "none" ? "is-active" : ""}`}
                          onClick={handleRepeatCycle}
                          title={`Repeat: ${musicState.repeat}`}
                        >
                          {musicState.repeat === "one" ? (
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <polyline points="17 1 21 5 17 9" />
                              <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                              <polyline points="7 23 3 19 7 15" />
                              <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                              <text
                                x="12"
                                y="15"
                                fontSize="9"
                                fill="currentColor"
                                textAnchor="middle"
                              >
                                1
                              </text>
                            </svg>
                          ) : (
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <polyline points="17 1 21 5 17 9" />
                              <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                              <polyline points="7 23 3 19 7 15" />
                              <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                            </svg>
                          )}
                        </button>
                      </div>
                      {musicState.queue.length > 0 && (
                        <div className="overlay-music__queue">
                          <div className="overlay-music__queue-head">
                            <span>Up next ({musicState.queue.length})</span>
                            <button
                              type="button"
                              className="overlay-music__queue-clear"
                              onClick={handleClearQueue}
                            >
                              Clear
                            </button>
                          </div>
                          <ul className="overlay-music__queue-list">
                            {musicState.queue.map((track, i) => (
                              <li
                                key={`${track.id}-${i}`}
                                className={`overlay-music__queue-item ${i === musicState.currentIndex ? "is-current" : ""}`}
                              >
                                {track.coverArt ? (
                                  <img
                                    className="overlay-music__queue-art"
                                    src={track.coverArt}
                                    alt=""
                                  />
                                ) : (
                                  <div className="overlay-music__queue-art overlay-music__queue-art--empty" />
                                )}
                                <div className="overlay-music__queue-body">
                                  <span className="overlay-music__queue-title">
                                    {track.title}
                                  </span>
                                  <span className="overlay-music__queue-artist">
                                    {track.artist}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  className="overlay-music__queue-rm"
                                  onClick={() => handleRemoveFromQueue(i)}
                                  aria-label="Remove from queue"
                                >
                                  <svg
                                    width="12"
                                    height="12"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  >
                                    <line x1="18" y1="6" x2="6" y2="18" />
                                    <line x1="6" y1="6" x2="18" y2="18" />
                                  </svg>
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="overlay-ach__empty">
                      Nothing playing. Search for a track to get started.
                    </p>
                  )}
                </div>
              )}

              {musicTab === "search" && (
                <div className="overlay-music__search">
                  <input
                    className="overlay-music__search-input"
                    type="text"
                    placeholder="Search for a track or artist…"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    autoFocus
                  />
                  <div className="overlay-music__search-results">
                    {searching ? (
                      <p className="overlay-ach__empty">Searching…</p>
                    ) : searchResults.length > 0 ? (
                      <ul className="overlay-music__search-list">
                        {searchResults.map((track) => (
                          <li
                            key={track.id}
                            className="overlay-music__search-item"
                          >
                            {track.coverArt ? (
                              <img
                                className="overlay-music__search-art"
                                src={track.coverArt}
                                alt=""
                              />
                            ) : (
                              <div className="overlay-music__search-art overlay-music__search-art--empty" />
                            )}
                            <div className="overlay-music__search-body">
                              <span className="overlay-music__search-title">
                                {track.title}
                              </span>
                              <span className="overlay-music__search-artist">
                                {track.artist}
                              </span>
                            </div>
                            <div className="overlay-music__search-actions">
                              <button
                                type="button"
                                className="overlay-music__search-add"
                                onClick={() => handleAddToQueue(track)}
                                title="Add to queue"
                              >
                                + Queue
                              </button>
                              <div className="overlay-music__search-plist">
                                <button
                                  type="button"
                                  className="overlay-music__search-plist-btn"
                                  title="Add to playlist"
                                >
                                  <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  >
                                    <line x1="12" y1="5" x2="12" y2="19" />
                                    <line x1="5" y1="12" x2="19" y2="12" />
                                  </svg>
                                </button>
                                {playlists.length > 0 && (
                                  <div className="overlay-music__search-plist-drop">
                                    {playlists.map((pl) => (
                                      <button
                                        key={pl.id}
                                        type="button"
                                        onClick={() =>
                                          handleAddToPlaylist(pl.id, track)
                                        }
                                      >
                                        {pl.name}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : searchQuery.trim() ? (
                      <p className="overlay-ach__empty">No results found.</p>
                    ) : null}
                  </div>
                </div>
              )}

              {musicTab === "playlists" && (
                <div className="overlay-music__playlists">
                  {creatingPlaylist ? (
                    <div className="overlay-music__plist-create">
                      <input
                        className="overlay-music__plist-input"
                        type="text"
                        placeholder="Playlist name…"
                        value={newPlaylistName}
                        onChange={(event) =>
                          setNewPlaylistName(event.target.value)
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") handleCreatePlaylist();
                          if (event.key === "Escape") {
                            setCreatingPlaylist(false);
                            setNewPlaylistName("");
                          }
                        }}
                        autoFocus
                      />
                      <button
                        type="button"
                        className="overlay-music__plist-save"
                        onClick={handleCreatePlaylist}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="overlay-music__plist-cancel"
                        onClick={() => {
                          setCreatingPlaylist(false);
                          setNewPlaylistName("");
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="overlay-music__plist-new"
                      onClick={() => setCreatingPlaylist(true)}
                    >
                      + New Playlist
                    </button>
                  )}
                  {playlists.length > 0 ? (
                    <ul className="overlay-music__plist-list">
                      {playlists.map((pl) => (
                        <li key={pl.id} className="overlay-music__plist-item">
                          <div className="overlay-music__plist-info">
                            <span className="overlay-music__plist-name">
                              {pl.name}
                            </span>
                            <span className="overlay-music__plist-count">
                              {pl.tracks.length} tracks
                            </span>
                          </div>
                          <div className="overlay-music__plist-actions">
                            <button
                              type="button"
                              className="overlay-music__plist-play"
                              onClick={() => handlePlayPlaylist(pl.id)}
                              aria-label={`Play ${pl.name}`}
                            >
                              <svg
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                fill="currentColor"
                              >
                                <polygon points="8 5 19 12 8 19 8 5" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              className="overlay-music__plist-del"
                              onClick={() => handleDeletePlaylist(pl.id)}
                              aria-label={`Delete ${pl.name}`}
                            >
                              <svg
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              </svg>
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="overlay-ach__empty">
                      No playlists yet. Create one to save your favorite tracks.
                    </p>
                  )}
                  {playlists.length > 0 && musicTab === "playlists" && (
                    <details className="overlay-music__plist-detail">
                      {playlists.map((pl) => (
                        <div key={pl.id}>
                          {pl.tracks.map((track, i) => (
                            <div
                              key={`${track.id}-${i}`}
                              className="overlay-music__plist-track"
                            >
                              <span className="overlay-music__plist-track-idx">
                                {i + 1}
                              </span>
                              <span className="overlay-music__plist-track-title">
                                {track.title}
                              </span>
                              <span className="overlay-music__plist-track-artist">
                                {track.artist}
                              </span>
                            </div>
                          ))}
                        </div>
                      ))}
                    </details>
                  )}
                </div>
              )}
            </section>
          </div>

          <div className="overlay-col overlay-col--right">
            {context?.user && friends.length > 0 && (
              <section className="overlay-card overlay-card--friends">
                <div className="overlay-card__head">
                  <h2>Friends</h2>
                  <span className="overlay-card__count">
                    {friends.filter((friend) => friend.isOnline).length} online
                  </span>
                </div>
                <ul className="overlay-friends">
                  {friends.slice(0, 6).map((friend) => (
                    <li key={friend.id} className="overlay-friend">
                      {friend.profileImageUrl ? (
                        <img
                          className="overlay-friend__av"
                          src={friend.profileImageUrl}
                          alt=""
                        />
                      ) : (
                        <div className="overlay-friend__av overlay-friend__av--empty" />
                      )}
                      <div className="overlay-friend__body">
                        <p>{friend.displayName}</p>
                        <small>
                          {friend.currentGame
                            ? `Playing ${friend.currentGame.title}`
                            : friend.isOnline
                              ? "Online"
                              : "Offline"}
                        </small>
                      </div>
                      <span
                        className={`overlay-friend__dot ${friend.isOnline ? "is-online" : ""}`}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {audioSessions.length > 0 && (
              <section className="overlay-card overlay-card--mixer">
                <div className="overlay-card__head">
                  <h2>Volume mixer</h2>
                  <span className="overlay-card__count">
                    {audioSessions.length}
                  </span>
                </div>
                <ul className="overlay-mixer">
                  {audioSessions.map((session) => (
                    <li
                      key={session.pid}
                      className={`overlay-mixer__row ${session.muted ? "is-muted" : ""}`}
                    >
                      <button
                        type="button"
                        className="overlay-mixer__mute"
                        onClick={() =>
                          toggleSessionMute(session.pid, !session.muted)
                        }
                        aria-label={
                          session.muted
                            ? `Unmute ${session.name}`
                            : `Mute ${session.name}`
                        }
                        title={session.muted ? "Unmute" : "Mute"}
                      >
                        {session.muted ? (
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                            <line x1="23" y1="9" x2="17" y2="15" />
                            <line x1="17" y1="9" x2="23" y2="15" />
                          </svg>
                        ) : (
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                          </svg>
                        )}
                      </button>
                      <div className="overlay-mixer__body">
                        <div className="overlay-mixer__label">
                          <span className="overlay-mixer__name">
                            {session.name}
                          </span>
                          <span className="overlay-mixer__pct">
                            {Math.round(session.volume * 100)}
                          </span>
                        </div>
                        <input
                          className="overlay-mixer__slider"
                          type="range"
                          min={0}
                          max={100}
                          value={Math.round(session.volume * 100)}
                          onPointerDown={() => {
                            draggingPidRef.current = session.pid;
                          }}
                          onPointerUp={() => {
                            draggingPidRef.current = null;
                          }}
                          onChange={(event) =>
                            changeSessionVolume(
                              session.pid,
                              Number(event.target.value) / 100
                            )
                          }
                          aria-label={`${session.name} volume`}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="overlay-card overlay-card--pins">
              <div className="overlay-card__head">
                <h2>Quick launch</h2>
                <span className="overlay-card__count">{pinnedApps.length}</span>
              </div>
              <div className="overlay-pins">
                {pinnedApps.map((app) => (
                  <button
                    key={app.path}
                    type="button"
                    className="overlay-pin-tile"
                    onClick={() =>
                      void window.electron.launchPinnedApp(app.path)
                    }
                    onContextMenu={(event) => {
                      event.preventDefault();
                      unpinApp(app.path);
                    }}
                    title={`${app.name} — right-click to unpin`}
                  >
                    <span className="overlay-pin-tile__glyph">
                      {app.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="overlay-pin-tile__label">{app.name}</span>
                  </button>
                ))}
                <button
                  type="button"
                  className="overlay-pin-tile overlay-pin-tile--add"
                  onClick={pinApp}
                >
                  <span className="overlay-pin-tile__glyph">+</span>
                  <span className="overlay-pin-tile__label">Pin app</span>
                </button>
              </div>
            </section>

            <section className="overlay-card overlay-card--notes">
              <div className="overlay-card__head">
                <h2>Notes</h2>
                <span className="overlay-card__count">
                  {noteSaved ? "Saved" : "Saving…"}
                </span>
              </div>
              <textarea
                className="overlay-notes"
                value={note}
                placeholder="Jot down a code, a boss strategy, where you left off…"
                onChange={(event) => handleNoteChange(event.target.value)}
              />
            </section>
          </div>
        </div>

        <audio ref={audioRef} preload="none">
          <track kind="captions" />
        </audio>
        <footer className="overlay-foot">
          Press <kbd>{context?.shortcut ?? "Shift+F3"}</kbd> or{" "}
          <kbd>{context?.controllerShortcut ?? "View + Menu"}</kbd> to close ·
          hold the Guide button to toggle
        </footer>
      </div>
    </div>
  );
}
