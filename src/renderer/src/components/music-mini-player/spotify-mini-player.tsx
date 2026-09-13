import {
  Bookmark,
  ExternalLink,
  Library,
  ListMusic,
  LoaderCircle,
  MonitorSpeaker,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Repeat,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  X,
} from "lucide-react";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  SpotifyContentItem,
  SpotifyDevice,
  SpotifyHome,
  SpotifyPage,
  SpotifyPlaybackCommand,
  SpotifyPlaybackState,
  SpotifyProviderError,
  SpotifyQueue,
  SpotifySearchResults,
} from "@types";
import SpotifyIcon from "@renderer/assets/icons/spotify.svg?react";

import "./spotify-mini-player.scss";

type SpotifyPlayerView = "home" | "search" | "queue";

interface SpotifyMiniPlayerProps {
  onConnectionLost?: () => void;
}

interface ContentListProps {
  title: string;
  items: SpotifyContentItem[];
  savedUris: ReadonlySet<string>;
  remoteDisabled: boolean;
  onPlay: (item: SpotifyContentItem) => void;
  onQueue: (item: SpotifyContentItem) => void;
  onToggleSaved: (item: SpotifyContentItem) => void;
  onPlaylistItems: (item: SpotifyContentItem) => void;
}

const SPOTIFY_WEB_URL = "https://open.spotify.com/";
const SEEK_COMMIT_DELAY_MS = 450;
const VOLUME_COMMIT_DELAY_MS = 350;
const OPEN_POLL_INTERVAL_MS = 3000;
const CLOSED_POLL_INTERVAL_MS = 7000;
const DEFAULT_RATE_LIMIT_SECONDS = 30;
const DEFAULT_QUOTA_LIMIT_SECONDS = 60;
const RANGE_COMMIT_KEYS = new Set([
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "End",
  "Home",
  "PageDown",
  "PageUp",
]);

const formatTime = (milliseconds: number) => {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

const isDocumentVisible = () =>
  document.visibilityState === "visible" && !document.hidden;

const canBrowsePlaylistItems = (item: SpotifyContentItem) =>
  item.type === "playlist" && item.canBrowseItems === true;

const getExternalUrl = (item: SpotifyContentItem) =>
  item.externalUrl ??
  (item.type === "playlist"
    ? `${SPOTIFY_WEB_URL}playlist/${encodeURIComponent(item.id)}`
    : null);

function ContentIdentity({ item }: Readonly<{ item: SpotifyContentItem }>) {
  return (
    <>
      {item.imageUrl ? (
        <img src={item.imageUrl} alt="" />
      ) : (
        <span className="spotify-mini-player__result-placeholder">
          <SpotifyIcon aria-hidden="true" />
        </span>
      )}
      <span>
        <strong>{item.title}</strong>
        <small>
          {item.subtitle || item.type}
          {item.explicit ? " · Explicit" : ""}
        </small>
      </span>
    </>
  );
}

function ContentList({
  title,
  items,
  savedUris,
  remoteDisabled,
  onPlay,
  onQueue,
  onToggleSaved,
  onPlaylistItems,
}: Readonly<ContentListProps>) {
  if (items.length === 0) return null;

  return (
    <section className="spotify-mini-player__shelf">
      <h3>{title}</h3>
      <ul>
        {items.map((item) => {
          const playlistItemsReadable = canBrowsePlaylistItems(item);
          const externalUrl = getExternalUrl(item);

          return (
            <li key={`${item.type}:${item.id}`}>
              {item.type === "track" || item.type === "playlist" ? (
                <button
                  type="button"
                  className="spotify-mini-player__result-main"
                  onClick={() => onPlay(item)}
                  aria-label={`Play ${item.title} on Spotify`}
                  disabled={remoteDisabled}
                >
                  <ContentIdentity item={item} />
                </button>
              ) : (
                <div className="spotify-mini-player__result-main">
                  <ContentIdentity item={item} />
                </div>
              )}
              <span className="spotify-mini-player__result-actions">
                {playlistItemsReadable && (
                  <button
                    type="button"
                    aria-label={`Browse ${item.title}`}
                    title="Browse playlist items"
                    disabled={remoteDisabled}
                    onClick={() => onPlaylistItems(item)}
                  >
                    <ListMusic size={14} aria-hidden="true" />
                  </button>
                )}
                {(item.type === "track" || item.type === "episode") && (
                  <button
                    type="button"
                    aria-label={`Add ${item.title} to Spotify queue`}
                    title="Add to Spotify queue"
                    disabled={remoteDisabled}
                    onClick={() => onQueue(item)}
                  >
                    <Plus size={14} aria-hidden="true" />
                  </button>
                )}
                {item.type !== "playlist" && (
                  <button
                    type="button"
                    className={
                      savedUris.has(item.uri)
                        ? "spotify-mini-player__result-action--active"
                        : undefined
                    }
                    aria-label={`${
                      savedUris.has(item.uri) ? "Remove" : "Save"
                    } ${item.title} ${
                      savedUris.has(item.uri) ? "from" : "to"
                    } Spotify library`}
                    title={
                      savedUris.has(item.uri)
                        ? "Remove from Spotify library"
                        : "Save to Spotify library"
                    }
                    disabled={remoteDisabled}
                    onClick={() => onToggleSaved(item)}
                  >
                    <Bookmark
                      size={14}
                      fill={savedUris.has(item.uri) ? "currentColor" : "none"}
                      aria-hidden="true"
                    />
                  </button>
                )}
                {externalUrl &&
                  (item.type !== "playlist" || !playlistItemsReadable) && (
                    <button
                      type="button"
                      aria-label={`Open ${item.title} in Spotify`}
                      title="Open in Spotify"
                      onClick={() =>
                        void window.electron.openExternal(externalUrl)
                      }
                    >
                      <ExternalLink size={14} aria-hidden="true" />
                    </button>
                  )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function SpotifyMiniPlayer({
  onConnectionLost,
}: Readonly<SpotifyMiniPlayerProps>) {
  const [isOpen, setIsOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isPanelFocused, setIsPanelFocused] = useState(false);
  const [pageVisible, setPageVisible] = useState(isDocumentVisible);
  const [view, setView] = useState<SpotifyPlayerView>("home");
  const [playback, setPlayback] = useState<SpotifyPlaybackState | null>(null);
  const [devices, setDevices] = useState<SpotifyDevice[]>([]);
  const [home, setHome] = useState<SpotifyHome | null>(null);
  const [queue, setQueue] = useState<SpotifyQueue | null>(null);
  const [searchResults, setSearchResults] =
    useState<SpotifySearchResults | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [playlistTitle, setPlaylistTitle] = useState("");
  const [playlistId, setPlaylistId] = useState<string | null>(null);
  const [playlistPage, setPlaylistPage] =
    useState<SpotifyPage<SpotifyContentItem> | null>(null);
  const [showVolume, setShowVolume] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<SpotifyProviderError | null>(null);
  const [savedUris, setSavedUris] = useState<Set<string>>(new Set());
  const [retryUntil, setRetryUntil] = useState<number | null>(null);
  const [retryNow, setRetryNow] = useState(Date.now);
  const [seekDraftMs, setSeekDraftMs] = useState<number | null>(null);
  const [volumeDraftPercent, setVolumeDraftPercent] = useState<number | null>(
    null
  );
  const panelRef = useRef<HTMLElement | null>(null);
  const pollInFlightRef = useRef(false);
  const pageVisibleRef = useRef(pageVisible);
  const retryUntilRef = useRef<number | null>(null);
  const seekDraftRef = useRef<number | null>(null);
  const volumeDraftRef = useRef<number | null>(null);
  const seekCommitTimerRef = useRef<number | null>(null);
  const volumeCommitTimerRef = useRef<number | null>(null);
  const commandRefreshTimerRef = useRef<number | null>(null);
  const libraryLookupGenerationRef = useRef(0);
  const panelVisible = isOpen || isHovered || isPanelFocused;
  const retrySecondsRemaining = retryUntil
    ? Math.max(0, Math.ceil((retryUntil - retryNow) / 1000))
    : 0;
  const backoffActive = retrySecondsRemaining > 0;
  const remoteDisabled = loading || backoffActive;

  const hasActiveBackoff = useCallback(
    () => (retryUntilRef.current ?? 0) > Date.now(),
    []
  );

  const clearExpiredBackoff = useCallback(() => {
    if (retryUntilRef.current !== null && retryUntilRef.current <= Date.now()) {
      retryUntilRef.current = null;
      setRetryUntil(null);
    }
  }, []);

  const clearErrorAfterSuccess = useCallback(() => {
    clearExpiredBackoff();
    if (!hasActiveBackoff()) setError(null);
  }, [clearExpiredBackoff, hasActiveBackoff]);

  useEffect(() => {
    const syncVisibility = () => {
      const visible = isDocumentVisible();
      pageVisibleRef.current = visible;
      setPageVisible(visible);
    };
    const markHidden = () => {
      pageVisibleRef.current = false;
      setPageVisible(false);
    };

    document.addEventListener("visibilitychange", syncVisibility);
    window.addEventListener("pageshow", syncVisibility);
    window.addEventListener("pagehide", markHidden);
    syncVisibility();

    return () => {
      document.removeEventListener("visibilitychange", syncVisibility);
      window.removeEventListener("pageshow", syncVisibility);
      window.removeEventListener("pagehide", markHidden);
    };
  }, []);

  useEffect(() => {
    panelRef.current?.toggleAttribute("inert", !panelVisible);
  }, [panelVisible]);

  useEffect(() => {
    if (!retryUntil || !pageVisible) return;

    const updateClock = () => {
      const now = Date.now();
      setRetryNow(now);
      if (retryUntil <= now) {
        clearExpiredBackoff();
      }
    };

    updateClock();
    const interval = window.setInterval(updateClock, 1000);
    return () => window.clearInterval(interval);
  }, [clearExpiredBackoff, pageVisible, retryUntil]);

  const handleError = useCallback(
    (providerError: SpotifyProviderError) => {
      setError(providerError);
      const structuredDelay =
        typeof providerError.retryAfterSeconds === "number" &&
        Number.isFinite(providerError.retryAfterSeconds) &&
        providerError.retryAfterSeconds > 0
          ? Math.ceil(providerError.retryAfterSeconds)
          : null;
      const fallbackDelay =
        providerError.code === "RATE_LIMITED"
          ? DEFAULT_RATE_LIMIT_SECONDS
          : providerError.code === "QUOTA_EXCEEDED"
            ? DEFAULT_QUOTA_LIMIT_SECONDS
            : null;
      const retryDelay = structuredDelay ?? fallbackDelay;

      if (retryDelay !== null) {
        const nextRetryAt = Date.now() + retryDelay * 1000;
        const effectiveRetryAt = Math.max(
          retryUntilRef.current ?? 0,
          nextRetryAt
        );
        retryUntilRef.current = effectiveRetryAt;
        setRetryNow(Date.now());
        setRetryUntil(effectiveRetryAt);
      }

      if (
        providerError.code === "AUTH_REQUIRED" ||
        providerError.code === "TOKEN_EXPIRED" ||
        providerError.code === "CLIENT_ID_CHANGED"
      ) {
        onConnectionLost?.();
      }
    },
    [onConnectionLost]
  );

  const refreshPlayback = useCallback(
    async (quiet = false) => {
      if (
        pollInFlightRef.current ||
        !pageVisibleRef.current ||
        hasActiveBackoff()
      ) {
        return;
      }
      pollInFlightRef.current = true;
      try {
        const result = await window.electron.spotifyGetPlayback();
        if (result.ok) {
          const wasBackedOff = retryUntilRef.current !== null;
          clearExpiredBackoff();
          setPlayback(result.data);
          if (!quiet || wasBackedOff) setError(null);
        } else {
          handleError(result.error);
        }
      } finally {
        pollInFlightRef.current = false;
      }
    },
    [clearExpiredBackoff, handleError, hasActiveBackoff]
  );

  const refreshDevices = useCallback(async () => {
    if (!pageVisibleRef.current || hasActiveBackoff()) return;
    const result = await window.electron.spotifyGetDevices();
    if (result.ok) {
      clearExpiredBackoff();
      setDevices(result.data);
    } else {
      handleError(result.error);
    }
  }, [clearExpiredBackoff, handleError, hasActiveBackoff]);

  const loadHome = useCallback(async () => {
    if (!pageVisibleRef.current || hasActiveBackoff()) return;
    setLoading(true);
    const result = await window.electron.spotifyGetHome();
    setLoading(false);
    if (!result.ok) {
      handleError(result.error);
      return;
    }
    setHome(result.data);
    clearErrorAfterSuccess();
    setSavedUris((current) => {
      const next = new Set(current);
      [
        ...result.data.savedTracks.items.map((item) => item.uri),
        ...result.data.savedShows.items.map((item) => item.uri),
        ...result.data.savedEpisodes.items.map((item) => item.uri),
      ].forEach((uri) => next.add(uri));
      return next;
    });
  }, [clearErrorAfterSuccess, handleError, hasActiveBackoff]);

  const loadQueue = useCallback(async () => {
    if (!pageVisibleRef.current || hasActiveBackoff()) return;
    setLoading(true);
    const result = await window.electron.spotifyGetQueue();
    setLoading(false);
    if (result.ok) {
      setQueue(result.data);
      clearErrorAfterSuccess();
    } else {
      handleError(result.error);
    }
  }, [clearErrorAfterSuccess, handleError, hasActiveBackoff]);

  useEffect(() => {
    if (!pageVisible) return;

    let cancelled = false;
    let pollTimer: number | null = null;

    const schedule = (delay: number, quiet: boolean) => {
      pollTimer = window.setTimeout(() => {
        void runPoll(quiet);
      }, delay);
    };

    const runPoll = async (quiet: boolean) => {
      if (cancelled || !pageVisibleRef.current) return;

      const backoffDelay = Math.max(
        0,
        (retryUntilRef.current ?? 0) - Date.now()
      );
      if (backoffDelay > 0) {
        schedule(backoffDelay, true);
        return;
      }

      await refreshPlayback(quiet);
      if (cancelled || !pageVisibleRef.current) return;

      const nextBackoffDelay = Math.max(
        0,
        (retryUntilRef.current ?? 0) - Date.now()
      );
      schedule(
        Math.max(
          panelVisible ? OPEN_POLL_INTERVAL_MS : CLOSED_POLL_INTERVAL_MS,
          nextBackoffDelay
        ),
        true
      );
    };

    void runPoll(false);
    return () => {
      cancelled = true;
      if (pollTimer !== null) window.clearTimeout(pollTimer);
    };
  }, [pageVisible, panelVisible, refreshPlayback, retryUntil]);

  useEffect(() => {
    if (!pageVisible || hasActiveBackoff()) return;
    void refreshDevices();
  }, [hasActiveBackoff, pageVisible, refreshDevices, retryUntil]);

  useEffect(() => {
    if (!pageVisible || !panelVisible || hasActiveBackoff()) return;
    if (view === "home" && !home) void loadHome();
    if (view === "queue") void loadQueue();
  }, [
    hasActiveBackoff,
    home,
    loadHome,
    loadQueue,
    pageVisible,
    panelVisible,
    retryUntil,
    view,
  ]);

  useEffect(() => {
    if (pageVisible) return;

    if (seekCommitTimerRef.current !== null) {
      window.clearTimeout(seekCommitTimerRef.current);
      seekCommitTimerRef.current = null;
    }
    if (volumeCommitTimerRef.current !== null) {
      window.clearTimeout(volumeCommitTimerRef.current);
      volumeCommitTimerRef.current = null;
    }
    if (commandRefreshTimerRef.current !== null) {
      window.clearTimeout(commandRefreshTimerRef.current);
      commandRefreshTimerRef.current = null;
    }
    seekDraftRef.current = null;
    volumeDraftRef.current = null;
    setSeekDraftMs(null);
    setVolumeDraftPercent(null);
    libraryLookupGenerationRef.current += 1;
  }, [pageVisible]);

  useEffect(
    () => () => {
      if (seekCommitTimerRef.current !== null) {
        window.clearTimeout(seekCommitTimerRef.current);
      }
      if (volumeCommitTimerRef.current !== null) {
        window.clearTimeout(volumeCommitTimerRef.current);
      }
      if (commandRefreshTimerRef.current !== null) {
        window.clearTimeout(commandRefreshTimerRef.current);
      }
    },
    []
  );

  const currentItem = playback?.item ?? null;
  const currentDeviceId =
    playback?.device?.id ||
    devices.find((device) => device.isActive && device.id)?.id ||
    undefined;
  const durationMs = currentItem?.durationMs ?? 0;
  const progressMs = Math.min(
    durationMs || playback?.progressMs || 0,
    playback?.progressMs ?? 0
  );
  const displayedProgressMs = Math.min(
    durationMs || seekDraftMs || 0,
    seekDraftMs ?? progressMs
  );
  const displayedVolumePercent =
    volumeDraftPercent ?? playback?.device?.volumePercent ?? 0;
  const knownSavedUris = useMemo(
    () =>
      new Set([
        ...(home?.savedTracks.items ?? []).map((item) => item.uri),
        ...(home?.savedShows.items ?? []).map((item) => item.uri),
        ...(home?.savedEpisodes.items ?? []).map((item) => item.uri),
      ]),
    [home]
  );
  const libraryLookupUris = useMemo(() => {
    const candidates = [
      currentItem,
      ...(home?.forYou ?? []),
      ...(searchResults?.tracks.items ?? []),
      ...(searchResults?.shows.items ?? []),
      ...(searchResults?.episodes.items ?? []),
      ...(queue?.queue ?? []),
      ...(playlistPage?.items ?? []),
    ];
    return [
      ...new Set(
        candidates
          .filter((item): item is SpotifyContentItem => Boolean(item))
          .filter((item) => item.type !== "playlist")
          .map((item) => item.uri)
          .filter((uri) => !knownSavedUris.has(uri))
      ),
    ];
  }, [
    currentItem,
    home?.forYou,
    knownSavedUris,
    playlistPage?.items,
    queue?.queue,
    searchResults?.episodes.items,
    searchResults?.shows.items,
    searchResults?.tracks.items,
  ]);
  const libraryLookupKey = libraryLookupUris.join("\u0000");
  const libraryLookupRequest = useMemo(
    () => (libraryLookupKey ? libraryLookupKey.split("\u0000") : []),
    [libraryLookupKey]
  );

  useEffect(() => {
    if (
      !pageVisible ||
      !panelVisible ||
      !libraryLookupKey ||
      hasActiveBackoff()
    ) {
      return;
    }
    const generation = ++libraryLookupGenerationRef.current;
    void window.electron
      .spotifyLibraryContains(libraryLookupRequest)
      .then((result) => {
        if (!result.ok || generation !== libraryLookupGenerationRef.current) {
          if (!result.ok) handleError(result.error);
          return;
        }
        setSavedUris((current) => {
          const next = new Set(current);
          Object.entries(result.data).forEach(([uri, saved]) => {
            if (saved) next.add(uri);
            else if (!knownSavedUris.has(uri)) next.delete(uri);
          });
          return next;
        });
      });
    return () => {
      if (generation === libraryLookupGenerationRef.current) {
        libraryLookupGenerationRef.current += 1;
      }
    };
  }, [
    handleError,
    hasActiveBackoff,
    knownSavedUris,
    libraryLookupKey,
    libraryLookupRequest,
    pageVisible,
    panelVisible,
    retryUntil,
  ]);

  const command = useCallback(
    async (nextCommand: SpotifyPlaybackCommand) => {
      if (!pageVisibleRef.current || hasActiveBackoff()) return false;
      setLoading(true);
      const result = await window.electron.spotifyPlaybackCommand(nextCommand);
      setLoading(false);
      if (!result.ok) {
        handleError(result.error);
        if (result.error.code === "NO_ACTIVE_DEVICE") {
          void refreshDevices();
        }
        return false;
      }
      clearErrorAfterSuccess();
      if (commandRefreshTimerRef.current !== null) {
        window.clearTimeout(commandRefreshTimerRef.current);
      }
      commandRefreshTimerRef.current = window.setTimeout(() => {
        commandRefreshTimerRef.current = null;
        if (pageVisibleRef.current && !hasActiveBackoff()) {
          void refreshPlayback(true);
        }
      }, 250);
      return true;
    },
    [
      clearErrorAfterSuccess,
      handleError,
      hasActiveBackoff,
      refreshDevices,
      refreshPlayback,
    ]
  );

  const commitSeekDraft = useCallback(async () => {
    if (seekCommitTimerRef.current !== null) {
      window.clearTimeout(seekCommitTimerRef.current);
      seekCommitTimerRef.current = null;
    }
    const positionMs = seekDraftRef.current;
    if (positionMs === null) return;

    seekDraftRef.current = null;
    const succeeded = await command({
      type: "seek",
      positionMs,
      deviceId: currentDeviceId,
    });
    if (succeeded) {
      setPlayback((current) =>
        current
          ? {
              ...current,
              progressMs: Math.min(
                current.item?.durationMs ?? positionMs,
                positionMs
              ),
            }
          : current
      );
    }
    setSeekDraftMs(null);
  }, [command, currentDeviceId]);

  const updateSeekDraft = useCallback(
    (positionMs: number) => {
      const nextPosition = Math.max(0, Math.min(durationMs, positionMs));
      seekDraftRef.current = nextPosition;
      setSeekDraftMs(nextPosition);
      if (seekCommitTimerRef.current !== null) {
        window.clearTimeout(seekCommitTimerRef.current);
      }
      seekCommitTimerRef.current = window.setTimeout(() => {
        seekCommitTimerRef.current = null;
        void commitSeekDraft();
      }, SEEK_COMMIT_DELAY_MS);
    },
    [commitSeekDraft, durationMs]
  );

  const commitVolumeDraft = useCallback(async () => {
    if (volumeCommitTimerRef.current !== null) {
      window.clearTimeout(volumeCommitTimerRef.current);
      volumeCommitTimerRef.current = null;
    }
    const volumePercent = volumeDraftRef.current;
    if (volumePercent === null) return;

    volumeDraftRef.current = null;
    const succeeded = await command({
      type: "volume",
      volumePercent,
      deviceId: currentDeviceId,
    });
    if (succeeded) {
      setPlayback((current) =>
        current?.device
          ? {
              ...current,
              device: {
                ...current.device,
                volumePercent,
              },
            }
          : current
      );
    }
    setVolumeDraftPercent(null);
  }, [command, currentDeviceId]);

  const updateVolumeDraft = useCallback(
    (volumePercent: number) => {
      const nextVolume = Math.max(0, Math.min(100, volumePercent));
      volumeDraftRef.current = nextVolume;
      setVolumeDraftPercent(nextVolume);
      if (volumeCommitTimerRef.current !== null) {
        window.clearTimeout(volumeCommitTimerRef.current);
      }
      volumeCommitTimerRef.current = window.setTimeout(() => {
        volumeCommitTimerRef.current = null;
        void commitVolumeDraft();
      }, VOLUME_COMMIT_DELAY_MS);
    },
    [commitVolumeDraft]
  );

  useEffect(() => {
    if (seekCommitTimerRef.current !== null) {
      window.clearTimeout(seekCommitTimerRef.current);
      seekCommitTimerRef.current = null;
    }
    if (volumeCommitTimerRef.current !== null) {
      window.clearTimeout(volumeCommitTimerRef.current);
      volumeCommitTimerRef.current = null;
    }
    seekDraftRef.current = null;
    volumeDraftRef.current = null;
    setSeekDraftMs(null);
    setVolumeDraftPercent(null);
  }, [currentDeviceId, currentItem?.uri]);

  const playItem = useCallback(
    (item: SpotifyContentItem) => {
      if (item.type !== "track" && item.type !== "playlist") {
        if (item.externalUrl) {
          void window.electron.openExternal(item.externalUrl);
        }
        return;
      }
      void command({
        type: "play-item",
        uri: item.uri,
        itemType: item.type,
        deviceId: currentDeviceId,
      });
    },
    [command, currentDeviceId]
  );

  const queueItem = useCallback(
    (item: SpotifyContentItem) => {
      void command({
        type: "add-to-queue",
        uri: item.uri,
        deviceId: currentDeviceId,
      }).then((success) => {
        if (success && view === "queue") void loadQueue();
      });
    },
    [command, currentDeviceId, loadQueue, view]
  );

  const toggleSaved = useCallback(
    async (item: SpotifyContentItem) => {
      if (!pageVisibleRef.current || hasActiveBackoff()) return;
      libraryLookupGenerationRef.current += 1;
      const nextSaved = !savedUris.has(item.uri);
      const result = await window.electron.spotifySetSaved(item.uri, nextSaved);
      if (!result.ok) {
        handleError(result.error);
        return;
      }
      setSavedUris((current) => {
        const next = new Set(current);
        if (nextSaved) next.add(item.uri);
        else next.delete(item.uri);
        return next;
      });
    },
    [handleError, hasActiveBackoff, savedUris]
  );

  const loadPlaylistItems = useCallback(
    async (item: Pick<SpotifyContentItem, "id" | "title">, offset = 0) => {
      if (!pageVisibleRef.current || hasActiveBackoff()) return;
      setLoading(true);
      const result = await window.electron.spotifyGetPlaylistItems(
        item.id,
        offset
      );
      setLoading(false);
      if (!result.ok) {
        handleError(result.error);
        return;
      }
      setPlaylistId(item.id);
      setPlaylistTitle(item.title);
      setPlaylistPage(result.data);
    },
    [handleError, hasActiveBackoff]
  );

  const runSearch = async (event: FormEvent) => {
    event.preventDefault();
    if (!searchQuery.trim() || !pageVisibleRef.current || hasActiveBackoff()) {
      return;
    }
    setLoading(true);
    const result = await window.electron.spotifySearch(searchQuery);
    setLoading(false);
    if (result.ok) {
      setSearchResults(result.data);
      setPlaylistPage(null);
      clearErrorAfterSuccess();
    } else {
      handleError(result.error);
    }
  };

  const resultLists = useMemo<
    Array<{ title: string; items: SpotifyContentItem[] }>
  >(() => {
    if (!searchResults) return [];
    return [
      { title: "Tracks", items: searchResults.tracks.items },
      { title: "Playlists", items: searchResults.playlists.items },
      { title: "Podcasts", items: searchResults.shows.items },
      { title: "Episodes", items: searchResults.episodes.items },
    ];
  }, [searchResults]);

  return (
    <aside
      className={`spotify-mini-player${
        panelVisible ? " spotify-mini-player--visible" : ""
      }`}
      aria-label="Spotify Connect player"
      onPointerEnter={() => setIsHovered(true)}
      onPointerLeave={() => setIsHovered(false)}
    >
      <button
        type="button"
        className="spotify-mini-player__tab"
        aria-label={
          panelVisible
            ? "Pin or hide Spotify Connect player"
            : "Show Spotify Connect player"
        }
        aria-controls="spotify-mini-player-panel"
        aria-expanded={panelVisible}
        onClick={() => {
          if (isOpen) {
            setIsOpen(false);
            setIsHovered(false);
          } else {
            setIsOpen(true);
          }
        }}
      >
        <SpotifyIcon aria-hidden="true" />
        <span>Spotify</span>
      </button>

      <section
        ref={panelRef}
        id="spotify-mini-player-panel"
        className="spotify-mini-player__panel"
        aria-hidden={!panelVisible}
        onFocusCapture={() => setIsPanelFocused(true)}
        onBlurCapture={(event) => {
          const nextFocus = event.relatedTarget as Node | null;
          if (!nextFocus || !event.currentTarget.contains(nextFocus)) {
            setIsPanelFocused(false);
          }
        }}
      >
        <header className="spotify-mini-player__header">
          <span className="spotify-mini-player__attribution">
            <SpotifyIcon aria-hidden="true" />
            <strong>Spotify</strong>
            <small>Connect remote</small>
          </span>
          <span className="spotify-mini-player__header-actions">
            <button
              type="button"
              aria-label="Open Spotify"
              title="Open Spotify"
              onClick={() => void window.electron.openExternal(SPOTIFY_WEB_URL)}
            >
              <ExternalLink size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Hide Spotify player"
              onClick={(event) => {
                setIsOpen(false);
                setIsHovered(false);
                setIsPanelFocused(false);
                event.currentTarget.blur();
              }}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </span>
        </header>

        <div className="spotify-mini-player__now-playing">
          {currentItem?.imageUrl ? (
            <img src={currentItem.imageUrl} alt="" />
          ) : (
            <span className="spotify-mini-player__art-placeholder">
              <SpotifyIcon aria-hidden="true" />
            </span>
          )}
          <span>
            <strong>{currentItem?.title ?? "Nothing playing"}</strong>
            <small>
              {currentItem?.subtitle ||
                "Start playback in Spotify or select content below"}
            </small>
          </span>
          {currentItem?.externalUrl && (
            <button
              type="button"
              aria-label={`Open ${currentItem.title} in Spotify`}
              title="Open in Spotify"
              onClick={() =>
                void window.electron.openExternal(currentItem.externalUrl!)
              }
            >
              <ExternalLink size={14} aria-hidden="true" />
            </button>
          )}
        </div>

        <label className="spotify-mini-player__progress">
          <span className="sr-only">Spotify playback position</span>
          <input
            type="range"
            min={0}
            max={Math.max(1, durationMs)}
            step={1000}
            value={displayedProgressMs}
            disabled={!durationMs || remoteDisabled}
            onChange={(event) =>
              updateSeekDraft(Number(event.currentTarget.value))
            }
            onPointerUp={() => void commitSeekDraft()}
            onPointerCancel={() => void commitSeekDraft()}
            onKeyUp={(event) => {
              if (RANGE_COMMIT_KEYS.has(event.key)) void commitSeekDraft();
            }}
            onBlur={() => void commitSeekDraft()}
          />
          <span>
            <small>{formatTime(displayedProgressMs)}</small>
            <small>{formatTime(durationMs)}</small>
          </span>
        </label>

        <div className="spotify-mini-player__controls">
          <button
            type="button"
            className={playback?.shuffleState ? "is-active" : undefined}
            aria-label={
              playback?.shuffleState ? "Disable shuffle" : "Enable shuffle"
            }
            disabled={remoteDisabled}
            onClick={() =>
              void command({
                type: "shuffle",
                enabled: !playback?.shuffleState,
                deviceId: currentDeviceId,
              })
            }
          >
            <Shuffle size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Previous Spotify item"
            disabled={
              remoteDisabled ||
              playback?.disallows.includes("skipping_prev") === true
            }
            onClick={() =>
              void command({ type: "previous", deviceId: currentDeviceId })
            }
          >
            <SkipBack size={18} fill="currentColor" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="spotify-mini-player__play"
            aria-label={playback?.isPlaying ? "Pause Spotify" : "Play Spotify"}
            disabled={remoteDisabled}
            onClick={() =>
              void command({
                type: playback?.isPlaying ? "pause" : "play",
                deviceId: currentDeviceId,
              })
            }
          >
            {loading ? (
              <LoaderCircle
                className="spotify-mini-player__spinner"
                size={19}
                aria-hidden="true"
              />
            ) : playback?.isPlaying ? (
              <Pause size={19} fill="currentColor" aria-hidden="true" />
            ) : (
              <Play size={19} fill="currentColor" aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            aria-label="Next Spotify item"
            disabled={
              remoteDisabled ||
              playback?.disallows.includes("skipping_next") === true
            }
            onClick={() =>
              void command({ type: "next", deviceId: currentDeviceId })
            }
          >
            <SkipForward size={18} fill="currentColor" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={
              playback?.repeatState !== "off" ? "is-active" : undefined
            }
            aria-label={`Repeat is ${playback?.repeatState ?? "off"}`}
            disabled={remoteDisabled}
            onClick={() =>
              void command({
                type: "repeat",
                state:
                  playback?.repeatState === "off"
                    ? "context"
                    : playback?.repeatState === "context"
                      ? "track"
                      : "off",
                deviceId: currentDeviceId,
              })
            }
          >
            <Repeat size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="spotify-mini-player__device-row">
          <MonitorSpeaker size={15} aria-hidden="true" />
          <label>
            <span className="sr-only">Spotify playback device</span>
            <select
              value={currentDeviceId ?? ""}
              disabled={remoteDisabled}
              onChange={(event) => {
                const deviceId = event.currentTarget.value;
                if (!deviceId) return;
                void command({
                  type: "transfer",
                  deviceId,
                  play: playback?.isPlaying ?? false,
                });
              }}
            >
              <option value="">Select a Spotify device</option>
              {devices
                .filter(
                  (
                    device
                  ): device is SpotifyDevice & {
                    id: string;
                  } => Boolean(device.id)
                )
                .map((device) => (
                  <option
                    key={device.id}
                    value={device.id}
                    disabled={device.isRestricted}
                  >
                    {device.name} · {device.type}
                  </option>
                ))}
            </select>
          </label>
          <button
            type="button"
            aria-label="Refresh Spotify devices"
            title="Refresh devices"
            disabled={remoteDisabled}
            onClick={() => void refreshDevices()}
          >
            <RefreshCw size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={showVolume ? "is-active" : undefined}
            aria-label={
              showVolume ? "Hide Spotify volume" : "Show Spotify volume"
            }
            aria-expanded={showVolume}
            onClick={() => setShowVolume((visible) => !visible)}
          >
            <Volume2 size={14} aria-hidden="true" />
          </button>
        </div>

        {showVolume && playback?.device?.supportsVolume && (
          <label className="spotify-mini-player__volume">
            <span>Device volume</span>
            <input
              type="range"
              min={0}
              max={100}
              step={2}
              value={displayedVolumePercent}
              disabled={remoteDisabled}
              onChange={(event) =>
                updateVolumeDraft(Number(event.currentTarget.value))
              }
              onPointerUp={() => void commitVolumeDraft()}
              onPointerCancel={() => void commitVolumeDraft()}
              onKeyUp={(event) => {
                if (RANGE_COMMIT_KEYS.has(event.key)) {
                  void commitVolumeDraft();
                }
              }}
              onBlur={() => void commitVolumeDraft()}
            />
          </label>
        )}

        {!playback?.device && (
          <p className="spotify-mini-player__notice">
            No active device. Open Spotify on a device, start anything once,
            then refresh and select it here.
          </p>
        )}

        {error && (
          <p className="spotify-mini-player__error" role="alert">
            <span>{error.message}</span>
            {backoffActive && (
              <small>
                Spotify asked GameHub to wait. Retrying in{" "}
                {retrySecondsRemaining}{" "}
                {retrySecondsRemaining === 1 ? "second" : "seconds"}.
              </small>
            )}
          </p>
        )}

        <nav className="spotify-mini-player__views" aria-label="Spotify views">
          <button
            type="button"
            className={view === "home" ? "is-active" : undefined}
            onClick={() => setView("home")}
          >
            <Library size={14} aria-hidden="true" />
            Library
          </button>
          <button
            type="button"
            className={view === "search" ? "is-active" : undefined}
            onClick={() => setView("search")}
          >
            <Search size={14} aria-hidden="true" />
            Search
          </button>
          <button
            type="button"
            className={view === "queue" ? "is-active" : undefined}
            onClick={() => setView("queue")}
          >
            <ListMusic size={14} aria-hidden="true" />
            Queue
          </button>
        </nav>

        <div className="spotify-mini-player__browser">
          {view === "home" && (
            <>
              {!home && (
                <p className="spotify-mini-player__empty">
                  {loading
                    ? "Loading your Spotify library…"
                    : "No library data"}
                </p>
              )}
              {home && (
                <>
                  <ContentList
                    title="For you"
                    items={home.forYou}
                    savedUris={savedUris}
                    remoteDisabled={remoteDisabled}
                    onPlay={playItem}
                    onQueue={queueItem}
                    onToggleSaved={toggleSaved}
                    onPlaylistItems={loadPlaylistItems}
                  />
                  <ContentList
                    title="Your playlists"
                    items={home.playlists.items}
                    savedUris={savedUris}
                    remoteDisabled={remoteDisabled}
                    onPlay={playItem}
                    onQueue={queueItem}
                    onToggleSaved={toggleSaved}
                    onPlaylistItems={loadPlaylistItems}
                  />
                  <ContentList
                    title="Saved tracks"
                    items={home.savedTracks.items}
                    savedUris={savedUris}
                    remoteDisabled={remoteDisabled}
                    onPlay={playItem}
                    onQueue={queueItem}
                    onToggleSaved={toggleSaved}
                    onPlaylistItems={loadPlaylistItems}
                  />
                  <ContentList
                    title="Podcasts"
                    items={[
                      ...home.savedShows.items,
                      ...home.savedEpisodes.items,
                    ]}
                    savedUris={savedUris}
                    remoteDisabled={remoteDisabled}
                    onPlay={playItem}
                    onQueue={queueItem}
                    onToggleSaved={toggleSaved}
                    onPlaylistItems={loadPlaylistItems}
                  />
                </>
              )}
            </>
          )}

          {view === "search" && (
            <>
              <form
                className="spotify-mini-player__search"
                onSubmit={(event) => void runSearch(event)}
              >
                <label>
                  <span className="sr-only">Search Spotify</span>
                  <input
                    type="search"
                    value={searchQuery}
                    placeholder="Tracks, playlists, podcasts"
                    onChange={(event) => setSearchQuery(event.target.value)}
                  />
                </label>
                <button
                  type="submit"
                  disabled={remoteDisabled || !searchQuery.trim()}
                >
                  <Search size={15} aria-hidden="true" />
                  <span className="sr-only">Search</span>
                </button>
              </form>
              {resultLists.map(({ title, items }) => (
                <ContentList
                  key={title}
                  title={title}
                  items={items}
                  savedUris={savedUris}
                  remoteDisabled={remoteDisabled}
                  onPlay={playItem}
                  onQueue={queueItem}
                  onToggleSaved={toggleSaved}
                  onPlaylistItems={loadPlaylistItems}
                />
              ))}
            </>
          )}

          {view === "queue" && (
            <ContentList
              title="Up next"
              items={queue?.queue ?? []}
              savedUris={savedUris}
              remoteDisabled={remoteDisabled}
              onPlay={playItem}
              onQueue={queueItem}
              onToggleSaved={toggleSaved}
              onPlaylistItems={loadPlaylistItems}
            />
          )}

          {playlistPage && playlistId && (
            <section className="spotify-mini-player__playlist">
              <header>
                <strong>{playlistTitle}</strong>
                <button
                  type="button"
                  aria-label="Close playlist items"
                  onClick={() => setPlaylistPage(null)}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </header>
              <ContentList
                title="Playlist items"
                items={playlistPage.items}
                savedUris={savedUris}
                remoteDisabled={remoteDisabled}
                onPlay={playItem}
                onQueue={queueItem}
                onToggleSaved={toggleSaved}
                onPlaylistItems={loadPlaylistItems}
              />
              <footer>
                <button
                  type="button"
                  disabled={remoteDisabled || playlistPage.offset === 0}
                  onClick={() =>
                    void loadPlaylistItems(
                      { id: playlistId, title: playlistTitle },
                      Math.max(0, playlistPage.offset - playlistPage.limit)
                    )
                  }
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={remoteDisabled || playlistPage.nextOffset === null}
                  onClick={() =>
                    void loadPlaylistItems(
                      { id: playlistId, title: playlistTitle },
                      playlistPage.nextOffset ?? 0
                    )
                  }
                >
                  Next
                </button>
              </footer>
            </section>
          )}
        </div>

        <p className="spotify-mini-player__footer-note">
          Playback occurs in Spotify. Premium is required for remote commands.
        </p>
      </section>
    </aside>
  );
}
