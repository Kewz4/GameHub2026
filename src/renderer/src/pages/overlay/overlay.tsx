/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- Scrollable controller focus-engagement regions are intentionally keyboard focusable. */
import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation } from "react-router-dom";
import {
  LockIcon,
  MuteIcon,
  PlusIcon,
  SearchIcon,
  SyncIcon,
  TrashIcon,
  UnlockIcon,
  UnmuteIcon,
  XIcon,
} from "@primer/octicons-react";
import {
  AlertTriangle,
  CalendarDays,
  ChartLine,
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
  StickyNote,
  Trophy,
  Users,
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
import {
  advanceOverlayGamepadPoll,
  arbitrateOverlayControllerAction,
  createOverlayGamepadPollState,
  findOverlayDirectionalCandidate,
  getOverlayBrowserGamepadMask,
  getOverlaySequentialNavigationOffset,
  type OverlayControllerArbitrationState,
  type OverlayControllerDirection,
} from "./overlay-controller";
import { OverlayControllerKeyboard } from "./overlay-controller-keyboard";
import { getOverlayUnavailableMessage } from "./overlay-unavailable";
import {
  getOverlayRecorderTechnicalSummary,
  getOverlayReplayPresentation,
} from "./overlay-recorder-presentation";
import { SpotifyOverlayPanel } from "./spotify-overlay-panel";
import {
  OVERLAY_WIDGET_IDS,
  type OverlayWidgetControllerEditMode,
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
].join(",");

const intersectControllerRects = (left: DOMRect, right: DOMRect) => {
  const intersectionLeft = Math.max(left.left, right.left);
  const intersectionTop = Math.max(left.top, right.top);
  const intersectionRight = Math.min(left.right, right.right);
  const intersectionBottom = Math.min(left.bottom, right.bottom);
  return {
    left: intersectionLeft,
    top: intersectionTop,
    right: intersectionRight,
    bottom: intersectionBottom,
    width: Math.max(0, intersectionRight - intersectionLeft),
    height: Math.max(0, intersectionBottom - intersectionTop),
  };
};

const getVisibleControllerRect = (element: HTMLElement) => {
  if (
    element.closest('[aria-hidden="true"], [inert]') ||
    element.getAttribute("aria-disabled") === "true"
  ) {
    return null;
  }

  const style = window.getComputedStyle(element);
  const elementRect = element.getBoundingClientRect();
  if (
    elementRect.width <= 0 ||
    elementRect.height <= 0 ||
    style.display === "none" ||
    style.visibility === "hidden"
  ) {
    return null;
  }

  let visibleRect = intersectControllerRects(
    elementRect,
    new DOMRect(0, 0, window.innerWidth, window.innerHeight)
  );
  let ancestor = element.parentElement;
  while (ancestor && !ancestor.classList.contains("overlay--full")) {
    const ancestorStyle = window.getComputedStyle(ancestor);
    const clipsX = ["auto", "hidden", "scroll", "clip"].includes(
      ancestorStyle.overflowX
    );
    const clipsY = ["auto", "hidden", "scroll", "clip"].includes(
      ancestorStyle.overflowY
    );
    if (clipsX || clipsY) {
      const clip = ancestor.getBoundingClientRect();
      visibleRect = {
        left: clipsX ? Math.max(visibleRect.left, clip.left) : visibleRect.left,
        top: clipsY ? Math.max(visibleRect.top, clip.top) : visibleRect.top,
        right: clipsX
          ? Math.min(visibleRect.right, clip.right)
          : visibleRect.right,
        bottom: clipsY
          ? Math.min(visibleRect.bottom, clip.bottom)
          : visibleRect.bottom,
        width: 0,
        height: 0,
      };
      visibleRect.width = Math.max(0, visibleRect.right - visibleRect.left);
      visibleRect.height = Math.max(0, visibleRect.bottom - visibleRect.top);
    }
    ancestor = ancestor.parentElement;
  }

  const visibleArea = visibleRect.width * visibleRect.height;
  const elementArea = elementRect.width * elementRect.height;
  if (
    visibleRect.width < Math.min(12, elementRect.width) ||
    visibleRect.height < Math.min(12, elementRect.height) ||
    visibleArea / Math.max(1, elementArea) < 0.2
  ) {
    return null;
  }

  const centerX = visibleRect.left + visibleRect.width / 2;
  const centerY = visibleRect.top + visibleRect.height / 2;
  const topmost = document.elementFromPoint(centerX, centerY);
  if (topmost && !element.contains(topmost) && !topmost.contains(element)) {
    return null;
  }

  return elementRect;
};

const getActiveControllerScope = () => {
  const scopes = Array.from(
    document.querySelectorAll<HTMLElement>('[data-controller-scope="true"]')
  ).filter((scope) => getVisibleControllerRect(scope) !== null);
  const modal = scopes.find(
    (scope) => scope.getAttribute("aria-modal") === "true"
  );
  if (modal) return modal;
  const focusedScope =
    document.activeElement instanceof Element
      ? document.activeElement.closest<HTMLElement>(
          '[data-controller-scope="true"]'
        )
      : null;
  if (focusedScope && scopes.includes(focusedScope)) return focusedScope;
  return scopes.at(-1) ?? null;
};

const getControllerElements = (rootOverride?: HTMLElement) => {
  const overlay = document.querySelector<HTMLElement>(".overlay--full");
  if (!overlay) return [];
  const root = rootOverride ?? getActiveControllerScope() ?? overlay;
  return Array.from(
    root.querySelectorAll<HTMLElement>(CONTROLLER_FOCUSABLE_SELECTOR)
  ).filter((element) => {
    const containingRegion = element.closest<HTMLElement>(
      "[data-controller-focus-region]"
    );
    if (
      containingRegion &&
      containingRegion !== element &&
      containingRegion.getAttribute("data-controller-editing") !== "true"
    ) {
      return false;
    }
    return getVisibleControllerRect(element) !== null;
  });
};

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
  action: OverlayControllerDirection,
  focusOverlayWidget: FocusOverlayWidget,
  rootOverride?: HTMLElement
) => {
  const elements = getControllerElements(rootOverride);
  if (!elements.length) return false;

  const active = document.activeElement;
  const current = elements.includes(active as HTMLElement)
    ? (active as HTMLElement)
    : focusControllerDefault(focusOverlayWidget);
  if (!current) return false;

  const origin = current.getBoundingClientRect();
  const next = findOverlayDirectionalCandidate(
    origin,
    elements
      .filter((element) => element !== current)
      .map((element) => ({
        value: element,
        rect: element.getBoundingClientRect(),
      })),
    action
  );
  if (!next) return false;
  focusControllerElement(next, focusOverlayWidget);
  return true;
};

const moveControllerFocusSequentiallyInRegion = (
  region: HTMLElement,
  current: HTMLElement,
  action: OverlayControllerDirection,
  focusOverlayWidget: FocusOverlayWidget
) => {
  const offset = getOverlaySequentialNavigationOffset(action);
  if (offset === null) return false;
  const elements = Array.from(
    region.querySelectorAll<HTMLElement>(CONTROLLER_FOCUSABLE_SELECTOR)
  ).filter((element) => {
    if (
      element.closest('[aria-hidden="true"], [inert], [hidden]') ||
      element.getAttribute("aria-disabled") === "true"
    ) {
      return false;
    }
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      rect.width > 0 &&
      rect.height > 0
    );
  });
  const currentIndex = elements.indexOf(current);
  if (currentIndex < 0) return false;
  const next = elements[currentIndex + offset];
  if (!next) return false;
  focusControllerElement(next, focusOverlayWidget);
  return true;
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

type OverlayEditableElement = HTMLInputElement | HTMLTextAreaElement;

const isOverlayEditableElement = (
  element: Element | null
): element is OverlayEditableElement =>
  element instanceof HTMLTextAreaElement ||
  (element instanceof HTMLInputElement &&
    !["button", "checkbox", "radio", "range", "submit"].includes(element.type));

const setOverlayEditableValue = (
  element: OverlayEditableElement,
  value: string
) => {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const valueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  valueSetter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
};

export default function Overlay() {
  const location = useLocation();
  const overlayUnavailable = useMemo(
    () => getOverlayUnavailableMessage(location.search),
    [location.search]
  );
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
  const controllerScrollEditRef = useRef<HTMLElement | null>(null);
  const controllerKeyboardTargetRef = useRef<OverlayEditableElement | null>(
    null
  );
  const [controllerKeyboard, setControllerKeyboard] = useState<{
    label: string;
    multiline: boolean;
    value: string;
  } | null>(null);
  const controllerInputArbitrationRef =
    useRef<OverlayControllerArbitrationState>(null);
  const controllerActionHandlerRef = useRef<
    (action: HydraOverlayGamepadAction) => void
  >(() => undefined);
  const [controllerWidgetEdit, setControllerWidgetEdit] = useState<{
    widgetId: OverlayWidgetId;
    mode: OverlayWidgetControllerEditMode;
  } | null>(null);
  const controllerWidgetEditTriggerRef = useRef<HTMLElement | null>(null);
  const [closeGameConfirmOpen, setCloseGameConfirmOpen] = useState(false);
  const rendererReadySentRef = useRef(false);
  const contextRequestIdRef = useRef(0);
  const draggingPidRef = useRef<number | null>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const {
    adjustWidgetByController,
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

  const toggleControllerWidgetEdit = useCallback(
    (widgetId: OverlayWidgetId, mode: OverlayWidgetControllerEditMode) => {
      if (layoutLocked) return;
      controllerWidgetEditTriggerRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setControllerWidgetEdit((current) =>
        current?.widgetId === widgetId && current.mode === mode
          ? null
          : { widgetId, mode }
      );
      focusWidget(widgetId);
    },
    [focusWidget, layoutLocked]
  );

  const widgetFrameProps = {
    controllerEdit: controllerWidgetEdit,
    layoutLocked,
    registerWidget,
    onBeginDrag: beginWidgetDrag,
    onBeginResize: beginWidgetResize,
    onCycleSize: cycleWidgetSize,
    onControllerEdit: toggleControllerWidgetEdit,
    onFocus: focusWidget,
    onHide: (id: OverlayWidgetId) => {
      setWidgetVisible(id, false);
      if (document.body.classList.contains("overlay-controller-navigation")) {
        window.requestAnimationFrame(() => focusControllerDefault(focusWidget));
      }
    },
  };

  const closeControllerKeyboard = useCallback(() => {
    const target = controllerKeyboardTargetRef.current;
    controllerKeyboardTargetRef.current = null;
    setControllerKeyboard(null);
    if (target?.isConnected) {
      window.requestAnimationFrame(() =>
        focusControllerElement(target, focusWidget)
      );
    }
  }, [focusWidget]);

  const updateControllerKeyboardValue = useCallback((value: string) => {
    const target = controllerKeyboardTargetRef.current;
    if (!target?.isConnected) return;
    setOverlayEditableValue(target, value);
    setControllerKeyboard((current) =>
      current ? { ...current, value } : current
    );
  }, []);

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
  const [playlistDeleteCandidate, setPlaylistDeleteCandidate] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [resetLayoutConfirmOpen, setResetLayoutConfirmOpen] = useState(false);
  const resetLayoutTriggerRef = useRef<HTMLButtonElement | null>(null);

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

  const restorePlaylistDeleteFocus = useCallback((id: string) => {
    window.requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(
          `#overlay-delete-playlist-${CSS.escape(id)}`
        )
        ?.focus({ preventScroll: true })
    );
  }, []);

  const cancelPlaylistDelete = useCallback(() => {
    const id = playlistDeleteCandidate?.id;
    setPlaylistDeleteCandidate(null);
    if (id) restorePlaylistDeleteFocus(id);
  }, [playlistDeleteCandidate?.id, restorePlaylistDeleteFocus]);

  const requestResetLayout = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      resetLayoutTriggerRef.current = event.currentTarget;
      setResetLayoutConfirmOpen(true);
    },
    []
  );

  const cancelResetLayout = useCallback(() => {
    const trigger = resetLayoutTriggerRef.current;
    setResetLayoutConfirmOpen(false);
    window.requestAnimationFrame(() => trigger?.focus({ preventScroll: true }));
  }, []);

  const confirmResetLayout = useCallback(() => {
    resetLayout();
    setResetLayoutConfirmOpen(false);
    const trigger = resetLayoutTriggerRef.current;
    window.requestAnimationFrame(() => trigger?.focus({ preventScroll: true }));
  }, [resetLayout]);

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

  const replayPresentation = useMemo(() => {
    if (!recorderState) return null;
    return getOverlayReplayPresentation(
      recorderState.bufferedSeconds,
      recorderState.configuration.replayDurationSeconds
    );
  }, [recorderState]);

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
          ? `Last ${replayPresentation?.availableSeconds ?? 0} seconds saved.`
          : result.error
      );
      refreshRecorderState();
    });
  }, [replayPresentation?.availableSeconds, refreshRecorderState]);

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
    setCloseGameConfirmOpen(false);
    setGameProcessBusy(true);
    void window.electron
      .closeActiveGame()
      .then(setGameProcessState)
      .finally(() => setGameProcessBusy(false));
  }, [gameProcessBusy, gameProcessState?.canClose]);

  const requestCloseActiveGame = useCallback(() => {
    if (!gameProcessState?.canClose || gameProcessBusy) return;
    setCloseGameConfirmOpen(true);
  }, [gameProcessBusy, gameProcessState?.canClose]);

  const stopControllerEngagement = useCallback(() => {
    controllerRangeEditRef.current?.removeAttribute("data-controller-editing");
    controllerRangeEditRef.current = null;
    controllerScrollEditRef.current?.removeAttribute("data-controller-editing");
    controllerScrollEditRef.current?.removeAttribute("data-controller-scope");
    controllerScrollEditRef.current = null;
  }, []);

  const handleControllerAction = useCallback(
    (action: HydraOverlayGamepadAction) => {
      if (controllerWidgetEdit) {
        if (action === "accept" || action === "back") {
          const { widgetId, mode: editMode } = controllerWidgetEdit;
          setControllerWidgetEdit(null);
          window.requestAnimationFrame(() => {
            const editButton = controllerWidgetEditTriggerRef.current
              ?.isConnected
              ? controllerWidgetEditTriggerRef.current
              : document.querySelector<HTMLElement>(
                  `[data-widget="${widgetId}"] .overlay-widget__options-trigger, [data-widget="${widgetId}"] [data-widget-controller-edit="${editMode}"]`
                );
            if (editButton) focusControllerElement(editButton, focusWidget);
          });
          return;
        }
        if (["up", "down", "left", "right"].includes(action)) {
          adjustWidgetByController(
            controllerWidgetEdit.widgetId,
            controllerWidgetEdit.mode,
            action as OverlayControllerDirection
          );
        }
        return;
      }

      if (action === "back") {
        if (controllerKeyboard) {
          closeControllerKeyboard();
          return;
        }
        if (playlistDeleteCandidate) {
          cancelPlaylistDelete();
          return;
        }
        if (resetLayoutConfirmOpen) {
          cancelResetLayout();
          return;
        }
        if (closeGameConfirmOpen) {
          setCloseGameConfirmOpen(false);
          window.requestAnimationFrame(() =>
            document
              .querySelector<HTMLElement>("#overlay-close-game-trigger")
              ?.focus({ preventScroll: true })
          );
          return;
        }
        const openOverlaySelect = document.querySelector<HTMLButtonElement>(
          '.overlay-select__trigger[aria-expanded="true"]'
        );
        if (openOverlaySelect) {
          openOverlaySelect.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Escape",
              bubbles: true,
              cancelable: true,
            })
          );
          return;
        }
        if (controllerRangeEditRef.current) {
          stopControllerEngagement();
          return;
        }
        const dismissibleScope = getActiveControllerScope();
        if (
          dismissibleScope?.getAttribute("data-controller-dismiss-on-back") ===
          "true"
        ) {
          const scopeId = dismissibleScope.id;
          const trigger = scopeId
            ? document.querySelector<HTMLElement>(
                `[aria-controls="${scopeId}"][aria-expanded="true"]`
              )
            : null;
          trigger?.click();
          // The trigger already exists. A delayed frame can arrive after the
          // user opens another widget and steal focus from its menu.
          trigger?.focus({ preventScroll: true });
          return;
        }
        if (playlistMenuTrackId) {
          const trigger = document.querySelector<HTMLElement>(
            '.overlay-music__search-plist-btn[aria-expanded="true"]'
          );
          setPlaylistMenuTrackId(null);
          window.requestAnimationFrame(() =>
            trigger?.focus({ preventScroll: true })
          );
          return;
        }
        if (creatingPlaylist) {
          setCreatingPlaylist(false);
          setNewPlaylistName("");
          window.requestAnimationFrame(() =>
            document
              .querySelector<HTMLElement>(".overlay-music__plist-new")
              ?.focus({ preventScroll: true })
          );
          return;
        }
        if (expandedPlaylistId) {
          const trigger = document.querySelector<HTMLElement>(
            '.overlay-music__plist-info[aria-expanded="true"]'
          );
          setExpandedPlaylistId(null);
          window.requestAnimationFrame(() =>
            trigger?.focus({ preventScroll: true })
          );
          return;
        }
        if (controllerScrollEditRef.current) {
          const region = controllerScrollEditRef.current;
          stopControllerEngagement();
          focusControllerElement(region, focusWidget);
          return;
        }
        // An engaged list is the user's active interaction layer. Dismiss it
        // before unrelated controls that may still be expanded in another
        // widget; otherwise Back can jump across the overlay and leave the
        // current shelf trapped in edit mode.
        if (widgetMenuOpen) {
          setWidgetMenuOpen(false);
          window.requestAnimationFrame(() =>
            document
              .querySelector<HTMLElement>(".overlay-header__widget-button")
              ?.focus({ preventScroll: true })
          );
          return;
        }
        if (musicVolumeOpen) {
          setMusicVolumeOpen(false);
          window.requestAnimationFrame(() =>
            document
              .querySelector<HTMLElement>(".overlay-music__volume-trigger")
              ?.focus({ preventScroll: true })
          );
          return;
        }
        if (expandedMixerPid !== null) {
          const trigger = document.querySelector<HTMLElement>(
            `.overlay-mixer__adjust[aria-controls="overlay-mixer-slider-${expandedMixerPid}"]`
          );
          setExpandedMixerPid(null);
          window.requestAnimationFrame(() =>
            trigger?.focus({ preventScroll: true })
          );
          return;
        }
        const active = document.activeElement;
        if (
          active instanceof HTMLInputElement ||
          active instanceof HTMLTextAreaElement
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
        const activeTabList =
          document.activeElement?.closest('[role="tablist"]');
        const tabRoot = activeTabList;
        if (!tabRoot) {
          if (getActiveControllerScope()) return;
          const widgets = Array.from(
            document.querySelectorAll<HTMLElement>("[data-widget]")
          ).filter((widget) => getControllerElements(widget).length > 0);
          if (!widgets.length) return;
          const currentWidget =
            document.activeElement?.closest("[data-widget]");
          const currentIndex = widgets.findIndex(
            (widget) => widget === currentWidget
          );
          const offset = action === "next-tab" ? 1 : -1;
          const index =
            currentIndex < 0
              ? offset > 0
                ? 0
                : widgets.length - 1
              : (currentIndex + offset + widgets.length) % widgets.length;
          focusControllerElement(
            getControllerElements(widgets[index])[0],
            focusWidget
          );
          return;
        }
        const tabs = Array.from(
          tabRoot.querySelectorAll<HTMLButtonElement>('[role="tab"]')
        ).filter((tab) => getVisibleControllerRect(tab) !== null);
        if (!tabs.length) return;
        const activeIndex = Math.max(
          0,
          tabs.findIndex((tab) => tab.getAttribute("aria-selected") === "true")
        );
        const offset = action === "next-tab" ? 1 : -1;
        const next = tabs[(activeIndex + offset + tabs.length) % tabs.length];
        next.click();
        focusControllerElement(next, focusWidget);
        return;
      }

      const active = document.activeElement;

      if (
        active instanceof HTMLButtonElement &&
        active.classList.contains("overlay-select__option") &&
        ["up", "down", "left", "right"].includes(action)
      ) {
        const key =
          action === "up"
            ? "ArrowUp"
            : action === "down"
              ? "ArrowDown"
              : action === "left"
                ? "ArrowLeft"
                : "ArrowRight";
        active.dispatchEvent(
          new KeyboardEvent("keydown", {
            key,
            bubbles: true,
            cancelable: true,
          })
        );
        return;
      }

      if (action === "accept") {
        if (active instanceof HTMLInputElement && active.type === "range") {
          if (controllerRangeEditRef.current === active) {
            stopControllerEngagement();
          } else {
            stopControllerEngagement();
            controllerRangeEditRef.current = active;
            active.setAttribute("data-controller-editing", "true");
          }
          return;
        }
        if (
          active instanceof HTMLElement &&
          active.hasAttribute("data-controller-focus-region")
        ) {
          if (controllerScrollEditRef.current === active) {
            stopControllerEngagement();
          } else {
            stopControllerEngagement();
            controllerScrollEditRef.current = active;
            active.setAttribute("data-controller-editing", "true");
            active.setAttribute("data-controller-scope", "true");
            window.requestAnimationFrame(() => {
              const firstChild = Array.from(
                active.querySelectorAll<HTMLElement>(
                  CONTROLLER_FOCUSABLE_SELECTOR
                )
              ).find((element) => getVisibleControllerRect(element) !== null);
              if (firstChild) focusControllerElement(firstChild, focusWidget);
            });
          }
          return;
        }
        if (isOverlayEditableElement(active)) {
          stopControllerEngagement();
          controllerKeyboardTargetRef.current = active;
          setControllerKeyboard({
            label:
              active.getAttribute("aria-label") ||
              active.placeholder ||
              "Enter text",
            multiline: active instanceof HTMLTextAreaElement,
            value: active.value,
          });
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
        controllerRangeEditRef.current === active
      ) {
        if (action === "left" || action === "right") {
          adjustControllerRange(active, action);
        }
        return;
      }

      if (
        active instanceof HTMLElement &&
        controllerScrollEditRef.current === active
      ) {
        const verticalAmount = Math.max(64, active.clientHeight * 0.42);
        const horizontalAmount = Math.max(64, active.clientWidth * 0.42);
        active.scrollBy({
          top:
            action === "up"
              ? -verticalAmount
              : action === "down"
                ? verticalAmount
                : 0,
          left:
            action === "left"
              ? -horizontalAmount
              : action === "right"
                ? horizontalAmount
                : 0,
          behavior: "smooth",
        });
        return;
      }

      if (["up", "down", "left", "right"].includes(action)) {
        const direction = action as OverlayControllerDirection;
        const engagedRegion = controllerScrollEditRef.current;
        const isInsideEngagedRegion =
          Boolean(engagedRegion) &&
          active instanceof HTMLElement &&
          engagedRegion!.contains(active);
        const moved = moveControllerFocus(
          direction,
          focusWidget,
          isInsideEngagedRegion ? engagedRegion! : undefined
        );
        if (
          !moved &&
          engagedRegion &&
          isInsideEngagedRegion &&
          active instanceof HTMLElement
        ) {
          moveControllerFocusSequentiallyInRegion(
            engagedRegion,
            active,
            direction,
            focusWidget
          );
        }
      }
    },
    [
      adjustWidgetByController,
      closeGameConfirmOpen,
      closeControllerKeyboard,
      cancelPlaylistDelete,
      cancelResetLayout,
      controllerKeyboard,
      controllerWidgetEdit,
      creatingPlaylist,
      expandedMixerPid,
      expandedPlaylistId,
      focusWidget,
      musicVolumeOpen,
      playlistMenuTrackId,
      playlistDeleteCandidate,
      resetLayoutConfirmOpen,
      stopControllerEngagement,
      widgetMenuOpen,
    ]
  );
  controllerActionHandlerRef.current = handleControllerAction;

  const dispatchControllerAction = useCallback(
    (action: HydraOverlayGamepadAction, source: "native" | "browser") => {
      if (
        document.visibilityState !== "visible" ||
        !document.hasFocus() ||
        !document.querySelector(".overlay--full")
      ) {
        controllerInputArbitrationRef.current = null;
        return;
      }
      const now = window.performance.now();
      // Chromium and native XInput can expose the same physical edge. Suppress
      // only a near-simultaneous matching cross-source edge; a different action
      // or a source failover remains usable immediately instead of waiting for
      // an arbitrary source lock timeout.
      const arbitration = arbitrateOverlayControllerAction(
        controllerInputArbitrationRef.current,
        action,
        source,
        now
      );
      controllerInputArbitrationRef.current = arbitration.state;
      if (!arbitration.accepted) return;
      controllerActionHandlerRef.current(action);
    },
    []
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
      window.electron.onOverlayGamepadAction((action) =>
        dispatchControllerAction(action, "native")
      ),
      window.electron.onGameRecorderState(setRecorderState),
    ];
    return () => unsubscribers.forEach((off) => off?.());
  }, [
    focusWidget,
    dispatchControllerAction,
    initialMode,
    refreshContext,
    refreshRecorderState,
  ]);

  useEffect(() => {
    if (mode !== "full" || typeof navigator.getGamepads !== "function") return;

    let animationFrame = 0;
    let pollState = createOverlayGamepadPollState();
    const poll = (now: number) => {
      if (
        document.visibilityState === "visible" &&
        document.hasFocus() &&
        document.querySelector(".overlay--full")
      ) {
        let gamepads: (Gamepad | null)[] = [];
        try {
          gamepads = Array.from(navigator.getGamepads());
        } catch {
          // Some Chromium builds expose the method before the Gamepad service
          // is available. The native watcher remains active in that case.
        }
        const frame = advanceOverlayGamepadPoll(
          pollState,
          getOverlayBrowserGamepadMask(gamepads),
          now
        );
        pollState = frame.state;
        if (frame.action) dispatchControllerAction(frame.action, "browser");
      } else {
        pollState = createOverlayGamepadPollState();
        controllerInputArbitrationRef.current = null;
      }
      animationFrame = window.requestAnimationFrame(poll);
    };

    animationFrame = window.requestAnimationFrame(poll);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [dispatchControllerAction, mode]);

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
      if (mode !== "full" || event.defaultPrevented) return;

      if (event.key === "Tab") {
        const elements = getControllerElements();
        if (!elements.length) return;
        event.preventDefault();
        document.body.classList.add("overlay-controller-navigation");
        const activeIndex = elements.indexOf(
          document.activeElement as HTMLElement
        );
        const offset = event.shiftKey ? -1 : 1;
        const nextIndex =
          activeIndex < 0
            ? event.shiftKey
              ? elements.length - 1
              : 0
            : (activeIndex + offset + elements.length) % elements.length;
        focusControllerElement(elements[nextIndex], focusWidget);
        return;
      }

      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLButtonElement &&
        activeElement.getAttribute("role") === "tab" &&
        ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
      ) {
        const tabList = activeElement.closest<HTMLElement>('[role="tablist"]');
        const tabs = Array.from(
          tabList?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []
        ).filter((tab) => getVisibleControllerRect(tab) !== null);
        if (tabs.length) {
          event.preventDefault();
          const currentIndex = Math.max(0, tabs.indexOf(activeElement));
          const nextIndex =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? tabs.length - 1
                : (currentIndex +
                    (event.key === "ArrowRight" ? 1 : -1) +
                    tabs.length) %
                  tabs.length;
          tabs[nextIndex].click();
          focusControllerElement(tabs[nextIndex], focusWidget);
          return;
        }
      }

      if (
        activeElement instanceof HTMLElement &&
        ["Enter", " "].includes(event.key) &&
        (activeElement.hasAttribute("data-controller-focus-region") ||
          (activeElement instanceof HTMLInputElement &&
            activeElement.type === "range"))
      ) {
        event.preventDefault();
        handleControllerAction("accept");
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        handleControllerAction("back");
        return;
      }

      const directionByKey: Partial<
        Record<string, OverlayControllerDirection>
      > = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
      };
      const direction = directionByKey[event.key];
      if (!direction || isOverlayEditableElement(document.activeElement))
        return;
      event.preventDefault();
      document.body.classList.add("overlay-controller-navigation");
      handleControllerAction(direction);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusWidget, handleControllerAction, mode]);

  useEffect(() => {
    if (mode !== "full") {
      setControllerWidgetEdit(null);
      stopControllerEngagement();
      controllerInputArbitrationRef.current = null;
      controllerKeyboardTargetRef.current = null;
      setControllerKeyboard(null);
    }
  }, [mode, stopControllerEngagement]);

  useEffect(() => {
    if (mode !== "full") return;
    const onBlur = () => {
      controllerInputArbitrationRef.current = null;
      setControllerWidgetEdit(null);
      stopControllerEngagement();
    };
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [mode, stopControllerEngagement]);

  useEffect(() => {
    if (!widgetMenuOpen) return;
    const frame = window.requestAnimationFrame(() => {
      if (!document.body.classList.contains("overlay-controller-navigation")) {
        return;
      }
      document
        .querySelector<HTMLElement>("#overlay-widget-menu input:not(:disabled)")
        ?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [widgetMenuOpen]);

  useEffect(() => {
    if (!musicVolumeOpen) return;
    const frame = window.requestAnimationFrame(() => {
      if (!document.body.classList.contains("overlay-controller-navigation")) {
        return;
      }
      document
        .querySelector<HTMLElement>("#overlay-music-volume-controls button")
        ?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [musicVolumeOpen]);

  useEffect(() => {
    if (!playlistMenuTrackId) return;
    const frame = window.requestAnimationFrame(() => {
      if (!document.body.classList.contains("overlay-controller-navigation")) {
        return;
      }
      document
        .querySelector<HTMLElement>(
          `#overlay-playlist-menu-${CSS.escape(playlistMenuTrackId)} button`
        )
        ?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [playlistMenuTrackId]);

  useEffect(() => {
    if (!creatingPlaylist) return;
    const frame = window.requestAnimationFrame(() => {
      if (!document.body.classList.contains("overlay-controller-navigation")) {
        return;
      }
      document
        .querySelector<HTMLElement>(".overlay-music__plist-input")
        ?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [creatingPlaylist]);

  useEffect(() => {
    if (!closeGameConfirmOpen) return;
    stopControllerEngagement();
    const frame = window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>("#overlay-close-game-cancel")
        ?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [closeGameConfirmOpen, stopControllerEngagement]);

  useEffect(() => {
    if (!playlistDeleteCandidate) return;
    stopControllerEngagement();
    const frame = window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>("#overlay-delete-playlist-cancel")
        ?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [playlistDeleteCandidate, stopControllerEngagement]);

  useEffect(() => {
    if (!resetLayoutConfirmOpen) return;
    stopControllerEngagement();
    const frame = window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>("#overlay-reset-layout-cancel")
        ?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [resetLayoutConfirmOpen, stopControllerEngagement]);

  useEffect(() => {
    if (layoutLocked) setControllerWidgetEdit(null);
  }, [layoutLocked]);

  useEffect(() => {
    document.body.classList.add("overlay-window");
    const usePointerNavigation = () => {
      document.body.classList.remove("overlay-controller-navigation");
      setControllerWidgetEdit(null);
      stopControllerEngagement();
    };
    window.addEventListener("pointerdown", usePointerNavigation);
    return () => {
      window.removeEventListener("pointerdown", usePointerNavigation);
      document.body.classList.remove(
        "overlay-window",
        "overlay-controller-navigation"
      );
    };
  }, [stopControllerEngagement]);

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
        <div
          className={`overlay-toast${overlayUnavailable ? " overlay-toast--error" : ""}`}
          role="status"
          aria-live="polite"
        >
          <span className="overlay-toast__dot" aria-hidden="true" />
          <div className="overlay-toast__body">
            <strong>
              {overlayUnavailable
                ? "Overlay requires Borderless or Windowed"
                : "Overlay shortcut available"}
            </strong>
            {overlayUnavailable ? (
              <p>{overlayUnavailable}</p>
            ) : context?.keyboardShortcutAvailable === false ? (
              <p>
                Press Guide. Run the game without administrator mode to use
                Shift+F3.
              </p>
            ) : (
              <p>
                Press <kbd>{context?.shortcut ?? "Shift+F3"}</kbd> or press the
                Guide button once to open it.
              </p>
            )}
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
                  id="overlay-close-game-trigger"
                  type="button"
                  className="overlay-header__process-button overlay-header__process-button--danger"
                  onClick={requestCloseActiveGame}
                  disabled={gameProcessBusy || !gameProcessState.canClose}
                  title="Close game"
                  aria-label="Close game"
                  aria-haspopup="dialog"
                  aria-expanded={closeGameConfirmOpen}
                  aria-controls="overlay-close-game-dialog"
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
                aria-label="Widgets"
              >
                <LayoutGrid size={16} />
                <span>Widgets</span>
                <ChevronDown size={13} />
              </button>
              {widgetMenuOpen && (
                <div
                  id="overlay-widget-menu"
                  className="overlay-widget-menu"
                  data-controller-scope="true"
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
                    onClick={requestResetLayout}
                    aria-haspopup="dialog"
                    aria-controls="overlay-reset-layout-dialog"
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
              onClick={requestResetLayout}
              aria-label="Reset widget layout"
              title="Reset widget layout"
              aria-haspopup="dialog"
              aria-controls="overlay-reset-layout-dialog"
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

        {closeGameConfirmOpen && (
          <div
            className="overlay-confirm-backdrop"
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) {
                setCloseGameConfirmOpen(false);
                window.requestAnimationFrame(() =>
                  document
                    .querySelector<HTMLElement>("#overlay-close-game-trigger")
                    ?.focus({ preventScroll: true })
                );
              }
            }}
          >
            <section
              id="overlay-close-game-dialog"
              className="overlay-confirm"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="overlay-close-game-title"
              aria-describedby="overlay-close-game-description"
              data-controller-scope="true"
            >
              <div className="overlay-confirm__icon" aria-hidden="true">
                <Power size={20} />
              </div>
              <div className="overlay-confirm__copy">
                <h2 id="overlay-close-game-title">Close this game?</h2>
                <p id="overlay-close-game-description">
                  Unsaved progress may be lost. This closes the game process,
                  not only the overlay.
                </p>
              </div>
              <div className="overlay-confirm__actions">
                <button
                  id="overlay-close-game-cancel"
                  type="button"
                  onClick={() => {
                    setCloseGameConfirmOpen(false);
                    window.requestAnimationFrame(() =>
                      document
                        .querySelector<HTMLElement>(
                          "#overlay-close-game-trigger"
                        )
                        ?.focus({ preventScroll: true })
                    );
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="overlay-confirm__danger"
                  onClick={closeActiveGame}
                  disabled={gameProcessBusy}
                >
                  Close game
                </button>
              </div>
            </section>
          </div>
        )}

        {playlistDeleteCandidate && (
          <div
            className="overlay-confirm-backdrop"
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) cancelPlaylistDelete();
            }}
          >
            <section
              id="overlay-delete-playlist-dialog"
              className="overlay-confirm"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="overlay-delete-playlist-title"
              aria-describedby="overlay-delete-playlist-description"
              data-controller-scope="true"
            >
              <div className="overlay-confirm__icon" aria-hidden="true">
                <TrashIcon size={20} />
              </div>
              <div className="overlay-confirm__copy">
                <h2 id="overlay-delete-playlist-title">Delete playlist?</h2>
                <p id="overlay-delete-playlist-description">
                  “{playlistDeleteCandidate.name}” will be removed from GameHub.
                  The tracks themselves will remain available.
                </p>
              </div>
              <div className="overlay-confirm__actions">
                <button
                  id="overlay-delete-playlist-cancel"
                  type="button"
                  onClick={cancelPlaylistDelete}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="overlay-confirm__danger"
                  onClick={() => {
                    const id = playlistDeleteCandidate.id;
                    setPlaylistDeleteCandidate(null);
                    handleDeletePlaylist(id);
                    window.requestAnimationFrame(() =>
                      document
                        .querySelector<HTMLElement>(
                          ".overlay-music__plist-list, .overlay-music__plist-new"
                        )
                        ?.focus({ preventScroll: true })
                    );
                  }}
                >
                  Delete playlist
                </button>
              </div>
            </section>
          </div>
        )}

        {resetLayoutConfirmOpen && (
          <div
            className="overlay-confirm-backdrop"
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) cancelResetLayout();
            }}
          >
            <section
              id="overlay-reset-layout-dialog"
              className="overlay-confirm"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="overlay-reset-layout-title"
              aria-describedby="overlay-reset-layout-description"
              data-controller-scope="true"
            >
              <div className="overlay-confirm__icon" aria-hidden="true">
                <SyncIcon size={20} />
              </div>
              <div className="overlay-confirm__copy">
                <h2 id="overlay-reset-layout-title">Restore default layout?</h2>
                <p id="overlay-reset-layout-description">
                  Widget positions, sizes, visibility, and stacking order will
                  return to the GameHub defaults.
                </p>
              </div>
              <div className="overlay-confirm__actions">
                <button
                  id="overlay-reset-layout-cancel"
                  type="button"
                  onClick={cancelResetLayout}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="overlay-confirm__danger"
                  onClick={confirmResetLayout}
                >
                  Restore defaults
                </button>
              </div>
            </section>
          </div>
        )}

        {controllerKeyboard && (
          <OverlayControllerKeyboard
            label={controllerKeyboard.label}
            multiline={controllerKeyboard.multiline}
            value={controllerKeyboard.value}
            onChange={updateControllerKeyboardValue}
            onClose={closeControllerKeyboard}
          />
        )}

        <div
          className="overlay-controller-hints"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {controllerWidgetEdit ? (
            <>
              <kbd>D-pad</kbd>
              <span>
                {controllerWidgetEdit.mode === "move" ? "Move" : "Resize"}
              </span>
              <kbd>A</kbd>
              <span>Done</span>
              <kbd>B</kbd>
              <span>Exit</span>
            </>
          ) : (
            <>
              <kbd>A</kbd>
              <span>Select</span>
              <kbd>B</kbd>
              <span>Back</span>
              <span className="overlay-controller-hints__tabs">
                <kbd>LB</kbd>
                <kbd>RB</kbd>
                <span>Widgets / tabs</span>
              </span>
            </>
          )}
        </div>

        <div className="overlay-grid" ref={workspaceRef}>
          <div className="overlay-col overlay-col--left">
            {performanceEnabled && isWidgetVisible("performance") && (
              <OverlayWidgetFrame
                widgetId="performance"
                className="overlay-card--perf"
                title="Performance"
                icon={<ChartLine size={18} />}
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
                icon={<Trophy size={18} />}
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
                <ul
                  className="overlay-ach"
                  role="region"
                  tabIndex={0}
                  data-controller-focus-region
                  aria-label="Achievement list. Press Select to browse, then Back to leave."
                >
                  {filteredAchievements.map((achievement) => (
                    <li
                      key={achievement.name}
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
                        ? replayPresentation?.bufferLabel
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
                            ? replayPresentation?.statusLabel
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
                          (recorderState
                            ? getOverlayRecorderTechnicalSummary(
                                recorderState.captureDiagnostics,
                                recorderState.configuration
                              )
                            : "Waiting for recorder status")}
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
                      <div
                        className="overlay-capture__buffer"
                        role="progressbar"
                        aria-label="Instant Replay buffer"
                        aria-valuemin={0}
                        aria-valuemax={
                          recorderState.configuration.replayDurationSeconds
                        }
                        aria-valuenow={Math.min(
                          recorderState.configuration.replayDurationSeconds,
                          Math.max(0, recorderState.bufferedSeconds ?? 0)
                        )}
                        aria-valuetext={replayPresentation?.bufferLabel}
                      >
                        <span
                          style={{
                            transform: `scaleX(${(replayPresentation?.progressPercent ?? 0) / 100})`,
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
                      {replayPresentation?.saveLabel ?? "Save Instant Replay"}
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
                                    data-controller-scope="true"
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
                                <ul
                                  className="overlay-music__queue-list"
                                  role="region"
                                  tabIndex={0}
                                  data-controller-focus-region
                                  aria-label="Music queue. Press Select to browse, then Back to leave."
                                >
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
                          <div className="overlay-music__empty">
                            <Music2 size={30} aria-hidden="true" />
                            <h3>Nothing playing</h3>
                            <p>
                              Search tracks and artists, or open a playlist.
                            </p>
                            <button
                              type="button"
                              onClick={() => {
                                setMusicTab("search");
                                window.requestAnimationFrame(() =>
                                  document
                                    .querySelector<HTMLInputElement>(
                                      ".overlay-music__search-input"
                                    )
                                    ?.focus({ preventScroll: true })
                                );
                              }}
                            >
                              <SearchIcon size={16} aria-hidden="true" />
                              Search music
                            </button>
                          </div>
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
                            aria-label="Search tracks and artists"
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
                            <ul
                              className="overlay-music__search-list"
                              role="region"
                              tabIndex={0}
                              data-controller-focus-region
                              aria-label="Music search results. Press Select to browse, then Back to leave."
                            >
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
                                        aria-controls={`overlay-playlist-menu-${track.id}`}
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
                                        <div
                                          id={`overlay-playlist-menu-${track.id}`}
                                          className="overlay-music__search-plist-drop"
                                          data-controller-scope="true"
                                        >
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
                              aria-label="Playlist name"
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
                          <ul
                            className="overlay-music__plist-list"
                            role="region"
                            tabIndex={0}
                            data-controller-focus-region
                            aria-label="Music playlists. Press Select to browse, then Back to leave."
                          >
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
                                      id={`overlay-delete-playlist-${pl.id}`}
                                      type="button"
                                      className="overlay-music__plist-del"
                                      onClick={() =>
                                        setPlaylistDeleteCandidate({
                                          id: pl.id,
                                          name: pl.name,
                                        })
                                      }
                                      aria-label={`Delete ${pl.name}`}
                                      aria-haspopup="dialog"
                                      aria-controls="overlay-delete-playlist-dialog"
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
                icon={<Users size={18} />}
                meta={
                  context?.user
                    ? `${friends.filter((friend) => friend.isOnline).length} online`
                    : "Sign in required"
                }
                widgetStyle={getWidgetStyle("friends")}
                {...widgetFrameProps}
              >
                <ul
                  className="overlay-friends"
                  role="region"
                  tabIndex={0}
                  data-controller-focus-region
                  aria-label="Friend activity. Press Select to browse, then Back to leave."
                >
                  {friends.map((friend) => (
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
                <ul
                  className="overlay-mixer"
                  role="region"
                  tabIndex={0}
                  data-controller-focus-region
                  aria-label="Volume mixer. Press Select to browse, then Back to leave."
                >
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
                          aria-label={`Adjust ${session.name} volume, ${Math.round(session.volume * 100)} percent`}
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
                icon={<LayoutGrid size={18} />}
                meta={pinnedApps.length}
                widgetStyle={getWidgetStyle("quick-launch")}
                {...widgetFrameProps}
              >
                <div className="overlay-pins">
                  {pinnedApps.map((app) => (
                    <div key={app.path} className="overlay-pin-entry">
                      <button
                        type="button"
                        className="overlay-pin-tile"
                        onClick={() =>
                          void window.electron.launchPinnedApp(app.path)
                        }
                        onContextMenu={(event) => {
                          event.preventDefault();
                          unpinApp(app.path);
                        }}
                        aria-label={`Launch ${app.name}`}
                        title={`Launch ${app.name}`}
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
                            <LayoutGrid size={18} />
                          )}
                        </span>
                        <span className="overlay-pin-tile__label">
                          {app.name}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="overlay-pin-entry__remove"
                        onClick={() => unpinApp(app.path)}
                        aria-label={`Unpin ${app.name}`}
                        title={`Unpin ${app.name}`}
                      >
                        <XIcon size={12} />
                      </button>
                    </div>
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
                icon={<StickyNote size={18} />}
                meta={noteSaved ? "Saved" : "Saving…"}
                widgetStyle={getWidgetStyle("notes")}
                {...widgetFrameProps}
              >
                <textarea
                  className="overlay-notes"
                  aria-label="Game notes"
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
