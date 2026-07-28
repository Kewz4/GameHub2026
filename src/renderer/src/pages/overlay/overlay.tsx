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
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Circle,
  Clock3,
  EyeOff,
  FolderOpen,
  History,
  LayoutGrid,
  ListMusic,
  Music2,
  Pause,
  PlayCircle,
  Play,
  Power,
  Repeat,
  Repeat1,
  RotateCcw,
  Shuffle,
  SlidersHorizontal,
  SkipBack,
  SkipForward,
  Square,
  Video,
} from "lucide-react";
import type {
  AudioSession,
  GameRecorderState,
  GameProcessControlState,
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
import { useAppSelector } from "@renderer/hooks";
import { OverlayWidgetFrame } from "./overlay-widget-frame";
import { OverlaySelect } from "./overlay-select";
import { SpotifyOverlayPanel } from "./spotify-overlay-panel";
import {
  OVERLAY_WIDGET_IDS,
  type OverlayWidgetId,
  useOverlayLayout,
} from "./use-overlay-layout";
import "./overlay.scss";

type OverlayMode = "hidden" | "toast" | "pinned" | "full";
type MusicTab = "now-playing" | "search" | "playlists";
type AchievementFilter = "all" | "unlocked" | "locked" | "hidden" | "missable";

const WIDGET_LABELS: Record<OverlayWidgetId, string> = {
  performance: "Performance",
  achievements: "Achievements",
  capture: "Capture",
  music: "Music",
  friends: "Friends",
  mixer: "Volume mixer",
  "quick-launch": "Quick launch",
  notes: "Notes",
};

const formatSessionTime = (startedAt: number) => {
  if (!startedAt) return "0:00";
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
};

const padClockPart = (value: number) => String(value).padStart(2, "0");

const OverlayLocalClock = () => {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timeoutId: number | undefined;

    const scheduleNextMinute = () => {
      const currentTime = Date.now();
      const delay = 60_000 - (currentTime % 60_000) + 50;
      timeoutId = window.setTimeout(tick, delay);
    };
    const tick = () => {
      setNow(new Date());
      scheduleNextMinute();
    };
    const refresh = () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      tick();
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };

    scheduleNextMinute();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  const clockText = now.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const shortDateText = now.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const longDateText = now.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const machineTime = `${padClockPart(now.getHours())}:${padClockPart(now.getMinutes())}`;
  const machineDate = [
    now.getFullYear(),
    padClockPart(now.getMonth() + 1),
    padClockPart(now.getDate()),
  ].join("-");

  return (
    <div
      className="overlay-header__clock"
      role="group"
      aria-label="Local date and time"
    >
      <div className="overlay-header__clock-row">
        <Clock3 size={12} aria-hidden="true" focusable="false" />
        <time dateTime={machineTime} aria-label={`Local time: ${clockText}`}>
          {clockText}
        </time>
      </div>
      <div className="overlay-header__clock-row overlay-header__clock-row--date">
        <CalendarDays size={12} aria-hidden="true" focusable="false" />
        <time
          dateTime={machineDate}
          aria-label={`Today's date: ${longDateText}`}
        >
          {shortDateText}
        </time>
      </div>
    </div>
  );
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
  "[data-controller-item]",
].join(",");

const registerControllerItem = (element: HTMLElement | null) => {
  if (element) element.tabIndex = -1;
};

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

const adjustControllerSelect = (
  select: HTMLSelectElement,
  direction: "previous" | "next"
) => {
  const enabledOptions = Array.from(select.options).filter(
    (option) => !option.disabled
  );
  const currentIndex = enabledOptions.findIndex(
    (option) => option.value === select.value
  );
  const offset = direction === "next" ? 1 : -1;
  const next =
    enabledOptions[
      Math.min(enabledOptions.length - 1, Math.max(0, currentIndex + offset))
    ];
  if (!next || next.value === select.value) return;
  select.value = next.value;
  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
};

export default function Overlay() {
  const location = useLocation();
  const musicProvider =
    useAppSelector((state) => state.userPreferences.value?.musicProvider) ??
    "gamehub";
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
  const [gameProcessState, setGameProcessState] =
    useState<GameProcessControlState | null>(null);
  const [gameProcessBusy, setGameProcessBusy] = useState(false);
  const [recorderNotice, setRecorderNotice] = useState<string | null>(null);
  const [widgetMenuOpen, setWidgetMenuOpen] = useState(false);
  const [achievementFilter, setAchievementFilter] =
    useState<AchievementFilter>("all");
  const [expandedMixerPid, setExpandedMixerPid] = useState<number | null>(null);
  const controllerRangeEditRef = useRef<HTMLInputElement | null>(null);
  const controllerSelectEditRef = useRef<HTMLSelectElement | null>(null);
  const rendererReadySentRef = useRef(false);
  const contextRequestIdRef = useRef(0);
  const draggingPidRef = useRef<number | null>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const {
    beginWidgetDrag,
    beginWidgetResize,
    cycleWidgetSize,
    focusWidget,
    getWidgetStyle,
    isWidgetVisible,
    layoutLocked,
    registerWidget,
    resetLayout,
    setLayoutLocked,
    setWidgetVisible,
  } = useOverlayLayout(workspaceRef);

  const widgetFrameProps = {
    layoutLocked,
    registerWidget,
    onBeginDrag: beginWidgetDrag,
    onBeginResize: beginWidgetResize,
    onCycleSize: cycleWidgetSize,
    onFocus: focusWidget,
    onHide: (id: OverlayWidgetId) => setWidgetVisible(id, false),
  };

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
  const [musicVolumeOpen, setMusicVolumeOpen] = useState(false);
  const [localPlaybackError, setLocalPlaybackError] = useState<string | null>(
    null
  );
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

  // The launcher owns the persistent audio elements. The overlay only consumes
  // pushed state and sends controls, avoiding duplicate playback windows.
  useEffect(() => {
    if (mode !== "full") return;
    refreshMusicState();
    refreshPlaylists();
    return window.electron.onMusicState(setMusicState);
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
    setLocalPlaybackError(null);
    setMusicState((current) =>
      current ? { ...current, state: "resolving" } : current
    );
    window.electron
      .musicRefreshCurrent()
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
  }, []);

  const handleSeek = useCallback(
    (progressMs: number) => {
      const nextProgressMs = Math.min(
        musicState?.durationMs ?? progressMs,
        Math.max(0, progressMs)
      );
      setMusicState((current) =>
        current ? { ...current, progressMs: nextProgressMs } : current
      );
      void window.electron.musicSeek(nextProgressMs);
    },
    [musicState?.durationMs]
  );

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
  const refreshContext = useCallback(async () => {
    const requestId = ++contextRequestIdRef.current;
    rendererReadySentRef.current = false;
    try {
      const next = await window.electron.getOverlayContext();
      if (requestId !== contextRequestIdRef.current || !next) return false;
      setContext(next);
      setPerformance(next.performance);
      return true;
    } catch {
      return false;
    }
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

  const updateReplayDuration = useCallback(
    (seconds: 15 | 30 | 45 | 60) => {
      setRecorderState((current) =>
        current
          ? {
              ...current,
              configuration: {
                ...current.configuration,
                replayDurationSeconds: seconds,
              },
            }
          : current
      );
      void window.electron
        .updateUserPreferences({
          gameRecorderReplayDurationSeconds: seconds,
        })
        .then(refreshRecorderState)
        .catch(() =>
          setRecorderNotice("Could not update the Instant Replay length.")
        );
    },
    [refreshRecorderState]
  );

  const toggleGamePaused = useCallback(() => {
    if (!gameProcessState || gameProcessBusy) return;
    const action =
      gameProcessState.status === "paused"
        ? window.electron.resumeActiveGame()
        : window.electron.pauseActiveGame();
    setGameProcessBusy(true);
    void action
      .then(setGameProcessState)
      .finally(() => setGameProcessBusy(false));
  }, [gameProcessBusy, gameProcessState]);

  const closeActiveGame = useCallback(() => {
    if (!gameProcessState?.canClose || gameProcessBusy) return;
    setGameProcessBusy(true);
    void window.electron
      .closeActiveGame()
      .then(setGameProcessState)
      .finally(() => setGameProcessBusy(false));
  }, [gameProcessBusy, gameProcessState?.canClose]);

  const stopControllerRangeEdit = useCallback(() => {
    controllerRangeEditRef.current?.removeAttribute("data-controller-editing");
    controllerRangeEditRef.current = null;
    controllerSelectEditRef.current?.removeAttribute("data-controller-editing");
    controllerSelectEditRef.current = null;
  }, []);

  const handleControllerAction = useCallback(
    (action: HydraOverlayGamepadAction) => {
      if (action === "back") {
        if (controllerRangeEditRef.current || controllerSelectEditRef.current) {
          stopControllerRangeEdit();
          return;
        }
        if (widgetMenuOpen) {
          setWidgetMenuOpen(false);
          return;
        }
        if (musicVolumeOpen) {
          setMusicVolumeOpen(false);
          return;
        }
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
          document.querySelectorAll<HTMLButtonElement>(
            ".overlay-music__tab, .spotify-overlay-panel__tab"
          )
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
        if (active instanceof HTMLInputElement && active.type === "range") {
          if (controllerRangeEditRef.current === active) {
            stopControllerRangeEdit();
          } else {
            stopControllerRangeEdit();
            controllerRangeEditRef.current = active;
            active.setAttribute("data-controller-editing", "true");
          }
          return;
        }
        if (active instanceof HTMLSelectElement) {
          if (controllerSelectEditRef.current === active) {
            stopControllerRangeEdit();
          } else {
            stopControllerRangeEdit();
            controllerSelectEditRef.current = active;
            active.setAttribute("data-controller-editing", "true");
          }
          return;
        }
        if (
          active instanceof HTMLButtonElement ||
          (active instanceof HTMLInputElement &&
            ["button", "checkbox", "radio", "submit"].includes(active.type))
        ) {
          active.click();
        }
        return;
      }

      if (
        active instanceof HTMLInputElement &&
        active.type === "range" &&
        controllerRangeEditRef.current === active &&
        (action === "left" || action === "right")
      ) {
        adjustControllerRange(active, action);
        return;
      }

      if (
        active instanceof HTMLSelectElement &&
        controllerSelectEditRef.current === active
      ) {
        adjustControllerSelect(
          active,
          action === "left" || action === "up" ? "previous" : "next"
        );
        return;
      }

      stopControllerRangeEdit();
      moveControllerFocus(action, focusWidget);
    },
    [
      creatingPlaylist,
      expandedPlaylistId,
      focusWidget,
      musicVolumeOpen,
      playlistMenuTrackId,
      stopControllerRangeEdit,
      widgetMenuOpen,
    ]
  );

  useEffect(() => {
    if (mode !== "full") return;
    let active = true;
    void window.electron
      .getActiveGameProcessState()
      .then((state) => active && setGameProcessState(state))
      .catch(() => undefined);
    const unsubscribe = window.electron.onGameProcessControlState((state) => {
      if (active) setGameProcessState(state);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [mode]);

  useEffect(() => {
    void refreshContext();
    refreshRecorderState();
    window.electron
      .getOverlayNote()
      .then(setNote)
      .catch(() => undefined);

    const unsubscribers = [
      window.electron.onOverlayMode((next) => setMode(next as OverlayMode)),
      window.electron.onOverlayShown(() => {
        void refreshContext().then((loaded) => {
          if (!loaded || initialMode !== "full") return;
          setMode("full");
          window.requestAnimationFrame(() => {
            document.body.classList.add("overlay-controller-navigation");
            focusControllerDefault(focusWidget);
          });
        });
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

  useEffect(() => {
    if (
      initialMode !== "full" ||
      mode !== "full" ||
      !context ||
      rendererReadySentRef.current
    ) {
      return;
    }

    const requestId = contextRequestIdRef.current;
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        if (requestId !== contextRequestIdRef.current) return;
        rendererReadySentRef.current = true;
        void window.electron.overlayRendererReady();
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    };
  }, [context, initialMode, mode]);

  const [, forceTick] = useState(0);
  useEffect(() => {
    if (mode === "hidden") return;
    const id = setInterval(() => forceTick((value) => value + 1), 1000);
    return () => clearInterval(id);
  }, [mode]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (controllerRangeEditRef.current) {
        stopControllerRangeEdit();
      } else if (widgetMenuOpen) {
        setWidgetMenuOpen(false);
      } else if (musicVolumeOpen) {
        setMusicVolumeOpen(false);
      } else {
        void window.electron.closeHydraOverlay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [musicVolumeOpen, stopControllerRangeEdit, widgetMenuOpen]);

  useEffect(() => {
    document.body.classList.add("overlay-window");
    const usePointerNavigation = () => {
      document.body.classList.remove("overlay-controller-navigation");
      stopControllerRangeEdit();
    };
    window.addEventListener("pointerdown", usePointerNavigation);
    return () => {
      window.removeEventListener("pointerdown", usePointerNavigation);
      document.body.classList.remove(
        "overlay-window",
        "overlay-controller-navigation"
      );
    };
  }, [stopControllerRangeEdit]);

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
          params: { take: 100, skip: 0 },
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
          <div className="overlay-toast__body">
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
  const filteredAchievements = achievements.filter((achievement) => {
    if (achievementFilter === "unlocked") return achievement.unlocked;
    if (achievementFilter === "locked") return !achievement.unlocked;
    if (achievementFilter === "hidden") return achievement.hidden;
    if (achievementFilter === "missable") return achievement.missable;
    return true;
  });

  const nowPlaying = musicState?.nowPlaying;
  const displayDurationMs = musicState?.durationMs ?? 0;
  const localProgressMs = musicState?.progressMs ?? 0;
  const playerVolume = musicState?.volume ?? 0.8;
  const playerMuted = musicState?.muted ?? false;
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
            <div className="overlay-header__identity">
              <h1 className="overlay-header__title">
                {game?.title ?? "In-game overlay"}
              </h1>
              <p className="overlay-header__meta">
                {game ? formatSessionTime(game.sessionStartedAt) : ""} this
                session
                {context?.user ? ` · ${context.user.displayName}` : ""}
              </p>
            </div>
            <OverlayLocalClock />
          </div>
          <div className="overlay-header__actions">
            <div className="overlay-header__shortcut">
              <kbd>{context?.shortcut ?? "Shift+F3"}</kbd>
              <span>Close overlay</span>
            </div>
            {(gameProcessState?.canPause ||
              gameProcessState?.canResume ||
              gameProcessState?.canClose) && (
              <div
                className="overlay-header__process"
                aria-label="Game process controls"
              >
                <button
                  type="button"
                  className="overlay-header__process-button"
                  onClick={toggleGamePaused}
                  disabled={
                    gameProcessBusy ||
                    (!gameProcessState.canPause && !gameProcessState.canResume)
                  }
                  title={
                    gameProcessState.status === "paused"
                      ? "Resume game"
                      : "Pause game"
                  }
                  aria-label={
                    gameProcessState.status === "paused"
                      ? "Resume game"
                      : "Pause game"
                  }
                >
                  {gameProcessState.status === "paused" ? (
                    <PlayCircle size={16} />
                  ) : (
                    <Pause size={16} />
                  )}
                  <span>
                    {gameProcessState.status === "paused" ? "Resume" : "Pause"}
                  </span>
                </button>
                <button
                  type="button"
                  className="overlay-header__process-button overlay-header__process-button--danger"
                  onClick={closeActiveGame}
                  disabled={gameProcessBusy || !gameProcessState.canClose}
                  title="Close game"
                  aria-label="Close game"
                >
                  <Power size={15} />
                  <span>Close game</span>
                </button>
              </div>
            )}
            <div className="overlay-widget-menu-wrap">
              <button
                type="button"
                className={`overlay-header__widget-button ${widgetMenuOpen ? "is-active" : ""}`}
                onClick={() => setWidgetMenuOpen((open) => !open)}
                aria-expanded={widgetMenuOpen}
                aria-controls="overlay-widget-menu"
              >
                <LayoutGrid size={16} />
                <span>Widgets</span>
                <ChevronDown size={13} />
              </button>
              {widgetMenuOpen && (
                <div
                  id="overlay-widget-menu"
                  className="overlay-widget-menu"
                  role="group"
                  aria-label="Show or hide overlay widgets"
                >
                  <div className="overlay-widget-menu__heading">
                    <strong>Overlay widgets</strong>
                    <small>Choose what appears in game</small>
                  </div>
                  {OVERLAY_WIDGET_IDS.map((widgetId) => {
                    const unavailable =
                      widgetId === "performance" && !performanceEnabled;
                    return (
                      <label
                        key={widgetId}
                        className={unavailable ? "is-disabled" : ""}
                      >
                        <input
                          type="checkbox"
                          checked={isWidgetVisible(widgetId) && !unavailable}
                          disabled={unavailable}
                          onChange={(event) =>
                            setWidgetVisible(widgetId, event.target.checked)
                          }
                        />
                        <span>{WIDGET_LABELS[widgetId]}</span>
                        {unavailable && <small>Disabled in settings</small>}
                      </label>
                    );
                  })}
                  <button
                    type="button"
                    className="overlay-widget-menu__reset"
                    onClick={resetLayout}
                  >
                    <SyncIcon size={14} />
                    Restore default layout
                  </button>
                </div>
              )}
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
            {performanceEnabled && isWidgetVisible("performance") && (
              <OverlayWidgetFrame
                widgetId="performance"
                className="overlay-card--perf"
                title="Performance"
                icon={<GraphIcon size={16} />}
                widgetStyle={getWidgetStyle("performance")}
                {...widgetFrameProps}
                headerActions={
                  <label
                    className="overlay-pin"
                    title={
                      context?.performancePinned
                        ? "Unpin performance HUD"
                        : "Pin performance HUD"
                    }
                  >
                    <input
                      type="checkbox"
                      aria-label="Pin performance HUD"
                      checked={context?.performancePinned ?? false}
                      onChange={(event) =>
                        void window.electron.setOverlayPerformancePinned(
                          event.target.checked
                        )
                      }
                    />
                    <span>Pin HUD</span>
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

            {isWidgetVisible("achievements") && (
              <OverlayWidgetFrame
                widgetId="achievements"
                className="overlay-card--ach"
                title="Achievements"
                icon={<TrophyIcon size={16} />}
                meta={`${unlocked}/${achievements.length}`}
                widgetStyle={getWidgetStyle("achievements")}
                {...widgetFrameProps}
              >
                <div
                  className="overlay-ach__filters"
                  role="group"
                  aria-label="Filter achievements"
                >
                  {(
                    [
                      ["all", "All"],
                      ["unlocked", "Unlocked"],
                      ["locked", "Locked"],
                      ["hidden", "Hidden"],
                      ["missable", "Missable"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={achievementFilter === value ? "is-active" : ""}
                      aria-pressed={achievementFilter === value}
                      onClick={() => setAchievementFilter(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <ul className="overlay-ach">
                  {filteredAchievements.map((achievement) => (
                    <li
                      key={achievement.name}
                      ref={registerControllerItem}
                      data-controller-item
                      className={`overlay-ach__item ${
                        achievement.unlocked ? "is-unlocked" : ""
                      } ${achievement.hidden ? "is-hidden" : ""}`}
                    >
                      <img
                        src={
                          achievement.unlocked
                            ? achievement.icon
                            : achievement.icongray || achievement.icon
                        }
                        alt=""
                        loading="lazy"
                      />
                      <div className="overlay-ach__body">
                        <p>{achievement.displayName}</p>
                        <small>
                          {achievement.description ||
                            (achievement.hidden
                              ? "Hidden achievement"
                              : "No description available")}
                        </small>
                        <span className="overlay-ach__badges">
                          {achievement.unlocked ? (
                            <em className="is-unlocked">
                              <CheckCircle2 size={11} />
                              Unlocked
                            </em>
                          ) : (
                            <em>Locked</em>
                          )}
                          {achievement.hidden && (
                            <em>
                              <EyeOff size={11} />
                              Hidden
                            </em>
                          )}
                          {achievement.missable && (
                            <em className="is-missable">
                              <AlertTriangle size={11} />
                              Missable
                            </em>
                          )}
                        </span>
                      </div>
                    </li>
                  ))}
                  {filteredAchievements.length === 0 && (
                    <li className="overlay-ach__empty">
                      {achievements.length === 0
                        ? "No achievements tracked for this game."
                        : "No achievements match this filter."}
                    </li>
                  )}
                </ul>
              </OverlayWidgetFrame>
            )}
          </div>

          <div className="overlay-col overlay-col--center">
            {isWidgetVisible("capture") && (
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
                {...widgetFrameProps}
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
                    <div className="overlay-capture__replay">
                      <div className="overlay-capture__replay-length">
                        <span>Instant Replay length</span>
                        <OverlaySelect
                          ariaLabel="Instant Replay length"
                          value={
                            recorderState.configuration.replayDurationSeconds
                          }
                          onChange={(seconds) =>
                            updateReplayDuration(seconds as 15 | 30 | 45 | 60)
                          }
                          options={[
                            { value: 15, label: "Last 15 seconds" },
                            { value: 30, label: "Last 30 seconds" },
                            { value: 45, label: "Last 45 seconds" },
                            { value: 60, label: "Last 60 seconds" },
                          ]}
                        />
                      </div>
                      <div className="overlay-capture__buffer">
                        <span
                          style={{
                            width: `${Math.min(
                              100,
                              (recorderState.bufferedSeconds /
                                recorderState.configuration
                                  .replayDurationSeconds) *
                                100
                            )}%`,
                          }}
                        />
                      </div>
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
                      {recorderState?.configuration.replayDurationSeconds ?? 30}
                      s
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
            )}

            {isWidgetVisible("music") && (
              <OverlayWidgetFrame
                widgetId="music"
                className="overlay-card--music"
                title="Music"
                icon={<Music2 size={16} />}
                meta={
                  musicProvider === "spotify"
                    ? "Spotify Connect"
                    : musicState?.audioSource === "deezer-preview"
                      ? "30-second preview"
                      : musicState?.audioSource === "youtube"
                        ? "Full track"
                        : undefined
                }
                widgetStyle={getWidgetStyle("music")}
                {...widgetFrameProps}
              >
                {musicProvider === "spotify" ? (
                  <SpotifyOverlayPanel
                    isActive={mode === "full"}
                    onOpenSettings={() =>
                      void window.electron.spotifyOpenSettings()
                    }
                  />
                ) : (
                  <>
                    <div
                      className="overlay-music__tabs"
                      role="tablist"
                      aria-label="Music player views"
                    >
                      <span
                        className="overlay-tab-bumper overlay-tab-bumper--left"
                        aria-hidden="true"
                        title="Previous tab (LB)"
                      >
                        LB
                      </span>
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
                      <span
                        className="overlay-tab-bumper overlay-tab-bumper--right"
                        aria-hidden="true"
                        title="Next tab (RB)"
                      >
                        RB
                      </span>
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
                              value={Math.min(
                                localProgressMs,
                                displayDurationMs
                              )}
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
                              <span>
                                {formatDuration(localProgressMs / 1000)}
                              </span>
                              <span>
                                {formatDuration(displayDurationMs / 1000)}
                              </span>
                            </div>
                            {playbackError && (
                              <div
                                className="overlay-music__error"
                                role="status"
                              >
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
                              <div
                                className="overlay-music__notice"
                                role="status"
                              >
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
                                  musicState.state === "playing"
                                    ? "Pause"
                                    : "Play"
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
                              <div
                                className={`overlay-music__volume ${musicVolumeOpen ? "is-open" : ""}`}
                              >
                                <button
                                  type="button"
                                  className="overlay-music__volume-trigger"
                                  onClick={() =>
                                    setMusicVolumeOpen((open) => !open)
                                  }
                                  aria-expanded={musicVolumeOpen}
                                  aria-controls="overlay-music-volume-controls"
                                  aria-label="Adjust music volume"
                                  title="Adjust music volume"
                                >
                                  {playerMuted || playerVolume === 0 ? (
                                    <MuteIcon size={16} />
                                  ) : (
                                    <UnmuteIcon size={16} />
                                  )}
                                  <span>
                                    {playerMuted
                                      ? "Muted"
                                      : `${Math.round(playerVolume * 100)}%`}
                                  </span>
                                </button>
                                {musicVolumeOpen && (
                                  <div
                                    id="overlay-music-volume-controls"
                                    className="overlay-music__volume-panel"
                                  >
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setMusicState((current) =>
                                          current
                                            ? {
                                                ...current,
                                                muted: !playerMuted,
                                              }
                                            : current
                                        );
                                        void window.electron.musicSetVolume(
                                          playerVolume,
                                          !playerMuted
                                        );
                                      }}
                                      aria-label={
                                        playerMuted
                                          ? "Unmute music"
                                          : "Mute music"
                                      }
                                      title={
                                        playerMuted
                                          ? "Unmute music"
                                          : "Mute music"
                                      }
                                    >
                                      {playerMuted ? (
                                        <MuteIcon size={15} />
                                      ) : (
                                        <UnmuteIcon size={15} />
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
                                        setMusicState((current) =>
                                          current
                                            ? {
                                                ...current,
                                                volume: nextVolume,
                                                muted:
                                                  nextVolume > 0
                                                    ? false
                                                    : current.muted,
                                              }
                                            : current
                                        );
                                        void window.electron.musicSetVolume(
                                          nextVolume,
                                          nextVolume > 0 ? false : playerMuted
                                        );
                                      }}
                                      aria-label="Music volume. Press Select to adjust, then Select again when done."
                                    />
                                  </div>
                                )}
                              </div>
                            </div>
                            {musicState.queue.length > 0 && (
                              <div className="overlay-music__queue">
                                <div className="overlay-music__queue-head">
                                  <span>
                                    Up next ({musicState.queue.length})
                                  </span>
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
                            onChange={(event) =>
                              setSearchQuery(event.target.value)
                            }
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
                                            current === track.id
                                              ? null
                                              : track.id
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
                                                  handleAddToPlaylist(
                                                    pl.id,
                                                    track
                                                  );
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
                            <p className="overlay-ach__empty">
                              No results found.
                            </p>
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
                                if (event.key === "Enter")
                                  handleCreatePlaylist();
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
                              <li
                                key={pl.id}
                                className="overlay-music__plist-item"
                              >
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
                                      onClick={() =>
                                        handleDeletePlaylist(pl.id)
                                      }
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
                                              handleRemoveFromPlaylist(
                                                pl.id,
                                                index
                                              )
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
                            No playlists yet. Create one to save your favorite
                            tracks.
                          </p>
                        )}
                      </div>
                    )}
                  </>
                )}
              </OverlayWidgetFrame>
            )}
          </div>

          <div className="overlay-col overlay-col--right">
            {isWidgetVisible("friends") && (
              <OverlayWidgetFrame
                widgetId="friends"
                className="overlay-card--friends"
                title="Friends"
                icon={<PeopleIcon size={16} />}
                meta={
                  context?.user
                    ? `${friends.filter((friend) => friend.isOnline).length} online`
                    : "Sign in required"
                }
                widgetStyle={getWidgetStyle("friends")}
                {...widgetFrameProps}
              >
                <ul className="overlay-friends">
                  {friends.map((friend) => (
                    <li
                      key={friend.id}
                      ref={registerControllerItem}
                      className="overlay-friend"
                      data-controller-item
                    >
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
                  {!context?.user && (
                    <li className="overlay-ach__empty">
                      Sign in to GameHub to see friend activity.
                    </li>
                  )}
                  {context?.user && friends.length === 0 && (
                    <li className="overlay-ach__empty">
                      No friends are available right now.
                    </li>
                  )}
                </ul>
              </OverlayWidgetFrame>
            )}

            {isWidgetVisible("mixer") && (
              <OverlayWidgetFrame
                widgetId="mixer"
                className="overlay-card--mixer"
                title="Volume mixer"
                icon={<UnmuteIcon size={16} />}
                meta={audioSessions.length}
                widgetStyle={getWidgetStyle("mixer")}
                {...widgetFrameProps}
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
                        <button
                          type="button"
                          className="overlay-mixer__adjust"
                          aria-expanded={expandedMixerPid === session.pid}
                          aria-controls={`overlay-mixer-slider-${session.pid}`}
                          onClick={() =>
                            setExpandedMixerPid((current) =>
                              current === session.pid ? null : session.pid
                            )
                          }
                        >
                          <span className="overlay-mixer__name">
                            {session.name}
                          </span>
                          <span className="overlay-mixer__pct">
                            {Math.round(session.volume * 100)}
                          </span>
                          <SlidersHorizontal size={13} />
                        </button>
                        {expandedMixerPid === session.pid && (
                          <input
                            id={`overlay-mixer-slider-${session.pid}`}
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
                            aria-label={`${session.name} volume. Press Select to adjust, then Select again when done.`}
                          />
                        )}
                      </div>
                    </li>
                  ))}
                  {audioSessions.length === 0 && (
                    <li className="overlay-ach__empty">
                      No app audio sessions detected.
                    </li>
                  )}
                </ul>
              </OverlayWidgetFrame>
            )}

            {isWidgetVisible("quick-launch") && (
              <OverlayWidgetFrame
                widgetId="quick-launch"
                className="overlay-card--pins"
                title="Quick launch"
                icon={<AppsIcon size={16} />}
                meta={pinnedApps.length}
                widgetStyle={getWidgetStyle("quick-launch")}
                {...widgetFrameProps}
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
                        {app.iconUrl ? (
                          <img
                            className="overlay-pin-tile__icon"
                            src={app.iconUrl}
                            alt=""
                            draggable={false}
                          />
                        ) : (
                          <AppsIcon size={17} />
                        )}
                      </span>
                      <span className="overlay-pin-tile__label">
                        {app.name}
                      </span>
                    </button>
                  ))}
                  <button
                    type="button"
                    className="overlay-pin-tile overlay-pin-tile--add"
                    onClick={pinApp}
                  >
                    <span
                      className="overlay-pin-tile__glyph"
                      aria-hidden="true"
                    >
                      <PlusIcon size={18} />
                    </span>
                    <span className="overlay-pin-tile__label">Pin app</span>
                  </button>
                </div>
              </OverlayWidgetFrame>
            )}

            {isWidgetVisible("notes") && (
              <OverlayWidgetFrame
                widgetId="notes"
                className="overlay-card--notes"
                title="Notes"
                icon={<NoteIcon size={16} />}
                meta={noteSaved ? "Saved" : "Saving…"}
                widgetStyle={getWidgetStyle("notes")}
                {...widgetFrameProps}
              >
                <textarea
                  className="overlay-notes"
                  value={note}
                  placeholder="Jot down a code, a boss strategy, where you left off…"
                  onChange={(event) => handleNoteChange(event.target.value)}
                />
              </OverlayWidgetFrame>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
