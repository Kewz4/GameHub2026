import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation } from "react-router-dom";
import {
  AppsIcon,
  GraphIcon,
  LockIcon,
  MuteIcon,
  NoteIcon,
  PeopleIcon,
  PinIcon,
  PlusIcon,
  SearchIcon,
  SyncIcon,
  TrashIcon,
  TrophyIcon,
  UnlockIcon,
  UnmuteIcon,
  XIcon,
} from "@primer/octicons-react";
import {
  CircleAlert,
  Circle,
  FolderOpen,
  History,
  ListMusic,
  Music2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  RotateCcw,
  Shuffle,
  SkipBack,
  SkipForward,
  Square,
  Video,
} from "lucide-react";
import type {
  AudioSession,
  GameRecorderState,
  HydraOverlayContext,
  HydraOverlayGamepadAction,
  HydraOverlayPerformance,
  MusicPlayerState,
  MusicPlaylist,
  MusicTrack,
  PinnedApp,
  ProfileFriends,
  RepeatMode,
  UserFriend,
} from "@types";
import { OverlayWidgetFrame } from "./overlay-widget-frame";
import { type OverlayWidgetId, useOverlayLayout } from "./use-overlay-layout";
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

const CONTROLLER_FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const getControllerElements = () =>
  Array.from(
    document.querySelectorAll<HTMLElement>(CONTROLLER_FOCUSABLE_SELECTOR)
  ).filter((element) => {
    if (!element.closest(".overlay--full")) return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden"
    );
  });

type FocusOverlayWidget = (widgetId: OverlayWidgetId) => void;

const focusControllerElement = (
  element: HTMLElement,
  focusOverlayWidget: FocusOverlayWidget
) => {
  const widgetId = element.closest<HTMLElement>("[data-widget]")?.dataset
    .widget as OverlayWidgetId | undefined;
  if (widgetId) focusOverlayWidget(widgetId);
  element.scrollIntoView({ block: "nearest", inline: "nearest" });
  element.focus({ preventScroll: true });
};

const focusControllerDefault = (focusOverlayWidget: FocusOverlayWidget) => {
  const elements = getControllerElements();
  const target =
    elements.find((element) =>
      element.hasAttribute("data-controller-default")
    ) ??
    elements.find((element) =>
      element.matches(".overlay-music__tab.is-active")
    ) ??
    elements[0];
  if (target) focusControllerElement(target, focusOverlayWidget);
  return target ?? null;
};

const moveControllerFocus = (
  action: Extract<HydraOverlayGamepadAction, "up" | "down" | "left" | "right">,
  focusOverlayWidget: FocusOverlayWidget
) => {
  const elements = getControllerElements();
  if (!elements.length) return;

  const active = document.activeElement;
  const current = elements.includes(active as HTMLElement)
    ? (active as HTMLElement)
    : focusControllerDefault(focusOverlayWidget);
  if (!current) return;

  const origin = current.getBoundingClientRect();
  const originX = origin.left + origin.width / 2;
  const originY = origin.top + origin.height / 2;
  const candidates = elements
    .filter((element) => element !== current)
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const dx = rect.left + rect.width / 2 - originX;
      const dy = rect.top + rect.height / 2 - originY;
      const inDirection =
        action === "left"
          ? dx < -3
          : action === "right"
            ? dx > 3
            : action === "up"
              ? dy < -3
              : dy > 3;
      if (!inDirection) return null;

      const primary =
        action === "left" || action === "right" ? Math.abs(dx) : Math.abs(dy);
      const secondary =
        action === "left" || action === "right" ? Math.abs(dy) : Math.abs(dx);
      return {
        element,
        score: primary + secondary * 0.35 + (secondary / (primary + 1)) * 60,
      };
    })
    .filter(
      (
        candidate
      ): candidate is {
        element: HTMLElement;
        score: number;
      } => candidate !== null
    )
    .sort((left, right) => left.score - right.score);

  const next = candidates[0]?.element;
  if (next) focusControllerElement(next, focusOverlayWidget);
};

const adjustControllerRange = (
  input: HTMLInputElement,
  direction: "left" | "right"
) => {
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const step = Number(input.step || 1);
  const multiplier = input.classList.contains("overlay-music__np-bar") ? 4 : 2;
  const next = Math.min(
    max,
    Math.max(
      min,
      Number(input.value) + (direction === "right" ? 1 : -1) * step * multiplier
    )
  );
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set;
  valueSetter?.call(input, String(next));
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
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
  const [recorderState, setRecorderState] = useState<GameRecorderState | null>(
    null
  );
  const [recorderNotice, setRecorderNotice] = useState<string | null>(null);
  const draggingPidRef = useRef<number | null>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const {
    beginWidgetDrag,
    focusWidget,
    getWidgetStyle,
    layoutLocked,
    registerWidget,
    resetLayout,
    setLayoutLocked,
  } = useOverlayLayout(workspaceRef);

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
  const [audioDurationMs, setAudioDurationMs] = useState(0);
  const [playerVolume, setPlayerVolume] = useState(0.8);
  const [playerMuted, setPlayerMuted] = useState(false);
  const [localPlaybackError, setLocalPlaybackError] = useState<string | null>(
    null
  );
  const audioRetryCount = useRef(0);
  const lastAudioUrl = useRef<string | null>(null);
  const [playlistMenuTrackId, setPlaylistMenuTrackId] = useState<string | null>(
    null
  );
  const [expandedPlaylistId, setExpandedPlaylistId] = useState<string | null>(
    null
  );

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
      audio.play().catch(() => {
        setLocalPlaybackError(
          "GameHub could not start audio playback. Try Play again."
        );
      });
    } else if (audioState === "paused") {
      audio.pause();
    } else if (
      audioState === "stopped" ||
      audioState === "resolving" ||
      audioState === "error"
    ) {
      audio.pause();
      if (audioState === "stopped" || audioState === "error") {
        audio.removeAttribute("src");
        audio.load();
      }
    }
  }, [audioUrl, audioState]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = playerVolume;
    audio.muted = playerMuted;
  }, [playerMuted, playerVolume]);

  useEffect(() => {
    if (lastAudioUrl.current !== audioUrl) {
      lastAudioUrl.current = audioUrl ?? null;
      audioRetryCount.current = 0;
      setLocalPlaybackError(null);
    }
  }, [audioUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => {
      setLocalProgressMs(audio.currentTime * 1000);
    };

    const onLoadedMetadata = () => {
      setLocalProgressMs(0);
      setAudioDurationMs(
        Number.isFinite(audio.duration) ? audio.duration * 1000 : 0
      );
      setLocalPlaybackError(null);
    };

    const onEnded = () => {
      window.electron
        .musicNext()
        .then(refreshMusicState)
        .catch(() => undefined);
    };

    const onError = () => {
      const index = musicState?.currentIndex ?? -1;
      if (index >= 0 && audioRetryCount.current < 1) {
        audioRetryCount.current += 1;
        setLocalPlaybackError("Refreshing the audio stream…");
        window.electron
          .musicPlay(index)
          .then(refreshMusicState)
          .catch(() => {
            setLocalPlaybackError(
              "This track is not playable right now. Try another result."
            );
          });
        return;
      }
      setLocalPlaybackError(
        "This audio stream stopped responding. Try Play to refresh it."
      );
    };

    const onCanPlay = () => setLocalPlaybackError(null);

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    audio.addEventListener("canplay", onCanPlay);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("canplay", onCanPlay);
    };
  }, [musicState?.currentIndex, refreshMusicState]);

  const handlePauseResume = useCallback(() => {
    if (!musicState) return;
    if (musicState.state === "playing") {
      window.electron.musicPause().catch(() => undefined);
      setMusicState((prev) => (prev ? { ...prev, state: "paused" } : prev));
      return;
    }

    if (musicState.state === "resolving") return;

    setLocalPlaybackError(null);
    if (musicState.state === "paused" && musicState.audioUrl) {
      window.electron
        .musicResume()
        .then(refreshMusicState)
        .catch(() =>
          setLocalPlaybackError("GameHub could not resume this track.")
        );
      return;
    }

    if (musicState.currentIndex < 0) return;
    setMusicState((prev) => (prev ? { ...prev, state: "resolving" } : prev));
    window.electron
      .musicPlay(musicState.currentIndex)
      .then(refreshMusicState)
      .catch(() =>
        setLocalPlaybackError(
          "GameHub could not load this track. Try another result."
        )
      );
  }, [musicState, refreshMusicState]);

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
        ? {
            ...prev,
            state: "stopped",
            audioUrl: null,
            audioSource: null,
            playbackError: null,
            playbackNotice: null,
          }
        : prev
    );
    setLocalProgressMs(0);
    setAudioDurationMs(0);
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

  const handlePlayTrack = useCallback(
    (track: MusicTrack) => {
      setMusicTab("now-playing");
      setLocalPlaybackError(null);
      window.electron
        .musicSetQueue([track], 0)
        .then(() => window.electron.musicPlay(0))
        .then(refreshMusicState)
        .catch(() =>
          setLocalPlaybackError(
            "GameHub could not load this track. Try another result."
          )
        );
    },
    [refreshMusicState]
  );

  const handlePlayQueueIndex = useCallback(
    (index: number) => {
      setLocalPlaybackError(null);
      window.electron
        .musicPlay(index)
        .then(refreshMusicState)
        .catch(() =>
          setLocalPlaybackError(
            "GameHub could not load this track. Try another result."
          )
        );
    },
    [refreshMusicState]
  );

  const handleRetryPlayback = useCallback(() => {
    const index = musicState?.currentIndex ?? -1;
    if (index < 0) return;
    audioRetryCount.current = 0;
    setLocalPlaybackError(null);
    setMusicState((current) =>
      current ? { ...current, state: "resolving" } : current
    );
    window.electron
      .musicPlay(index)
      .then(refreshMusicState)
      .catch(() =>
        setLocalPlaybackError(
          "GameHub could not refresh this track. Try another result."
        )
      );
  }, [musicState?.currentIndex, refreshMusicState]);

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
    audioRef.current?.pause();
    window.electron.musicClearQueue().catch(() => undefined);
    setMusicState((prev) =>
      prev
        ? {
            ...prev,
            queue: [],
            currentIndex: -1,
            nowPlaying: null,
            state: "stopped",
            audioUrl: null,
          }
        : prev
    );
    setLocalProgressMs(0);
    setAudioDurationMs(0);
  }, []);

  const handleSeek = useCallback((progressMs: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration)) return;
    const nextSeconds = Math.min(
      audio.duration,
      Math.max(0, progressMs / 1000)
    );
    audio.currentTime = nextSeconds;
    setLocalProgressMs(nextSeconds * 1000);
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

  const handleRemoveFromPlaylist = useCallback(
    (playlistId: string, trackIndex: number) => {
      window.electron
        .musicRemoveFromPlaylist(playlistId, trackIndex)
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

  const refreshRecorderState = useCallback(() => {
    window.electron
      .gameRecorderGetState()
      .then(setRecorderState)
      .catch(() => undefined);
  }, []);

  const startGameplayRecording = useCallback(() => {
    setRecorderNotice(null);
    void window.electron
      .gameRecorderStart()
      .then(setRecorderState)
      .catch((error) =>
        setRecorderNotice(
          error instanceof Error ? error.message : String(error)
        )
      );
  }, []);

  const stopGameplayRecording = useCallback(() => {
    setRecorderNotice("Saving recording…");
    void window.electron.gameRecorderStop().then((result) => {
      setRecorderNotice(
        result.ok ? "Recording saved to your capture folder." : result.error
      );
      refreshRecorderState();
    });
  }, [refreshRecorderState]);

  const saveInstantReplay = useCallback(() => {
    setRecorderNotice("Saving Instant Replay…");
    void window.electron.gameRecorderSaveReplay().then((result) => {
      setRecorderNotice(
        result.ok
          ? `Last ${recorderState?.configuration.replayDurationSeconds ?? 30} seconds saved.`
          : result.error
      );
      refreshRecorderState();
    });
  }, [
    recorderState?.configuration.replayDurationSeconds,
    refreshRecorderState,
  ]);

  const handleControllerAction = useCallback(
    (action: HydraOverlayGamepadAction) => {
      if (action === "back") {
        if (playlistMenuTrackId) {
          setPlaylistMenuTrackId(null);
          return;
        }
        if (creatingPlaylist) {
          setCreatingPlaylist(false);
          setNewPlaylistName("");
          return;
        }
        if (expandedPlaylistId) {
          setExpandedPlaylistId(null);
          return;
        }
        const active = document.activeElement;
        if (
          active instanceof HTMLInputElement ||
          active instanceof HTMLTextAreaElement ||
          active instanceof HTMLSelectElement
        ) {
          active.blur();
          focusControllerDefault(focusWidget);
          return;
        }
        void window.electron.closeHydraOverlay();
        return;
      }

      document.body.classList.add("overlay-controller-navigation");

      if (action === "previous-tab" || action === "next-tab") {
        const tabs = Array.from(
          document.querySelectorAll<HTMLButtonElement>(".overlay-music__tab")
        ).filter((tab) => tab.getBoundingClientRect().width > 0);
        if (!tabs.length) return;
        const activeIndex = Math.max(
          0,
          tabs.findIndex((tab) => tab.classList.contains("is-active"))
        );
        const offset = action === "next-tab" ? 1 : -1;
        const next = tabs[(activeIndex + offset + tabs.length) % tabs.length];
        next.click();
        focusControllerElement(next, focusWidget);
        return;
      }

      const active = document.activeElement;
      if (action === "accept") {
        if (
          active instanceof HTMLButtonElement ||
          (active instanceof HTMLInputElement &&
            ["button", "checkbox", "radio", "submit"].includes(active.type))
        ) {
          active.click();
        } else if (
          active instanceof HTMLInputElement ||
          active instanceof HTMLTextAreaElement
        ) {
          active.focus({ preventScroll: true });
        } else if (active instanceof HTMLSelectElement) {
          active.click();
        } else {
          const recovered = focusControllerDefault(focusWidget);
          if (recovered instanceof HTMLButtonElement) recovered.click();
        }
        return;
      }

      if (
        active instanceof HTMLInputElement &&
        active.type === "range" &&
        (action === "left" || action === "right")
      ) {
        adjustControllerRange(active, action);
        return;
      }

      moveControllerFocus(action, focusWidget);
    },
    [creatingPlaylist, expandedPlaylistId, focusWidget, playlistMenuTrackId]
  );

  useEffect(() => {
    refreshContext();
    refreshRecorderState();
    window.electron
      .getOverlayNote()
      .then(setNote)
      .catch(() => undefined);

    const unsubscribers = [
      window.electron.onOverlayMode((next) => setMode(next as OverlayMode)),
      window.electron.onOverlayShown(() => {
        if (initialMode === "full") {
          setMode("full");
          window.requestAnimationFrame(() => {
            document.body.classList.add("overlay-controller-navigation");
            focusControllerDefault(focusWidget);
          });
        }
        refreshContext();
      }),
      window.electron.onOverlayPerformance((value) => setPerformance(value)),
      window.electron.onOverlayPerformancePin((pinned) => {
        setContext((current) =>
          current ? { ...current, performancePinned: pinned } : current
        );
      }),
      window.electron.onOverlayGamepadAction(handleControllerAction),
      window.electron.onGameRecorderState(setRecorderState),
    ];
    return () => unsubscribers.forEach((off) => off?.());
  }, [
    focusWidget,
    handleControllerAction,
    initialMode,
    refreshContext,
    refreshRecorderState,
  ]);

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
    const usePointerNavigation = () =>
      document.body.classList.remove("overlay-controller-navigation");
    window.addEventListener("pointerdown", usePointerNavigation);
    return () => {
      window.removeEventListener("pointerdown", usePointerNavigation);
      document.body.classList.remove(
        "overlay-window",
        "overlay-controller-navigation"
      );
    };
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
              Press <kbd>{context?.shortcut ?? "Shift+F3"}</kbd> or press the
              Guide button once to open it.
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
  const displayDurationMs =
    audioDurationMs > 0 ? audioDurationMs : (musicState?.durationMs ?? 0);
  const npProgress =
    nowPlaying && displayDurationMs > 0
      ? Math.min(100, (localProgressMs / displayDurationMs) * 100)
      : 0;
  const playbackError = localPlaybackError ?? musicState?.playbackError ?? null;

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
          <div className="overlay-header__actions">
            <div className="overlay-header__shortcut">
              <kbd>{context?.shortcut ?? "Shift+F3"}</kbd>
              <span>Close overlay</span>
            </div>
            <button
              type="button"
              className="overlay-header__button"
              onClick={resetLayout}
              aria-label="Reset widget layout"
              title="Reset widget layout"
            >
              <SyncIcon size={16} />
            </button>
            <button
              type="button"
              className={`overlay-header__button ${layoutLocked ? "is-active" : ""}`}
              onClick={() => setLayoutLocked((locked) => !locked)}
              aria-label={
                layoutLocked ? "Unlock widget layout" : "Lock widget layout"
              }
              title={
                layoutLocked ? "Unlock widget layout" : "Lock widget layout"
              }
            >
              {layoutLocked ? <LockIcon size={16} /> : <UnlockIcon size={16} />}
            </button>
            <button
              type="button"
              className="overlay-close"
              onClick={() => void window.electron.closeHydraOverlay()}
              aria-label="Close overlay"
              title="Close overlay"
            >
              <XIcon size={18} />
            </button>
          </div>
        </header>

        <div className="overlay-grid" ref={workspaceRef}>
          <div className="overlay-col overlay-col--left">
            {performanceEnabled && (
              <OverlayWidgetFrame
                widgetId="performance"
                className="overlay-card--perf"
                title="Performance"
                icon={<GraphIcon size={16} />}
                widgetStyle={getWidgetStyle("performance")}
                layoutLocked={layoutLocked}
                registerWidget={registerWidget}
                onBeginDrag={beginWidgetDrag}
                onFocus={focusWidget}
                headerActions={
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
                }
              >
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
                {performance?.captureStatus &&
                  performance.captureStatus !== "capturing" && (
                    <div
                      className={`overlay-perf__status overlay-perf__status--${performance.captureStatus}`}
                    >
                      <CircleAlert size={14} aria-hidden="true" />
                      <span>
                        {performance.captureMessage ??
                          "Waiting for performance data…"}
                      </span>
                    </div>
                  )}
              </OverlayWidgetFrame>
            )}

            <OverlayWidgetFrame
              widgetId="achievements"
              className="overlay-card--ach"
              title="Achievements"
              icon={<TrophyIcon size={16} />}
              meta={`${unlocked}/${achievements.length}`}
              widgetStyle={getWidgetStyle("achievements")}
              layoutLocked={layoutLocked}
              registerWidget={registerWidget}
              onBeginDrag={beginWidgetDrag}
              onFocus={focusWidget}
            >
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
            </OverlayWidgetFrame>
          </div>

          <div className="overlay-col overlay-col--center">
            <OverlayWidgetFrame
              widgetId="capture"
              className="overlay-card--capture"
              title="Capture"
              icon={<Video size={16} />}
              meta={
                recorderState?.status === "recording"
                  ? "Recording"
                  : recorderState?.status === "saving"
                    ? "Saving"
                    : recorderState?.configuration.instantReplayEnabled
                      ? `${Math.floor(recorderState.bufferedSeconds)}s buffered`
                      : "Instant Replay off"
              }
              widgetStyle={getWidgetStyle("capture")}
              layoutLocked={layoutLocked}
              registerWidget={registerWidget}
              onBeginDrag={beginWidgetDrag}
              onFocus={focusWidget}
            >
              <div className="overlay-capture">
                <div className="overlay-capture__status">
                  <span
                    className={`overlay-capture__dot overlay-capture__dot--${
                      recorderState?.status ?? "waiting"
                    }`}
                    aria-hidden="true"
                  />
                  <div>
                    <strong>
                      {recorderState?.status === "recording"
                        ? `Recording ${formatSessionTime(
                            recorderState.recordingStartedAt ?? Date.now()
                          )}`
                        : recorderState?.status === "buffering"
                          ? "Instant Replay is ready"
                          : recorderState?.status === "saving"
                            ? "Saving clip"
                            : recorderState?.status === "disabled"
                              ? "Capture is disabled"
                              : recorderState?.status === "error"
                                ? "Capture needs attention"
                                : "Gameplay recorder"}
                    </strong>
                    <small>
                      {recorderNotice ??
                        recorderState?.errorMessage ??
                        recorderState?.statusMessage ??
                        `${recorderState?.configuration.resolution ?? "1080p"} · ${
                          recorderState?.configuration.fps ?? 60
                        } FPS`}
                    </small>
                  </div>
                </div>

                {recorderState?.configuration.instantReplayEnabled && (
                  <div className="overlay-capture__buffer">
                    <span
                      style={{
                        width: `${Math.min(
                          100,
                          (recorderState.bufferedSeconds /
                            recorderState.configuration.replayDurationSeconds) *
                            100
                        )}%`,
                      }}
                    />
                  </div>
                )}

                <div className="overlay-capture__actions">
                  {recorderState?.status === "recording" ? (
                    <button
                      type="button"
                      className="overlay-capture__button overlay-capture__button--recording"
                      onClick={stopGameplayRecording}
                    >
                      <Square size={14} fill="currentColor" />
                      Stop & save
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="overlay-capture__button"
                      onClick={startGameplayRecording}
                      disabled={
                        !recorderState ||
                        [
                          "disabled",
                          "unavailable",
                          "waiting",
                          "saving",
                          "error",
                        ].includes(recorderState.status)
                      }
                    >
                      <Circle size={14} fill="currentColor" />
                      Record
                    </button>
                  )}

                  <button
                    type="button"
                    className="overlay-capture__button overlay-capture__button--primary"
                    data-controller-default
                    onClick={saveInstantReplay}
                    disabled={
                      !recorderState?.configuration.instantReplayEnabled ||
                      !recorderState.bufferedSeconds ||
                      recorderState.status === "saving"
                    }
                  >
                    <History size={15} />
                    Save last{" "}
                    {recorderState?.configuration.replayDurationSeconds ?? 30}s
                  </button>

                  <button
                    type="button"
                    className="overlay-capture__folder"
                    onClick={() =>
                      void window.electron.gameRecorderOpenOutputDirectory()
                    }
                    title="Open capture folder"
                    aria-label="Open capture folder"
                  >
                    <FolderOpen size={15} />
                  </button>
                </div>
              </div>
            </OverlayWidgetFrame>

            <OverlayWidgetFrame
              widgetId="music"
              className="overlay-card--music"
              title="Music"
              icon={<Music2 size={16} />}
              meta={
                musicState?.audioSource === "deezer-preview"
                  ? "30-second preview"
                  : musicState?.audioSource === "youtube"
                    ? "Full track"
                    : undefined
              }
              widgetStyle={getWidgetStyle("music")}
              layoutLocked={layoutLocked}
              registerWidget={registerWidget}
              onBeginDrag={beginWidgetDrag}
              onFocus={focusWidget}
            >
              <div
                className="overlay-music__tabs"
                role="tablist"
                aria-label="Music player views"
              >
                <button
                  id="overlay-music-tab-now-playing"
                  type="button"
                  role="tab"
                  aria-selected={musicTab === "now-playing"}
                  aria-controls="overlay-music-panel-now-playing"
                  tabIndex={musicTab === "now-playing" ? 0 : -1}
                  className={`overlay-music__tab ${musicTab === "now-playing" ? "is-active" : ""}`}
                  onClick={() => setMusicTab("now-playing")}
                >
                  <Music2 size={14} />
                  Now playing
                </button>
                <button
                  id="overlay-music-tab-search"
                  type="button"
                  role="tab"
                  aria-selected={musicTab === "search"}
                  aria-controls="overlay-music-panel-search"
                  tabIndex={musicTab === "search" ? 0 : -1}
                  className={`overlay-music__tab ${musicTab === "search" ? "is-active" : ""}`}
                  onClick={() => setMusicTab("search")}
                >
                  <SearchIcon size={14} />
                  Search
                </button>
                <button
                  id="overlay-music-tab-playlists"
                  type="button"
                  role="tab"
                  aria-selected={musicTab === "playlists"}
                  aria-controls="overlay-music-panel-playlists"
                  tabIndex={musicTab === "playlists" ? 0 : -1}
                  className={`overlay-music__tab ${musicTab === "playlists" ? "is-active" : ""}`}
                  onClick={() => setMusicTab("playlists")}
                >
                  <ListMusic size={14} />
                  Playlists
                </button>
              </div>

              {musicTab === "now-playing" && (
                <div
                  id="overlay-music-panel-now-playing"
                  className="overlay-music__np"
                  role="tabpanel"
                  aria-labelledby="overlay-music-tab-now-playing"
                >
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
                      <input
                        className="overlay-music__np-bar"
                        type="range"
                        min={0}
                        max={Math.max(1, displayDurationMs)}
                        step={250}
                        value={Math.min(localProgressMs, displayDurationMs)}
                        onChange={(event) =>
                          handleSeek(Number(event.target.value))
                        }
                        style={
                          {
                            "--track-progress": `${npProgress}%`,
                          } as CSSProperties
                        }
                        aria-label="Track position"
                      />
                      <div className="overlay-music__np-time">
                        <span>{formatDuration(localProgressMs / 1000)}</span>
                        <span>{formatDuration(displayDurationMs / 1000)}</span>
                      </div>
                      {playbackError && (
                        <div className="overlay-music__error" role="status">
                          <CircleAlert size={15} aria-hidden="true" />
                          <span>{playbackError}</span>
                          <button
                            type="button"
                            onClick={handleRetryPlayback}
                            title="Retry playback"
                          >
                            <RotateCcw size={14} />
                            Retry
                          </button>
                        </div>
                      )}
                      {!playbackError && musicState.playbackNotice && (
                        <div className="overlay-music__notice" role="status">
                          <CircleAlert size={14} aria-hidden="true" />
                          <span>{musicState.playbackNotice}</span>
                        </div>
                      )}
                      <div className="overlay-music__np-ctrls">
                        <button
                          type="button"
                          className={`overlay-music__mode ${musicState.shuffle ? "is-active" : ""}`}
                          onClick={handleShuffleToggle}
                          title={
                            musicState.shuffle
                              ? "Disable shuffle"
                              : "Enable shuffle"
                          }
                          aria-label={
                            musicState.shuffle
                              ? "Disable shuffle"
                              : "Enable shuffle"
                          }
                        >
                          <Shuffle size={17} />
                        </button>
                        <button
                          type="button"
                          onClick={handlePrevious}
                          aria-label="Previous track"
                          title="Previous track"
                        >
                          <SkipBack size={18} fill="currentColor" />
                        </button>
                        <button
                          type="button"
                          className={`overlay-music__play ${musicState.state === "resolving" ? "is-loading" : ""}`}
                          data-controller-default
                          onClick={handlePauseResume}
                          disabled={musicState.state === "resolving"}
                          aria-label={
                            musicState.state === "playing" ? "Pause" : "Play"
                          }
                        >
                          {musicState.state === "resolving" ? (
                            <span className="overlay-music__spinner" />
                          ) : musicState.state === "playing" ? (
                            <Pause size={19} fill="currentColor" />
                          ) : (
                            <Play size={19} fill="currentColor" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={handleNext}
                          aria-label="Next track"
                          title="Next track"
                        >
                          <SkipForward size={18} fill="currentColor" />
                        </button>
                        <button
                          type="button"
                          onClick={handleStop}
                          aria-label="Stop"
                          title="Stop"
                        >
                          <Square size={16} fill="currentColor" />
                        </button>
                        <button
                          type="button"
                          className={`overlay-music__mode ${musicState.repeat !== "none" ? "is-active" : ""}`}
                          onClick={handleRepeatCycle}
                          title={`Repeat: ${musicState.repeat}`}
                          aria-label={`Repeat: ${musicState.repeat}`}
                        >
                          {musicState.repeat === "one" ? (
                            <Repeat1 size={17} />
                          ) : (
                            <Repeat size={17} />
                          )}
                        </button>
                        <div className="overlay-music__volume">
                          <button
                            type="button"
                            onClick={() => setPlayerMuted((muted) => !muted)}
                            aria-label={
                              playerMuted ? "Unmute music" : "Mute music"
                            }
                            title={playerMuted ? "Unmute music" : "Mute music"}
                          >
                            {playerMuted || playerVolume === 0 ? (
                              <MuteIcon size={16} />
                            ) : (
                              <UnmuteIcon size={16} />
                            )}
                          </button>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            value={Math.round(playerVolume * 100)}
                            onChange={(event) => {
                              const nextVolume =
                                Number(event.target.value) / 100;
                              setPlayerVolume(nextVolume);
                              if (nextVolume > 0) setPlayerMuted(false);
                            }}
                            aria-label="Music volume"
                          />
                        </div>
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
                              <TrashIcon size={12} />
                              Clear
                            </button>
                          </div>
                          <ul className="overlay-music__queue-list">
                            {musicState.queue.map((track, i) => (
                              <li
                                key={`${track.id}-${i}`}
                                className={`overlay-music__queue-item ${i === musicState.currentIndex ? "is-current" : ""}`}
                              >
                                <button
                                  type="button"
                                  className="overlay-music__queue-main"
                                  onClick={() => handlePlayQueueIndex(i)}
                                  aria-label={`Play ${track.title}`}
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
                                </button>
                                <button
                                  type="button"
                                  className="overlay-music__queue-rm"
                                  onClick={() => handleRemoveFromQueue(i)}
                                  aria-label="Remove from queue"
                                >
                                  <XIcon size={12} />
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
                <div
                  id="overlay-music-panel-search"
                  className="overlay-music__search"
                  role="tabpanel"
                  aria-labelledby="overlay-music-tab-search"
                >
                  <label className="overlay-music__search-field">
                    <SearchIcon size={16} aria-hidden="true" />
                    <input
                      className="overlay-music__search-input"
                      type="text"
                      placeholder="Search tracks and artists"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                    />
                  </label>
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
                                className="overlay-music__search-play"
                                onClick={() => handlePlayTrack(track)}
                                title={`Play ${track.title}`}
                              >
                                <Play size={13} fill="currentColor" />
                                Play
                              </button>
                              <button
                                type="button"
                                className="overlay-music__search-add"
                                onClick={() => handleAddToQueue(track)}
                                title="Add to queue"
                              >
                                <PlusIcon size={13} />
                                Queue
                              </button>
                              <div className="overlay-music__search-plist">
                                <button
                                  type="button"
                                  className="overlay-music__search-plist-btn"
                                  title="Add to playlist"
                                  aria-label="Add to playlist"
                                  aria-expanded={
                                    playlistMenuTrackId === track.id
                                  }
                                  onClick={() =>
                                    setPlaylistMenuTrackId((current) =>
                                      current === track.id ? null : track.id
                                    )
                                  }
                                >
                                  <ListMusic size={14} />
                                </button>
                                {playlistMenuTrackId === track.id && (
                                  <div className="overlay-music__search-plist-drop">
                                    {playlists.length > 0 ? (
                                      playlists.map((pl) => (
                                        <button
                                          key={pl.id}
                                          type="button"
                                          onClick={() => {
                                            handleAddToPlaylist(pl.id, track);
                                            setPlaylistMenuTrackId(null);
                                          }}
                                        >
                                          <PlusIcon size={12} />
                                          {pl.name}
                                        </button>
                                      ))
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setMusicTab("playlists");
                                          setCreatingPlaylist(true);
                                          setPlaylistMenuTrackId(null);
                                        }}
                                      >
                                        <PlusIcon size={12} />
                                        Create a playlist
                                      </button>
                                    )}
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
                <div
                  id="overlay-music-panel-playlists"
                  className="overlay-music__playlists"
                  role="tabpanel"
                  aria-labelledby="overlay-music-tab-playlists"
                >
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
                      <PlusIcon size={14} />
                      New playlist
                    </button>
                  )}
                  {playlists.length > 0 ? (
                    <ul className="overlay-music__plist-list">
                      {playlists.map((pl) => (
                        <li key={pl.id} className="overlay-music__plist-item">
                          <div className="overlay-music__plist-row">
                            <button
                              type="button"
                              className="overlay-music__plist-info"
                              onClick={() =>
                                setExpandedPlaylistId((current) =>
                                  current === pl.id ? null : pl.id
                                )
                              }
                              aria-expanded={expandedPlaylistId === pl.id}
                            >
                              <span className="overlay-music__plist-name">
                                {pl.name}
                              </span>
                              <span className="overlay-music__plist-count">
                                {pl.tracks.length} tracks
                              </span>
                            </button>
                            <div className="overlay-music__plist-actions">
                              <button
                                type="button"
                                className="overlay-music__plist-play"
                                onClick={() => handlePlayPlaylist(pl.id)}
                                aria-label={`Play ${pl.name}`}
                                disabled={pl.tracks.length === 0}
                              >
                                <Play size={13} fill="currentColor" />
                              </button>
                              <button
                                type="button"
                                className="overlay-music__plist-del"
                                onClick={() => handleDeletePlaylist(pl.id)}
                                aria-label={`Delete ${pl.name}`}
                              >
                                <TrashIcon size={13} />
                              </button>
                            </div>
                          </div>
                          {expandedPlaylistId === pl.id && (
                            <div className="overlay-music__plist-tracks">
                              {pl.tracks.length > 0 ? (
                                pl.tracks.map((track, index) => (
                                  <div
                                    key={`${track.id}-${index}`}
                                    className="overlay-music__plist-track"
                                  >
                                    <button
                                      type="button"
                                      className="overlay-music__plist-track-main"
                                      onClick={() => {
                                        window.electron
                                          .musicPlayPlaylist(pl.id, index)
                                          .then(() => {
                                            setMusicTab("now-playing");
                                            refreshMusicState();
                                          })
                                          .catch(() => undefined);
                                      }}
                                    >
                                      <span className="overlay-music__plist-track-idx">
                                        {index + 1}
                                      </span>
                                      <span className="overlay-music__plist-track-title">
                                        {track.title}
                                      </span>
                                      <span className="overlay-music__plist-track-artist">
                                        {track.artist}
                                      </span>
                                    </button>
                                    <button
                                      type="button"
                                      className="overlay-music__plist-track-remove"
                                      onClick={() =>
                                        handleRemoveFromPlaylist(pl.id, index)
                                      }
                                      aria-label={`Remove ${track.title} from ${pl.name}`}
                                    >
                                      <XIcon size={12} />
                                    </button>
                                  </div>
                                ))
                              ) : (
                                <p className="overlay-ach__empty">
                                  Add tracks from Search.
                                </p>
                              )}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="overlay-ach__empty">
                      No playlists yet. Create one to save your favorite tracks.
                    </p>
                  )}
                </div>
              )}
            </OverlayWidgetFrame>
          </div>

          <div className="overlay-col overlay-col--right">
            {context?.user && friends.length > 0 && (
              <OverlayWidgetFrame
                widgetId="friends"
                className="overlay-card--friends"
                title="Friends"
                icon={<PeopleIcon size={16} />}
                meta={`${friends.filter((friend) => friend.isOnline).length} online`}
                widgetStyle={getWidgetStyle("friends")}
                layoutLocked={layoutLocked}
                registerWidget={registerWidget}
                onBeginDrag={beginWidgetDrag}
                onFocus={focusWidget}
              >
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
              </OverlayWidgetFrame>
            )}

            {audioSessions.length > 0 && (
              <OverlayWidgetFrame
                widgetId="mixer"
                className="overlay-card--mixer"
                title="Volume mixer"
                icon={<UnmuteIcon size={16} />}
                meta={audioSessions.length}
                widgetStyle={getWidgetStyle("mixer")}
                layoutLocked={layoutLocked}
                registerWidget={registerWidget}
                onBeginDrag={beginWidgetDrag}
                onFocus={focusWidget}
              >
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
                          <MuteIcon size={16} />
                        ) : (
                          <UnmuteIcon size={16} />
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
              </OverlayWidgetFrame>
            )}

            <OverlayWidgetFrame
              widgetId="quick-launch"
              className="overlay-card--pins"
              title="Quick launch"
              icon={<AppsIcon size={16} />}
              meta={pinnedApps.length}
              widgetStyle={getWidgetStyle("quick-launch")}
              layoutLocked={layoutLocked}
              registerWidget={registerWidget}
              onBeginDrag={beginWidgetDrag}
              onFocus={focusWidget}
            >
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
                    <span
                      className="overlay-pin-tile__glyph"
                      aria-hidden="true"
                    >
                      <PinIcon size={17} />
                    </span>
                    <span className="overlay-pin-tile__label">{app.name}</span>
                  </button>
                ))}
                <button
                  type="button"
                  className="overlay-pin-tile overlay-pin-tile--add"
                  onClick={pinApp}
                >
                  <span className="overlay-pin-tile__glyph" aria-hidden="true">
                    <PlusIcon size={18} />
                  </span>
                  <span className="overlay-pin-tile__label">Pin app</span>
                </button>
              </div>
            </OverlayWidgetFrame>

            <OverlayWidgetFrame
              widgetId="notes"
              className="overlay-card--notes"
              title="Notes"
              icon={<NoteIcon size={16} />}
              meta={noteSaved ? "Saved" : "Saving…"}
              widgetStyle={getWidgetStyle("notes")}
              layoutLocked={layoutLocked}
              registerWidget={registerWidget}
              onBeginDrag={beginWidgetDrag}
              onFocus={focusWidget}
            >
              <textarea
                className="overlay-notes"
                value={note}
                placeholder="Jot down a code, a boss strategy, where you left off…"
                onChange={(event) => handleNoteChange(event.target.value)}
              />
            </OverlayWidgetFrame>
          </div>
        </div>

        <audio ref={audioRef} preload="none">
          <track kind="captions" />
        </audio>
        <footer className="overlay-foot">
          Press <kbd>{context?.shortcut ?? "Shift+F3"}</kbd> or{" "}
          <kbd>{context?.controllerShortcut ?? "Guide"}</kbd> once to close
        </footer>
      </div>
    </div>
  );
}
