import type {
  SpotifyContentItem,
  SpotifyContentType,
  SpotifyDevice,
  SpotifyHome,
  SpotifyPlaybackCommand,
  SpotifyPlaybackState,
  SpotifyProviderError,
  SpotifyQueue,
  SpotifySearchResults,
  SpotifyStatus,
} from "@types";
import SpotifyIcon from "@renderer/assets/icons/spotify.svg?react";
import { OverlaySelect } from "./overlay-select";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Headphones,
  Library,
  ListMusic,
  ListPlus,
  LoaderCircle,
  LogIn,
  Music2,
  Pause,
  Play,
  Podcast,
  RefreshCw,
  Repeat,
  Repeat1,
  Search,
  Settings2,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import "./spotify-overlay-panel.scss";

type SpotifyPanelTab = "browse" | "search" | "queue";
type SearchScope = "all" | SpotifyContentType;
type LoadState = "idle" | "loading" | "ready" | "error";

export type SpotifyOverlayPanelProps = {
  /**
   * Stops network polling when the containing widget is hidden or another
   * provider panel is selected.
   */
  isActive?: boolean;
  className?: string;
  /** Opens GameHub's Spotify Client ID settings when authorization is absent. */
  onOpenSettings?: () => void;
};

type ContentShelf = {
  id: string;
  title: string;
  description: string;
  items: SpotifyContentItem[];
  emptyMessage: string;
};

type SpotifyContentCardProps = {
  item: SpotifyContentItem;
  pendingAction: string | null;
  controlsAvailable: boolean;
  onPlay: (item: SpotifyContentItem) => void;
  onQueue: (item: SpotifyContentItem) => void;
  onOpen: (item: SpotifyContentItem) => void;
};

const DYNAMIC_REFRESH_INTERVAL_MS = 3_000;
const SUPPORTING_REFRESH_INTERVAL_MS = 12_000;
const RANGE_COMMIT_DELAY_MS = 280;

const SEARCH_GROUPS: Array<{
  key: Exclude<SpotifyContentType, never>;
  title: string;
}> = [
  { key: "track", title: "Tracks" },
  { key: "playlist", title: "Playlists" },
  { key: "show", title: "Shows" },
  { key: "episode", title: "Episodes" },
];

const RECONNECT_ERROR_CODES = new Set<SpotifyProviderError["code"]>([
  "AUTH_REQUIRED",
  "CLIENT_ID_CHANGED",
  "TOKEN_EXPIRED",
]);

const formatTime = (milliseconds: number) => {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

const errorGuidance = (error: SpotifyProviderError) => {
  switch (error.code) {
    case "AUTH_REQUIRED":
    case "CLIENT_ID_CHANGED":
    case "TOKEN_EXPIRED":
      return "Reconnect Spotify to renew access.";
    case "DEVELOPMENT_USER_NOT_ALLOWED":
      return "This Spotify account must be added to the app's Development Mode allowlist.";
    case "NETWORK_ERROR":
      return "Check the network connection, then try again.";
    case "NO_ACTIVE_DEVICE":
      return "Open Spotify on a device, then select it below.";
    case "PREMIUM_REQUIRED":
      return "Spotify playback controls require an active Premium account.";
    case "QUOTA_EXCEEDED":
      return "The Spotify Development Mode quota has been reached.";
    case "RATE_LIMITED":
      return error.retryAfterSeconds
        ? `Spotify asked GameHub to wait ${error.retryAfterSeconds} seconds.`
        : "Spotify asked GameHub to wait before trying again.";
    case "REDIRECT_URI_MISMATCH":
      return "The loopback redirect shown in GameHub must exactly match the Spotify app settings.";
    case "RESTRICTED_DEVICE":
      return "This device does not accept Spotify Connect commands. Choose another device.";
    case "SECURE_STORAGE_UNAVAILABLE":
      return "GameHub will not save Spotify authorization without secure credential storage.";
    default:
      return "Try refreshing the Spotify panel.";
  }
};

const errorFromUnknown = (error: unknown): SpotifyProviderError => ({
  code: "UNKNOWN",
  message: error instanceof Error ? error.message : "Spotify did not respond.",
});

const contentIcon = (type: SpotifyContentType, size = 20): ReactNode => {
  if (type === "playlist") {
    return <ListMusic size={size} aria-hidden="true" />;
  }
  if (type === "show" || type === "episode") {
    return <Podcast size={size} aria-hidden="true" />;
  }
  return <Music2 size={size} aria-hidden="true" />;
};

const searchItemsForType = (
  results: SpotifySearchResults,
  type: SpotifyContentType
) => {
  switch (type) {
    case "track":
      return results.tracks.items;
    case "playlist":
      return results.playlists.items;
    case "show":
      return results.shows.items;
    case "episode":
      return results.episodes.items;
  }
};

const canPlayDirectly = (
  item: SpotifyContentItem
): item is SpotifyContentItem & { type: "track" | "playlist" } =>
  item.playable && (item.type === "track" || item.type === "playlist");

const canAddToQueue = (item: SpotifyContentItem) =>
  item.playable && (item.type === "track" || item.type === "episode");

const LoadingState = ({ label }: { label: string }) => (
  <div
    className="spotify-overlay-panel__state"
    role="status"
    aria-live="polite"
  >
    <LoaderCircle
      className="spotify-overlay-panel__spinner"
      size={28}
      aria-hidden="true"
    />
    <strong>{label}</strong>
  </div>
);

const Artwork = ({
  item,
  className,
}: {
  item: SpotifyContentItem;
  className: string;
}) =>
  item.imageUrl ? (
    <img className={className} src={item.imageUrl} alt="" />
  ) : (
    <span className={`${className} ${className}--empty`} aria-hidden="true">
      {contentIcon(item.type, 24)}
    </span>
  );

const SpotifyContentCard = ({
  controlsAvailable,
  item,
  onOpen,
  onPlay,
  onQueue,
  pendingAction,
}: SpotifyContentCardProps) => {
  const playKey = `play:${item.uri}`;
  const queueKey = `queue:${item.uri}`;
  const playPending = pendingAction === playKey;
  const queuePending = pendingAction === queueKey;

  return (
    <article className="spotify-overlay-panel__content-card">
      <Artwork item={item} className="spotify-overlay-panel__content-art" />
      <div className="spotify-overlay-panel__content-copy">
        <strong title={item.title}>{item.title}</strong>
        <span title={item.subtitle}>{item.subtitle}</span>
        {item.itemCount !== null ? (
          <small>
            {item.itemCount} {item.itemCount === 1 ? "item" : "items"}
          </small>
        ) : item.durationMs !== null ? (
          <small>{formatTime(item.durationMs)}</small>
        ) : null}
      </div>
      <div
        className="spotify-overlay-panel__content-actions"
        aria-label={`Actions for ${item.title}`}
      >
        {canPlayDirectly(item) ? (
          <button
            type="button"
            className="spotify-overlay-panel__card-action spotify-overlay-panel__card-action--primary"
            aria-label={`Play ${item.title}`}
            title={
              controlsAvailable
                ? `Play ${item.title}`
                : "Select an available Spotify device first"
            }
            disabled={!controlsAvailable || Boolean(pendingAction)}
            onClick={() => onPlay(item)}
          >
            {playPending ? (
              <LoaderCircle
                className="spotify-overlay-panel__spinner"
                size={15}
                aria-hidden="true"
              />
            ) : (
              <Play size={15} fill="currentColor" aria-hidden="true" />
            )}
          </button>
        ) : null}
        {canAddToQueue(item) ? (
          <button
            type="button"
            className="spotify-overlay-panel__card-action"
            aria-label={`Add ${item.title} to queue`}
            title={
              controlsAvailable
                ? "Add to queue"
                : "Select an available Spotify device first"
            }
            disabled={!controlsAvailable || Boolean(pendingAction)}
            onClick={() => onQueue(item)}
          >
            {queuePending ? (
              <LoaderCircle
                className="spotify-overlay-panel__spinner"
                size={15}
                aria-hidden="true"
              />
            ) : (
              <ListPlus size={15} aria-hidden="true" />
            )}
          </button>
        ) : null}
        {item.externalUrl ? (
          <button
            type="button"
            className="spotify-overlay-panel__card-action"
            aria-label={`Open ${item.title} in Spotify`}
            title="Open in Spotify"
            onClick={() => onOpen(item)}
          >
            <ExternalLink size={14} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </article>
  );
};

export function SpotifyOverlayPanel({
  className = "",
  isActive = true,
  onOpenSettings,
}: SpotifyOverlayPanelProps) {
  const panelId = useId();
  const mountedRef = useRef(true);
  const seekInputRef = useRef<HTMLInputElement>(null);
  const volumeInputRef = useRef<HTMLInputElement>(null);
  const seekTimerRef = useRef<number | null>(null);
  const volumeTimerRef = useRef<number | null>(null);
  const rateLimitBlockedUntilRef = useRef(0);

  const [status, setStatus] = useState<SpotifyStatus | null>(null);
  const [statusLoadState, setStatusLoadState] = useState<LoadState>("loading");
  const [surfaceLoadState, setSurfaceLoadState] = useState<LoadState>("idle");
  const [playback, setPlayback] = useState<SpotifyPlaybackState | null>(null);
  const [devices, setDevices] = useState<SpotifyDevice[]>([]);
  const [queue, setQueue] = useState<SpotifyQueue | null>(null);
  const [home, setHome] = useState<SpotifyHome | null>(null);
  const [requestError, setRequestError] = useState<SpotifyProviderError | null>(
    null
  );
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SpotifyPanelTab>("browse");
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [seekValue, setSeekValue] = useState(0);
  const [volumeValue, setVolumeValue] = useState(100);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchScope, setSearchScope] = useState<SearchScope>("all");
  const [searchResults, setSearchResults] =
    useState<SpotifySearchResults | null>(null);
  const [searchLoadState, setSearchLoadState] = useState<LoadState>("idle");
  const [searchError, setSearchError] = useState<SpotifyProviderError | null>(
    null
  );

  const rememberProviderBackoff = useCallback(
    (providerError: SpotifyProviderError) => {
      if (
        providerError.code !== "RATE_LIMITED" &&
        providerError.code !== "QUOTA_EXCEEDED"
      ) {
        return;
      }
      const fallbackSeconds = providerError.code === "QUOTA_EXCEEDED" ? 60 : 30;
      rateLimitBlockedUntilRef.current = Math.max(
        rateLimitBlockedUntilRef.current,
        Date.now() +
          Math.max(1, providerError.retryAfterSeconds ?? fallbackSeconds) *
            1_000
      );
    },
    []
  );

  const pollingIsRateLimited = useCallback(
    () => Date.now() < rateLimitBlockedUntilRef.current,
    []
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (seekTimerRef.current !== null) {
        window.clearTimeout(seekTimerRef.current);
      }
      if (volumeTimerRef.current !== null) {
        window.clearTimeout(volumeTimerRef.current);
      }
    };
  }, []);

  const loadStatus = useCallback(async () => {
    if (!isActive) return;
    setStatusLoadState("loading");
    setRequestError(null);
    try {
      const nextStatus = await window.electron.spotifyGetStatus();
      if (!mountedRef.current) return;
      setStatus(nextStatus);
      setStatusLoadState("ready");
    } catch (error) {
      if (!mountedRef.current) return;
      setStatusLoadState("error");
      setRequestError(errorFromUnknown(error));
    }
  }, [isActive]);

  const refreshDynamicSurface = useCallback(
    async ({
      devices: includeDevices = true,
      playback: includePlayback = true,
      queue: includeQueue = true,
      showLoading = false,
    }: {
      devices?: boolean;
      playback?: boolean;
      queue?: boolean;
      showLoading?: boolean;
    } = {}) => {
      if (pollingIsRateLimited()) return;
      if (showLoading) setSurfaceLoadState("loading");

      try {
        const [playbackResult, devicesResult, queueResult] = await Promise.all([
          includePlayback
            ? window.electron.spotifyGetPlayback()
            : Promise.resolve(null),
          includeDevices
            ? window.electron.spotifyGetDevices()
            : Promise.resolve(null),
          includeQueue
            ? window.electron.spotifyGetQueue()
            : Promise.resolve(null),
        ]);
        if (!mountedRef.current) return;

        const errors: SpotifyProviderError[] = [];
        if (playbackResult) {
          if (playbackResult.ok) setPlayback(playbackResult.data);
          else errors.push(playbackResult.error);
        }
        if (devicesResult) {
          if (devicesResult.ok) setDevices(devicesResult.data);
          else errors.push(devicesResult.error);
        }
        if (queueResult) {
          if (queueResult.ok) setQueue(queueResult.data);
          else errors.push(queueResult.error);
        }

        if (errors.length) {
          rememberProviderBackoff(errors[0]);
          setRequestError(errors[0]);
          setSurfaceLoadState("error");
        } else {
          // Background polls do not erase a specific playback-command error.
          // Explicit refresh and successful commands clear it instead.
          setRequestError((currentError) =>
            currentError?.code === "RATE_LIMITED" ||
            currentError?.code === "QUOTA_EXCEEDED"
              ? null
              : currentError
          );
          setSurfaceLoadState("ready");
        }
      } catch (error) {
        if (!mountedRef.current) return;
        setRequestError(errorFromUnknown(error));
        setSurfaceLoadState("error");
      }
    },
    [pollingIsRateLimited, rememberProviderBackoff]
  );

  const refreshHome = useCallback(async () => {
    if (pollingIsRateLimited()) return;
    try {
      const result = await window.electron.spotifyGetHome();
      if (!mountedRef.current) return;
      if (result.ok) {
        setHome(result.data);
      } else {
        rememberProviderBackoff(result.error);
        setRequestError(result.error);
      }
    } catch (error) {
      if (mountedRef.current) setRequestError(errorFromUnknown(error));
    }
  }, [pollingIsRateLimited, rememberProviderBackoff]);

  const refreshAll = useCallback(async () => {
    if (pollingIsRateLimited()) return;
    setFeedback(null);
    setRequestError(null);
    await Promise.all([
      refreshDynamicSurface({ showLoading: true }),
      refreshHome(),
    ]);
  }, [pollingIsRateLimited, refreshDynamicSurface, refreshHome]);

  useEffect(() => {
    if (isActive) void loadStatus();
  }, [isActive, loadStatus]);

  useEffect(() => {
    if (!isActive || !status?.connected) return;
    const refreshPlaybackWhenVisible = () => {
      if (document.hidden) return;
      void refreshDynamicSurface({ devices: false, queue: false });
    };
    const refreshSupportingDataWhenVisible = () => {
      if (document.hidden) return;
      void refreshDynamicSurface({ playback: false });
    };
    const refreshWhenVisible = () => {
      if (document.hidden || pollingIsRateLimited()) return;
      setRequestError(null);
      void refreshDynamicSurface({ showLoading: true });
    };

    if (!document.hidden) void refreshAll();
    const playbackIntervalId = window.setInterval(
      refreshPlaybackWhenVisible,
      DYNAMIC_REFRESH_INTERVAL_MS
    );
    const supportingIntervalId = window.setInterval(
      refreshSupportingDataWhenVisible,
      SUPPORTING_REFRESH_INTERVAL_MS
    );
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      window.clearInterval(playbackIntervalId);
      window.clearInterval(supportingIntervalId);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [
    isActive,
    pollingIsRateLimited,
    refreshAll,
    refreshDynamicSurface,
    status?.connected,
  ]);

  useEffect(() => {
    if (
      !isActive ||
      !status?.connected ||
      activeTab !== "queue" ||
      document.hidden
    ) {
      return;
    }
    void refreshDynamicSurface({ devices: false, playback: false });
  }, [activeTab, isActive, refreshDynamicSurface, status?.connected]);

  useEffect(() => {
    const activeDevice = devices.find((device) => device.isActive);
    const currentSelectionIsValid = devices.some(
      (device) => device.id === selectedDeviceId && !device.isRestricted
    );
    if (!currentSelectionIsValid) {
      setSelectedDeviceId(
        (activeDevice && !activeDevice.isRestricted
          ? activeDevice.id
          : undefined) ??
          devices.find((device) => device.id && !device.isRestricted)?.id ??
          ""
      );
    }
  }, [devices, selectedDeviceId]);

  useEffect(() => {
    if (
      seekInputRef.current?.getAttribute("data-controller-editing") !== "true"
    ) {
      setSeekValue(playback?.progressMs ?? 0);
    }
  }, [playback?.item?.uri, playback?.progressMs]);

  useEffect(() => {
    if (
      volumeInputRef.current?.getAttribute("data-controller-editing") !== "true"
    ) {
      setVolumeValue(
        playback?.device?.volumePercent ??
          devices.find((device) => device.isActive)?.volumePercent ??
          100
      );
    }
  }, [devices, playback?.device?.volumePercent]);

  useEffect(() => {
    setVolumeOpen(false);
  }, [activeTab]);

  const activeDevice =
    playback?.device ?? devices.find((device) => device.isActive) ?? null;
  const commandDeviceId = activeDevice?.id || selectedDeviceId || undefined;
  const controlsAvailable = Boolean(activeDevice && !activeDevice.isRestricted);
  const playbackRestricted = Boolean(activeDevice?.isRestricted);
  const disallows = useMemo(
    () => new Set(playback?.disallows ?? []),
    [playback?.disallows]
  );
  const durationMs = Math.max(0, playback?.item?.durationMs ?? 0);
  const visibleError =
    requestError ?? (!status?.connected ? (status?.lastError ?? null) : null);

  const performCommand = useCallback(
    async (
      key: string,
      command: SpotifyPlaybackCommand,
      successMessage?: string
    ) => {
      if (pendingAction || pollingIsRateLimited()) return;
      setPendingAction(key);
      setFeedback(null);
      setRequestError(null);
      try {
        const result = await window.electron.spotifyPlaybackCommand(command);
        if (!mountedRef.current) return;
        if (!result.ok) {
          rememberProviderBackoff(result.error);
          setRequestError(result.error);
          return;
        }
        if (successMessage) setFeedback(successMessage);
        const refreshOptions =
          command.type === "add-to-queue"
            ? { playback: false, devices: false }
            : command.type === "transfer"
              ? {}
              : command.type === "next" ||
                  command.type === "previous" ||
                  command.type === "play-item"
                ? { devices: false }
                : { devices: false, queue: false };
        await refreshDynamicSurface(refreshOptions);
      } catch (error) {
        if (mountedRef.current) setRequestError(errorFromUnknown(error));
      } finally {
        if (mountedRef.current) setPendingAction(null);
      }
    },
    [
      pendingAction,
      pollingIsRateLimited,
      refreshDynamicSurface,
      rememberProviderBackoff,
    ]
  );

  const connect = useCallback(async () => {
    if (pendingAction) return;
    setPendingAction("connect");
    setRequestError(null);
    setFeedback(null);
    try {
      const nextStatus = await window.electron.spotifyLogin();
      if (!mountedRef.current) return;
      setStatus(nextStatus);
      setStatusLoadState("ready");
      if (nextStatus.connected) setFeedback("Spotify connected.");
    } catch (error) {
      if (mountedRef.current) setRequestError(errorFromUnknown(error));
    } finally {
      if (mountedRef.current) setPendingAction(null);
    }
  }, [pendingAction]);

  const transferPlayback = useCallback(() => {
    const target = devices.find((device) => device.id === selectedDeviceId);
    if (!target?.id || target.isRestricted) return;
    void performCommand(
      "transfer",
      {
        type: "transfer",
        deviceId: target.id,
        play: playback?.isPlaying ?? false,
      },
      `Spotify Connect is using ${target.name}.`
    );
  }, [devices, performCommand, playback?.isPlaying, selectedDeviceId]);

  const playItem = useCallback(
    (item: SpotifyContentItem) => {
      if (!canPlayDirectly(item)) return;
      void performCommand(
        `play:${item.uri}`,
        {
          type: "play-item",
          uri: item.uri,
          itemType: item.type,
          deviceId: commandDeviceId,
        },
        `Playing ${item.title}.`
      );
    },
    [commandDeviceId, performCommand]
  );

  const queueItem = useCallback(
    (item: SpotifyContentItem) => {
      void performCommand(
        `queue:${item.uri}`,
        {
          type: "add-to-queue",
          uri: item.uri,
          deviceId: commandDeviceId,
        },
        `${item.title} was added to the queue.`
      );
    },
    [commandDeviceId, performCommand]
  );

  const openItem = useCallback((item: SpotifyContentItem) => {
    if (item.externalUrl) {
      void window.electron.openExternal(item.externalUrl);
    }
  }, []);

  const scheduleSeek = useCallback(
    (positionMs: number) => {
      setSeekValue(positionMs);
      if (seekTimerRef.current !== null) {
        window.clearTimeout(seekTimerRef.current);
      }
      seekTimerRef.current = window.setTimeout(() => {
        seekTimerRef.current = null;
        void performCommand("seek", {
          type: "seek",
          positionMs,
          deviceId: commandDeviceId,
        });
      }, RANGE_COMMIT_DELAY_MS);
    },
    [commandDeviceId, performCommand]
  );

  const scheduleVolume = useCallback(
    (volumePercent: number) => {
      setVolumeValue(volumePercent);
      if (volumeTimerRef.current !== null) {
        window.clearTimeout(volumeTimerRef.current);
      }
      volumeTimerRef.current = window.setTimeout(() => {
        volumeTimerRef.current = null;
        void performCommand("volume", {
          type: "volume",
          volumePercent,
          deviceId: commandDeviceId,
        });
      }, RANGE_COMMIT_DELAY_MS);
    },
    [commandDeviceId, performCommand]
  );

  const submitSearch = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();
      const query = searchQuery.trim();
      if (!query || searchLoadState === "loading" || pollingIsRateLimited()) {
        return;
      }
      setSearchLoadState("loading");
      setSearchError(null);
      try {
        const result = await window.electron.spotifySearch(query);
        if (!mountedRef.current) return;
        if (result.ok) {
          setSearchResults(result.data);
          setSearchLoadState("ready");
        } else {
          rememberProviderBackoff(result.error);
          setSearchError(result.error);
          setSearchLoadState("error");
        }
      } catch (error) {
        if (!mountedRef.current) return;
        setSearchError(errorFromUnknown(error));
        setSearchLoadState("error");
      }
    },
    [
      pollingIsRateLimited,
      rememberProviderBackoff,
      searchLoadState,
      searchQuery,
    ]
  );

  const browseShelves = useMemo<ContentShelf[]>(() => {
    if (!home) return [];
    return [
      {
        id: "highlights",
        title: "Top, recent & saved",
        description:
          "A convenient view of your own Spotify listening and library.",
        items: home.forYou,
        emptyMessage: "Spotify has no personal library highlights to show yet.",
      },
      {
        id: "playlists",
        title: "Your playlists",
        description:
          "Development Mode exposes playlists you own or collaborate on.",
        items: home.playlists.items,
        emptyMessage: "No owned or collaborative playlists were returned.",
      },
      {
        id: "saved-tracks",
        title: "Saved tracks",
        description: "Music saved to your Spotify library.",
        items: home.savedTracks.items,
        emptyMessage: "There are no saved tracks in this account.",
      },
      {
        id: "saved-shows",
        title: "Saved shows",
        description: "Podcasts saved to your Spotify library.",
        items: home.savedShows.items,
        emptyMessage: "There are no saved shows in this account.",
      },
      {
        id: "saved-episodes",
        title: "Saved episodes",
        description: "Podcast episodes saved for later.",
        items: home.savedEpisodes.items,
        emptyMessage: "There are no saved episodes in this account.",
      },
      {
        id: "top-tracks",
        title: "Your top tracks",
        description: "Tracks from your Spotify listening history.",
        items: home.topTracks.items,
        emptyMessage: "Spotify has not returned top tracks for this account.",
      },
      {
        id: "recent",
        title: "Recently played",
        description: "Your recent Spotify listening activity.",
        items: home.recentTracks.items,
        emptyMessage: "There is no recent Spotify playback yet.",
      },
    ];
  }, [home]);

  const visibleSearchGroups = useMemo(
    () =>
      SEARCH_GROUPS.filter(
        (group) => searchScope === "all" || searchScope === group.key
      ),
    [searchScope]
  );

  const searchResultCount = useMemo(() => {
    if (!searchResults) return 0;
    return visibleSearchGroups.reduce(
      (count, group) =>
        count + searchItemsForType(searchResults, group.key).length,
      0
    );
  }, [searchResults, visibleSearchGroups]);

  const handleTabKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
        return;
      }
      event.preventDefault();
      const tabs: SpotifyPanelTab[] = ["browse", "search", "queue"];
      const currentIndex = tabs.indexOf(activeTab);
      const nextIndex =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? tabs.length - 1
            : (currentIndex +
                (event.key === "ArrowRight" ? 1 : -1) +
                tabs.length) %
              tabs.length;
      const nextTab = tabs[nextIndex];
      setActiveTab(nextTab);
      document
        .getElementById(`${panelId}-tab-${nextTab}`)
        ?.focus({ preventScroll: true });
    },
    [activeTab, panelId]
  );

  const renderError = (error: SpotifyProviderError, action?: ReactNode) => (
    <div className="spotify-overlay-panel__error" role="alert">
      <AlertCircle size={19} aria-hidden="true" />
      <div>
        <strong>{error.message}</strong>
        <span>{errorGuidance(error)}</span>
      </div>
      {action}
    </div>
  );

  const renderConnectionState = () => {
    if (statusLoadState === "loading") {
      return <LoadingState label="Checking Spotify connection" />;
    }

    if (statusLoadState === "error" || !status) {
      return (
        <div className="spotify-overlay-panel__state">
          <AlertCircle size={30} aria-hidden="true" />
          <strong>Spotify connection could not be checked</strong>
          <span>Try the connection again.</span>
          <button
            type="button"
            className="spotify-overlay-panel__button spotify-overlay-panel__button--primary"
            onClick={() => void loadStatus()}
          >
            <RefreshCw size={16} aria-hidden="true" />
            Retry
          </button>
        </div>
      );
    }

    if (!status.configured) {
      return (
        <div className="spotify-overlay-panel__state">
          <Settings2 size={30} aria-hidden="true" />
          <strong>Add a Spotify Client ID</strong>
          <span>
            Configure your own Spotify Development Mode app before connecting.
          </span>
          {onOpenSettings ? (
            <button
              type="button"
              className="spotify-overlay-panel__button spotify-overlay-panel__button--primary"
              onClick={onOpenSettings}
            >
              <Settings2 size={16} aria-hidden="true" />
              Open GameHub settings
            </button>
          ) : null}
          <small>Development Mode accounts must be manually allowlisted.</small>
        </div>
      );
    }

    if (status.secureStorage !== "available") {
      return (
        <div className="spotify-overlay-panel__state">
          <AlertCircle size={30} aria-hidden="true" />
          <strong>System keyring is unavailable</strong>
          <span>
            GameHub needs an available operating-system credential vault to
            protect Spotify authorization. Unlock or configure the system
            keyring, then try again.
          </span>
          {onOpenSettings ? (
            <button
              type="button"
              className="spotify-overlay-panel__button"
              onClick={onOpenSettings}
            >
              <Settings2 size={16} aria-hidden="true" />
              Open settings
            </button>
          ) : null}
        </div>
      );
    }

    if (!status.connected || status.needsReauth) {
      const isReconnect = status.needsReauth;
      return (
        <div className="spotify-overlay-panel__state">
          <LogIn size={30} aria-hidden="true" />
          <strong>
            {isReconnect ? "Reconnect Spotify" : "Connect Spotify"}
          </strong>
          <span>
            {isReconnect
              ? "Spotify authorization has expired or changed."
              : "Spotify opens a secure PKCE authorization window."}
          </span>
          {visibleError ? (
            <span className="spotify-overlay-panel__state-error">
              {visibleError.message}
            </span>
          ) : null}
          <button
            type="button"
            className="spotify-overlay-panel__button spotify-overlay-panel__button--primary"
            disabled={pendingAction === "connect"}
            onClick={() => void connect()}
          >
            {pendingAction === "connect" ? (
              <LoaderCircle
                className="spotify-overlay-panel__spinner"
                size={16}
                aria-hidden="true"
              />
            ) : (
              <LogIn size={16} aria-hidden="true" />
            )}
            {isReconnect ? "Reconnect" : "Connect"}
          </button>
          <small>Spotify music playback requires Premium.</small>
        </div>
      );
    }

    return null;
  };

  const connectionState = renderConnectionState();
  const currentItem = playback?.item ?? null;
  const accountName = status?.account?.displayName ?? "Spotify account";
  const currentDeviceName = activeDevice?.name ?? "No active device";
  const shuffleDisabled =
    !controlsAvailable || disallows.has("toggling_shuffle");
  const nextRepeatState =
    playback?.repeatState === "off"
      ? "context"
      : playback?.repeatState === "context"
        ? "track"
        : "off";
  const repeatDisabled =
    !controlsAvailable ||
    (nextRepeatState === "track"
      ? disallows.has("toggling_repeat_track")
      : disallows.has("toggling_repeat_context"));

  return (
    <section
      className={`spotify-overlay-panel ${className}`.trim()}
      aria-label="Spotify Connect"
      aria-busy={
        statusLoadState === "loading" || surfaceLoadState === "loading"
      }
    >
      <header className="spotify-overlay-panel__header">
        <div className="spotify-overlay-panel__attribution">
          <SpotifyIcon
            className="spotify-overlay-panel__spotify-mark"
            aria-hidden="true"
            focusable="false"
          />
          <span>
            <strong>Spotify</strong>
            <small>Connect</small>
          </span>
        </div>
        {status?.connected ? (
          <div className="spotify-overlay-panel__account">
            {status.account?.imageUrl ? (
              <img src={status.account.imageUrl} alt="" />
            ) : (
              <span
                className="spotify-overlay-panel__account-placeholder"
                aria-hidden="true"
              >
                <Headphones size={15} />
              </span>
            )}
            <span title={accountName}>{accountName}</span>
            <button
              type="button"
              className="spotify-overlay-panel__icon-button"
              aria-label="Refresh Spotify"
              title="Refresh Spotify"
              disabled={surfaceLoadState === "loading"}
              onClick={() => void refreshAll()}
            >
              <RefreshCw
                className={
                  surfaceLoadState === "loading"
                    ? "spotify-overlay-panel__spinner"
                    : undefined
                }
                size={15}
                aria-hidden="true"
              />
            </button>
          </div>
        ) : null}
      </header>

      {connectionState ? (
        connectionState
      ) : (
        <>
          <section
            className="spotify-overlay-panel__now-playing"
            aria-label="Spotify now playing"
          >
            <div className="spotify-overlay-panel__now-main">
              {currentItem ? (
                <Artwork
                  item={currentItem}
                  className="spotify-overlay-panel__now-art"
                />
              ) : (
                <span
                  className="spotify-overlay-panel__now-art spotify-overlay-panel__now-art--empty"
                  aria-hidden="true"
                >
                  <Music2 size={30} />
                </span>
              )}
              <div className="spotify-overlay-panel__now-copy">
                <small>Now playing on Spotify</small>
                <strong title={currentItem?.title}>
                  {currentItem?.title ?? "Nothing playing"}
                </strong>
                <span title={currentItem?.subtitle}>
                  {currentItem?.subtitle ??
                    "Start playback in Spotify or choose from your library."}
                </span>
                {currentItem?.externalUrl ? (
                  <button
                    type="button"
                    className="spotify-overlay-panel__text-action"
                    onClick={() => openItem(currentItem)}
                  >
                    Open in Spotify
                    <ExternalLink size={12} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </div>

            <div className="spotify-overlay-panel__device">
              <label htmlFor={`${panelId}-device`}>
                Spotify Connect device
              </label>
              <div className="spotify-overlay-panel__device-controls">
                <OverlaySelect
                  ariaLabel="Spotify Connect device"
                  value={selectedDeviceId}
                  disabled={!devices.length || Boolean(pendingAction)}
                  onChange={(deviceId) => setSelectedDeviceId(deviceId)}
                  options={
                    devices.length
                      ? devices.map((device) => ({
                          value: device.id ?? "",
                          label: `${device.name}${
                            device.isActive ? " — active" : ""
                          }${device.isRestricted ? " — restricted" : ""}`,
                          disabled: !device.id || device.isRestricted,
                        }))
                      : [{ value: "", label: "No devices found" }]
                  }
                />
                <button
                  type="button"
                  className="spotify-overlay-panel__button"
                  disabled={
                    !selectedDeviceId ||
                    Boolean(pendingAction) ||
                    selectedDeviceId === activeDevice?.id
                  }
                  onClick={transferPlayback}
                >
                  {pendingAction === "transfer" ? (
                    <LoaderCircle
                      className="spotify-overlay-panel__spinner"
                      size={15}
                      aria-hidden="true"
                    />
                  ) : (
                    <Headphones size={15} aria-hidden="true" />
                  )}
                  Use device
                </button>
              </div>
              <small>
                {playbackRestricted
                  ? `${currentDeviceName} does not accept remote controls.`
                  : devices.length
                    ? `Active: ${currentDeviceName}`
                    : "Open the Spotify app on a device, then refresh."}
              </small>
            </div>

            <label className="spotify-overlay-panel__progress">
              <span className="spotify-overlay-panel__sr-only">
                Track position
              </span>
              <input
                ref={seekInputRef}
                type="range"
                min={0}
                max={Math.max(1, durationMs)}
                step={5_000}
                value={Math.min(durationMs || 1, seekValue)}
                disabled={
                  !currentItem ||
                  durationMs <= 0 ||
                  !controlsAvailable ||
                  disallows.has("seeking")
                }
                onChange={(event) =>
                  scheduleSeek(Number(event.currentTarget.value))
                }
              />
              <span className="spotify-overlay-panel__progress-time">
                <small>{formatTime(seekValue)}</small>
                <small>{formatTime(durationMs)}</small>
              </span>
            </label>

            <div className="spotify-overlay-panel__transport">
              <button
                type="button"
                className={`spotify-overlay-panel__mode-button ${
                  playback?.shuffleState ? "is-active" : ""
                }`}
                aria-label={
                  playback?.shuffleState
                    ? "Turn shuffle off"
                    : "Turn shuffle on"
                }
                aria-pressed={playback?.shuffleState ?? false}
                disabled={shuffleDisabled || Boolean(pendingAction)}
                onClick={() =>
                  void performCommand("shuffle", {
                    type: "shuffle",
                    enabled: !playback?.shuffleState,
                    deviceId: commandDeviceId,
                  })
                }
              >
                <Shuffle size={17} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="spotify-overlay-panel__transport-button"
                aria-label="Previous track"
                disabled={
                  !controlsAvailable ||
                  disallows.has("skipping_prev") ||
                  Boolean(pendingAction)
                }
                onClick={() =>
                  void performCommand("previous", {
                    type: "previous",
                    deviceId: commandDeviceId,
                  })
                }
              >
                <SkipBack size={19} fill="currentColor" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="spotify-overlay-panel__play-button"
                data-controller-default
                aria-label={playback?.isPlaying ? "Pause" : "Play"}
                disabled={
                  !currentItem ||
                  !controlsAvailable ||
                  (playback?.isPlaying
                    ? disallows.has("pausing")
                    : disallows.has("resuming")) ||
                  Boolean(pendingAction)
                }
                onClick={() =>
                  void performCommand(playback?.isPlaying ? "pause" : "play", {
                    type: playback?.isPlaying ? "pause" : "play",
                    deviceId: commandDeviceId,
                  })
                }
              >
                {pendingAction === "play" || pendingAction === "pause" ? (
                  <LoaderCircle
                    className="spotify-overlay-panel__spinner"
                    size={20}
                    aria-hidden="true"
                  />
                ) : playback?.isPlaying ? (
                  <Pause size={20} fill="currentColor" aria-hidden="true" />
                ) : (
                  <Play size={20} fill="currentColor" aria-hidden="true" />
                )}
              </button>
              <button
                type="button"
                className="spotify-overlay-panel__transport-button"
                aria-label="Next track"
                disabled={
                  !controlsAvailable ||
                  disallows.has("skipping_next") ||
                  Boolean(pendingAction)
                }
                onClick={() =>
                  void performCommand("next", {
                    type: "next",
                    deviceId: commandDeviceId,
                  })
                }
              >
                <SkipForward size={19} fill="currentColor" aria-hidden="true" />
              </button>
              <button
                type="button"
                className={`spotify-overlay-panel__mode-button ${
                  playback?.repeatState !== "off" ? "is-active" : ""
                }`}
                aria-label={`Repeat is ${playback?.repeatState ?? "off"}. Change repeat mode`}
                disabled={repeatDisabled || Boolean(pendingAction)}
                onClick={() => {
                  void performCommand("repeat", {
                    type: "repeat",
                    state: nextRepeatState,
                    deviceId: commandDeviceId,
                  });
                }}
              >
                {playback?.repeatState === "track" ? (
                  <Repeat1 size={17} aria-hidden="true" />
                ) : (
                  <Repeat size={17} aria-hidden="true" />
                )}
              </button>
              <div className="spotify-overlay-panel__volume">
                <button
                  type="button"
                  className={`spotify-overlay-panel__mode-button ${
                    volumeOpen ? "is-active" : ""
                  }`}
                  aria-label={
                    volumeOpen
                      ? "Close Spotify volume control"
                      : `Open Spotify volume control, ${Math.round(volumeValue)} percent`
                  }
                  aria-expanded={volumeOpen}
                  aria-controls={`${panelId}-volume`}
                  disabled={
                    !controlsAvailable || activeDevice?.supportsVolume === false
                  }
                  onBlur={(event) => {
                    const nextTarget = event.relatedTarget;
                    const volumeControl = event.currentTarget.closest(
                      ".spotify-overlay-panel__volume"
                    );
                    if (
                      !(nextTarget instanceof Node) ||
                      !volumeControl?.contains(nextTarget)
                    ) {
                      setVolumeOpen(false);
                    }
                  }}
                  onClick={() => setVolumeOpen((open) => !open)}
                  onKeyDown={(event) => {
                    if (event.key !== "Escape") return;
                    event.stopPropagation();
                    setVolumeOpen(false);
                  }}
                >
                  {volumeValue <= 0 ? (
                    <VolumeX size={17} aria-hidden="true" />
                  ) : (
                    <Volume2 size={17} aria-hidden="true" />
                  )}
                </button>
                {volumeOpen ? (
                  <label
                    id={`${panelId}-volume`}
                    className="spotify-overlay-panel__volume-popover"
                  >
                    <Volume2 size={15} aria-hidden="true" />
                    <span className="spotify-overlay-panel__sr-only">
                      Spotify volume
                    </span>
                    <input
                      ref={volumeInputRef}
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={volumeValue}
                      onBlur={(event) => {
                        const nextTarget = event.relatedTarget;
                        const volumeControl = event.currentTarget.closest(
                          ".spotify-overlay-panel__volume"
                        );
                        if (
                          !(nextTarget instanceof Node) ||
                          !volumeControl?.contains(nextTarget)
                        ) {
                          setVolumeOpen(false);
                        }
                      }}
                      onChange={(event) =>
                        scheduleVolume(Number(event.currentTarget.value))
                      }
                      onKeyDown={(event) => {
                        if (event.key !== "Escape") return;
                        event.stopPropagation();
                        setVolumeOpen(false);
                      }}
                    />
                    <span>{Math.round(volumeValue)}%</span>
                  </label>
                ) : null}
              </div>
            </div>
          </section>

          {visibleError
            ? renderError(
                visibleError,
                RECONNECT_ERROR_CODES.has(visibleError.code) ? (
                  <button
                    type="button"
                    className="spotify-overlay-panel__button"
                    disabled={Boolean(pendingAction)}
                    onClick={() => void connect()}
                  >
                    <LogIn size={15} aria-hidden="true" />
                    Reconnect
                  </button>
                ) : (
                  <button
                    type="button"
                    className="spotify-overlay-panel__button"
                    disabled={surfaceLoadState === "loading"}
                    onClick={() => void refreshAll()}
                  >
                    <RefreshCw size={15} aria-hidden="true" />
                    Retry
                  </button>
                )
              )
            : null}

          <p
            className="spotify-overlay-panel__feedback"
            role="status"
            aria-live="polite"
          >
            {feedback ? (
              <>
                <CheckCircle2 size={14} aria-hidden="true" />
                {feedback}
              </>
            ) : null}
          </p>

          <div
            className="spotify-overlay-panel__tabs"
            role="tablist"
            aria-label="Spotify sections"
          >
            <span
              className="overlay-tab-bumper overlay-tab-bumper--left"
              aria-hidden="true"
              title="Previous tab (LB)"
            >
              LB
            </span>
            {(
              [
                ["browse", "Browse", <Library key="browse" size={15} />],
                ["search", "Search", <Search key="search" size={15} />],
                ["queue", "Queue", <ListMusic key="queue" size={15} />],
              ] as Array<[SpotifyPanelTab, string, ReactNode]>
            ).map(([tab, label, icon]) => (
              <button
                key={tab}
                type="button"
                id={`${panelId}-tab-${tab}`}
                className={`spotify-overlay-panel__tab ${
                  activeTab === tab ? "is-active" : ""
                }`}
                role="tab"
                aria-selected={activeTab === tab}
                aria-controls={`${panelId}-panel-${tab}`}
                tabIndex={activeTab === tab ? 0 : -1}
                onClick={() => setActiveTab(tab)}
                onKeyDown={handleTabKeyDown}
              >
                {icon}
                {label}
                {tab === "queue" && queue?.queue.length ? (
                  <span>{queue.queue.length}</span>
                ) : null}
              </button>
            ))}
            <span
              className="overlay-tab-bumper overlay-tab-bumper--right"
              aria-hidden="true"
              title="Next tab (RB)"
            >
              RB
            </span>
          </div>

          <div className="spotify-overlay-panel__tab-content">
            {activeTab === "browse" ? (
              <div
                id={`${panelId}-panel-browse`}
                role="tabpanel"
                aria-labelledby={`${panelId}-tab-browse`}
                className="spotify-overlay-panel__browse"
              >
                {surfaceLoadState === "loading" && !home ? (
                  <LoadingState label="Loading your Spotify library" />
                ) : browseShelves.length ? (
                  browseShelves.map((shelf) => (
                    <section
                      key={shelf.id}
                      className="spotify-overlay-panel__shelf"
                      aria-labelledby={`${panelId}-shelf-${shelf.id}`}
                    >
                      <header>
                        <div>
                          <h3 id={`${panelId}-shelf-${shelf.id}`}>
                            {shelf.title}
                          </h3>
                          <p>{shelf.description}</p>
                        </div>
                        <span>{shelf.items.length}</span>
                      </header>
                      {shelf.items.length ? (
                        <div className="spotify-overlay-panel__content-grid">
                          {shelf.items.map((item) => (
                            <SpotifyContentCard
                              key={`${shelf.id}:${item.uri}`}
                              item={item}
                              controlsAvailable={controlsAvailable}
                              pendingAction={pendingAction}
                              onPlay={playItem}
                              onQueue={queueItem}
                              onOpen={openItem}
                            />
                          ))}
                        </div>
                      ) : (
                        <p className="spotify-overlay-panel__empty-row">
                          {shelf.emptyMessage}
                        </p>
                      )}
                    </section>
                  ))
                ) : (
                  <div className="spotify-overlay-panel__state">
                    <Library size={28} aria-hidden="true" />
                    <strong>Your Spotify library is empty</strong>
                    <span>
                      Save tracks, shows, episodes, or create a playlist in
                      Spotify.
                    </span>
                  </div>
                )}
              </div>
            ) : null}

            {activeTab === "search" ? (
              <div
                id={`${panelId}-panel-search`}
                role="tabpanel"
                aria-labelledby={`${panelId}-tab-search`}
                className="spotify-overlay-panel__search"
              >
                <form
                  className="spotify-overlay-panel__search-form"
                  onSubmit={(event) => void submitSearch(event)}
                >
                  <label>
                    <span className="spotify-overlay-panel__sr-only">
                      Search Spotify
                    </span>
                    <Search size={16} aria-hidden="true" />
                    <input
                      type="search"
                      value={searchQuery}
                      placeholder="Search Spotify"
                      autoComplete="off"
                      onChange={(event) =>
                        setSearchQuery(event.currentTarget.value)
                      }
                    />
                  </label>
                  <OverlaySelect
                    ariaLabel="Spotify search result type"
                    value={searchScope}
                    onChange={(scope) => setSearchScope(scope as SearchScope)}
                    options={[
                      { value: "all", label: "All results" },
                      { value: "track", label: "Tracks" },
                      { value: "playlist", label: "Playlists" },
                      { value: "show", label: "Shows" },
                      { value: "episode", label: "Episodes" },
                    ]}
                  />
                  <button
                    type="submit"
                    className="spotify-overlay-panel__button spotify-overlay-panel__button--primary"
                    disabled={
                      !searchQuery.trim() || searchLoadState === "loading"
                    }
                  >
                    {searchLoadState === "loading" ? (
                      <LoaderCircle
                        className="spotify-overlay-panel__spinner"
                        size={16}
                        aria-hidden="true"
                      />
                    ) : (
                      <Search size={16} aria-hidden="true" />
                    )}
                    Search
                  </button>
                </form>

                {searchError ? (
                  renderError(
                    searchError,
                    <button
                      type="button"
                      className="spotify-overlay-panel__button"
                      onClick={() => void submitSearch()}
                    >
                      <RefreshCw size={15} aria-hidden="true" />
                      Retry search
                    </button>
                  )
                ) : searchLoadState === "loading" ? (
                  <LoadingState label="Searching Spotify" />
                ) : searchResults && searchResultCount === 0 ? (
                  <div className="spotify-overlay-panel__state">
                    <Search size={28} aria-hidden="true" />
                    <strong>No Spotify results</strong>
                    <span>
                      Try a different title, artist, playlist, show, or episode.
                    </span>
                  </div>
                ) : searchResults ? (
                  <div className="spotify-overlay-panel__search-results">
                    {visibleSearchGroups.map((group) => {
                      const items = searchItemsForType(
                        searchResults,
                        group.key
                      );
                      if (!items.length) return null;
                      return (
                        <section
                          key={group.key}
                          className="spotify-overlay-panel__shelf"
                          aria-labelledby={`${panelId}-search-${group.key}`}
                        >
                          <header>
                            <h3 id={`${panelId}-search-${group.key}`}>
                              {group.title}
                            </h3>
                            <span>{items.length}</span>
                          </header>
                          <div className="spotify-overlay-panel__content-grid">
                            {items.map((item) => (
                              <SpotifyContentCard
                                key={`search:${item.uri}`}
                                item={item}
                                controlsAvailable={controlsAvailable}
                                pendingAction={pendingAction}
                                onPlay={playItem}
                                onQueue={queueItem}
                                onOpen={openItem}
                              />
                            ))}
                          </div>
                        </section>
                      );
                    })}
                  </div>
                ) : (
                  <div className="spotify-overlay-panel__state">
                    <Search size={28} aria-hidden="true" />
                    <strong>Search Spotify</strong>
                    <span>
                      Find tracks, playlists, shows, and podcast episodes.
                    </span>
                  </div>
                )}
              </div>
            ) : null}

            {activeTab === "queue" ? (
              <div
                id={`${panelId}-panel-queue`}
                role="tabpanel"
                aria-labelledby={`${panelId}-tab-queue`}
                className="spotify-overlay-panel__queue"
              >
                {queue?.currentlyPlaying ? (
                  <section
                    className="spotify-overlay-panel__queue-current"
                    aria-labelledby={`${panelId}-queue-current`}
                  >
                    <header>
                      <h3 id={`${panelId}-queue-current`}>Playing now</h3>
                    </header>
                    <SpotifyContentCard
                      item={queue.currentlyPlaying}
                      controlsAvailable={controlsAvailable}
                      pendingAction={pendingAction}
                      onPlay={playItem}
                      onQueue={queueItem}
                      onOpen={openItem}
                    />
                  </section>
                ) : null}

                {queue?.queue.length ? (
                  <section
                    className="spotify-overlay-panel__queue-up-next"
                    aria-labelledby={`${panelId}-queue-next`}
                  >
                    <header>
                      <h3 id={`${panelId}-queue-next`}>Up next</h3>
                      <span>{queue.queue.length}</span>
                    </header>
                    <ol>
                      {queue.queue.map((item, index) => (
                        <li key={`${item.uri}:${index}`}>
                          <span className="spotify-overlay-panel__queue-index">
                            {index + 1}
                          </span>
                          <Artwork
                            item={item}
                            className="spotify-overlay-panel__queue-art"
                          />
                          <span className="spotify-overlay-panel__queue-copy">
                            <strong title={item.title}>{item.title}</strong>
                            <small title={item.subtitle}>{item.subtitle}</small>
                          </span>
                          {canPlayDirectly(item) ? (
                            <button
                              type="button"
                              className="spotify-overlay-panel__card-action spotify-overlay-panel__card-action--primary"
                              aria-label={`Play ${item.title} now`}
                              disabled={
                                !controlsAvailable || Boolean(pendingAction)
                              }
                              onClick={() => playItem(item)}
                            >
                              <Play
                                size={14}
                                fill="currentColor"
                                aria-hidden="true"
                              />
                            </button>
                          ) : null}
                          {item.externalUrl ? (
                            <button
                              type="button"
                              className="spotify-overlay-panel__card-action"
                              aria-label={`Open ${item.title} in Spotify`}
                              onClick={() => openItem(item)}
                            >
                              <ExternalLink size={14} aria-hidden="true" />
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                  </section>
                ) : (
                  <div className="spotify-overlay-panel__state">
                    <ListMusic size={28} aria-hidden="true" />
                    <strong>The Spotify queue is empty</strong>
                    <span>
                      Add a track or episode from Browse or Search. Spotify does
                      not expose queue removal through this API.
                    </span>
                  </div>
                )}
              </div>
            ) : null}
          </div>

          <footer className="spotify-overlay-panel__footer">
            <span>
              Spotify content stays separate from GameHub Music. Playback is
              controlled through Spotify Connect.
            </span>
            <span
              className="spotify-overlay-panel__footer-divider"
              aria-hidden="true"
            />
            <Clock3 size={13} aria-hidden="true" />
            <span>Development Mode</span>
          </footer>
        </>
      )}
    </section>
  );
}

export default SpotifyOverlayPanel;
