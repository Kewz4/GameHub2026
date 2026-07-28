import type { MusicPlayerState } from "@types";
import {
  ListMusic,
  LoaderCircle,
  Music2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppSelector } from "@renderer/hooks";
import type { SpotifyStatus } from "@types";
import { SpotifyMiniPlayer } from "./spotify-mini-player";
import "./music-mini-player.scss";

type AudioSlot = "a" | "b";

const formatTime = (milliseconds: number) => {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

export function MusicMiniPlayer() {
  const provider =
    useAppSelector((state) => state.userPreferences.value?.musicProvider) ??
    "gamehub";
  const [spotifyStatus, setSpotifyStatus] = useState<SpotifyStatus | null>(
    null
  );
  const [spotifyStatusResolved, setSpotifyStatusResolved] = useState(false);
  const spotifyFallbackRequestedRef = useRef(false);

  const refreshSpotifyStatus = useCallback(() => {
    if (provider !== "spotify" || document.hidden) return;
    void window.electron
      .spotifyGetStatus()
      .then(setSpotifyStatus)
      .catch(() => setSpotifyStatus(null))
      .finally(() => setSpotifyStatusResolved(true));
  }, [provider]);

  useEffect(() => {
    if (provider !== "spotify") {
      spotifyFallbackRequestedRef.current = false;
      setSpotifyStatus(null);
      setSpotifyStatusResolved(false);
      return;
    }
    refreshSpotifyStatus();
    const interval = window.setInterval(refreshSpotifyStatus, 15000);
    const refreshWhenVisible = () => {
      if (!document.hidden) refreshSpotifyStatus();
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [provider, refreshSpotifyStatus]);

  useEffect(() => {
    if (
      provider !== "spotify" ||
      !spotifyStatusResolved ||
      !spotifyStatus ||
      spotifyStatus.connected ||
      spotifyFallbackRequestedRef.current
    ) {
      return;
    }

    // Use the normal preference IPC so Redux, the overlay, and recorder policy
    // all switch back together after Spotify invalidates authorization.
    spotifyFallbackRequestedRef.current = true;
    void window.electron
      .updateUserPreferences({ musicProvider: "gamehub" })
      .catch(() => {
        spotifyFallbackRequestedRef.current = false;
      });
  }, [provider, spotifyStatus, spotifyStatusResolved]);

  if (provider === "spotify") {
    if (!spotifyStatusResolved) return null;
    if (spotifyStatus?.connected) {
      return <SpotifyMiniPlayer onConnectionLost={refreshSpotifyStatus} />;
    }
  }

  return <GameHubMusicMiniPlayer />;
}

function GameHubMusicMiniPlayer() {
  const [musicState, setMusicState] = useState<MusicPlayerState | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const audioARef = useRef<HTMLAudioElement | null>(null);
  const audioBRef = useRef<HTMLAudioElement | null>(null);
  const activeSlotRef = useRef<AudioSlot>("a");
  const musicStateRef = useRef<MusicPlayerState | null>(null);
  const lastStartedPlaybackIdRef = useRef(-1);
  const lastAppliedSeekIdRef = useRef(0);
  const refreshingPlaybackIdRef = useRef(-1);
  const audioRetryCountRef = useRef(0);
  const activeTrackKeyRef = useRef<string | null>(null);

  const getAudio = useCallback(
    (slot: AudioSlot) => (slot === "a" ? audioARef.current : audioBRef.current),
    []
  );

  const getActiveAudio = useCallback(
    () => getAudio(activeSlotRef.current),
    [getAudio]
  );

  const getInactiveAudio = useCallback(
    () => getAudio(activeSlotRef.current === "a" ? "b" : "a"),
    [getAudio]
  );

  const setAudioSource = useCallback((audio: HTMLAudioElement, url: string) => {
    if (audio.dataset.musicUrl === url) return;
    audio.pause();
    audio.src = url;
    audio.dataset.musicUrl = url;
    audio.load();
  }, []);

  useEffect(() => {
    let cancelled = false;
    window.electron
      .musicGetState()
      .then((state) => {
        if (!cancelled) setMusicState(state);
      })
      .catch(() => undefined);

    const unsubscribe = window.electron.onMusicState((state) => {
      if (!cancelled) setMusicState(state);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    musicStateRef.current = musicState;
    const track = musicState?.nowPlaying;
    const trackKey = track
      ? `${track.id}\u0000${track.artist}\u0000${track.title}`
      : null;
    if (trackKey !== activeTrackKeyRef.current) {
      activeTrackKeyRef.current = trackKey;
      audioRetryCountRef.current = 0;
      refreshingPlaybackIdRef.current = -1;
    }
  }, [musicState]);

  // Keep the next stream downloading in the inactive element. We deliberately
  // leave its previous src intact during the brief resolving transition so a
  // Next click can still swap to an already buffered element.
  useEffect(() => {
    const url = musicState?.preloadedAudioUrl;
    if (!url) return;
    const active = getActiveAudio();
    if (active?.dataset.musicUrl === url) return;
    const inactive = getInactiveAudio();
    if (!inactive) return;
    inactive.preload = "auto";
    setAudioSource(inactive, url);
  }, [
    getActiveAudio,
    getInactiveAudio,
    musicState?.preloadedAudioUrl,
    setAudioSource,
  ]);

  // Promote a buffered element when possible. This is what makes Next nearly
  // gapless: no src reassignment or fresh network request is needed.
  useEffect(() => {
    const url = musicState?.audioUrl;
    if (!url) {
      getActiveAudio()?.pause();
      return;
    }

    const audioA = audioARef.current;
    const audioB = audioBRef.current;
    if (!audioA || !audioB) return;

    let nextSlot: AudioSlot;
    if (audioA.dataset.musicUrl === url) {
      nextSlot = "a";
    } else if (audioB.dataset.musicUrl === url) {
      nextSlot = "b";
    } else {
      nextSlot = activeSlotRef.current;
      setAudioSource(getAudio(nextSlot)!, url);
    }

    const previousAudio = getActiveAudio();
    const nextAudio = getAudio(nextSlot);
    if (!nextAudio) return;
    if (previousAudio !== nextAudio) previousAudio?.pause();
    activeSlotRef.current = nextSlot;

    nextAudio.volume = musicState.volume;
    nextAudio.muted = musicState.muted;

    if (lastStartedPlaybackIdRef.current !== musicState.playbackId) {
      lastStartedPlaybackIdRef.current = musicState.playbackId;
      refreshingPlaybackIdRef.current = -1;
      nextAudio.currentTime = 0;
    }
  }, [
    getActiveAudio,
    getAudio,
    musicState?.audioUrl,
    musicState?.muted,
    musicState?.playbackId,
    musicState?.volume,
    setAudioSource,
  ]);

  useEffect(() => {
    const audio = getActiveAudio();
    if (!audio || !musicState) return;
    audio.volume = musicState.volume;
    audio.muted = musicState.muted;

    if (musicState.state === "playing" && musicState.audioUrl) {
      void audio.play().then(
        () => setLocalError(null),
        () =>
          setLocalError("Playback was blocked. Select Play to start the music.")
      );
    } else {
      audio.pause();
    }
  }, [
    getActiveAudio,
    musicState,
    musicState?.audioUrl,
    musicState?.muted,
    musicState?.state,
    musicState?.volume,
  ]);

  useEffect(() => {
    if (
      !musicState ||
      musicState.seekId === lastAppliedSeekIdRef.current ||
      musicState.seekId === 0
    ) {
      return;
    }
    lastAppliedSeekIdRef.current = musicState.seekId;
    const audio = getActiveAudio();
    if (!audio) return;
    audio.currentTime = Math.max(0, musicState.progressMs / 1000);
  }, [getActiveAudio, musicState]);

  useEffect(() => {
    const audioElements = [audioARef.current, audioBRef.current].filter(
      (audio): audio is HTMLAudioElement => Boolean(audio)
    );

    const onTimeUpdate = (event: Event) => {
      const audio = event.currentTarget as HTMLAudioElement;
      if (audio !== getActiveAudio()) return;
      void window.electron.musicReportPlaybackProgress(
        audio.currentTime * 1000,
        Number.isFinite(audio.duration) ? audio.duration * 1000 : 0
      );
    };

    const onLoadedMetadata = (event: Event) => {
      const audio = event.currentTarget as HTMLAudioElement;
      if (audio !== getActiveAudio()) return;
      const state = musicStateRef.current;
      if (
        state &&
        state.progressMs > 0 &&
        audio.currentTime === 0 &&
        lastStartedPlaybackIdRef.current === state.playbackId
      ) {
        audio.currentTime = state.progressMs / 1000;
      }
      setLocalError(null);
    };

    const onEnded = (event: Event) => {
      if (event.currentTarget !== getActiveAudio()) return;
      void window.electron.musicNext();
    };

    const onError = (event: Event) => {
      const audio = event.currentTarget as HTMLAudioElement;
      if (audio !== getActiveAudio()) {
        audio.removeAttribute("src");
        delete audio.dataset.musicUrl;
        return;
      }

      const state = musicStateRef.current;
      if (
        state &&
        refreshingPlaybackIdRef.current !== state.playbackId &&
        audioRetryCountRef.current < 1
      ) {
        audioRetryCountRef.current += 1;
        refreshingPlaybackIdRef.current = state.playbackId;
        setLocalError("Refreshing the music stream…");
        void window.electron.musicRefreshCurrent();
        return;
      }
      setLocalError("This track is not playable right now.");
    };

    audioElements.forEach((audio) => {
      audio.addEventListener("timeupdate", onTimeUpdate);
      audio.addEventListener("loadedmetadata", onLoadedMetadata);
      audio.addEventListener("ended", onEnded);
      audio.addEventListener("error", onError);
    });

    return () => {
      audioElements.forEach((audio) => {
        audio.removeEventListener("timeupdate", onTimeUpdate);
        audio.removeEventListener("loadedmetadata", onLoadedMetadata);
        audio.removeEventListener("ended", onEnded);
        audio.removeEventListener("error", onError);
        audio.pause();
      });
    };
  }, [getActiveAudio]);

  useEffect(() => {
    if (!("mediaSession" in navigator) || !musicState?.nowPlaying) return;
    const track = musicState.nowPlaying;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album,
      artwork: track.coverArt
        ? [{ src: track.coverArt, sizes: "500x500" }]
        : [],
    });
    navigator.mediaSession.playbackState =
      musicState.state === "playing" ? "playing" : "paused";

    navigator.mediaSession.setActionHandler("play", () => {
      void window.electron.musicResume();
    });
    navigator.mediaSession.setActionHandler("pause", () => {
      void window.electron.musicPause();
    });
    navigator.mediaSession.setActionHandler("previoustrack", () => {
      void window.electron.musicPrevious();
    });
    navigator.mediaSession.setActionHandler("nexttrack", () => {
      void window.electron.musicNext();
    });
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      if (typeof details.seekTime === "number") {
        void window.electron.musicSeek(details.seekTime * 1000);
      }
    });

    return () => {
      navigator.mediaSession.metadata = null;
    };
  }, [musicState?.nowPlaying, musicState?.state]);

  const handlePlayPause = useCallback(() => {
    if (!musicState || musicState.state === "resolving") return;
    if (localError && musicState.state === "playing") {
      void getActiveAudio()
        ?.play()
        .then(() => setLocalError(null))
        .catch(() =>
          setLocalError("GameHub could not start this audio stream.")
        );
      return;
    }
    setLocalError(null);
    if (musicState.state === "playing") {
      void window.electron.musicPause();
    } else if (musicState.state === "paused" && musicState.audioUrl) {
      void window.electron.musicResume();
    } else {
      void window.electron.musicPlay(
        musicState.currentIndex >= 0 ? musicState.currentIndex : undefined
      );
    }
  }, [getActiveAudio, localError, musicState]);

  const queuePreview = useMemo(
    () =>
      musicState?.queue
        .map((track, index) => ({ track, index }))
        .slice(0, 12) ?? [],
    [musicState?.queue]
  );

  const hasMusic = Boolean(
    musicState && (musicState.nowPlaying || musicState.queue.length > 0)
  );
  const track = musicState?.nowPlaying ?? null;
  const durationMs = Math.max(0, musicState?.durationMs ?? 0);
  const progressMs = Math.min(
    durationMs || (musicState?.progressMs ?? 0),
    musicState?.progressMs ?? 0
  );
  const isResolving = musicState?.state === "resolving";
  const isPlaying = musicState?.state === "playing" && !localError;

  return (
    <aside
      className={`music-mini-player${isOpen ? " music-mini-player--open" : ""}${
        hasMusic ? "" : " music-mini-player--empty"
      }`}
      aria-label="GameHub music player"
    >
      {musicState && hasMusic && (
        <>
          <button
            type="button"
            className="music-mini-player__tab"
            aria-label="Show music player"
            aria-expanded={isOpen}
            onClick={(event) => {
              if (isOpen) {
                setIsOpen(false);
                event.currentTarget.blur();
              } else {
                setIsOpen(true);
              }
            }}
          >
            <Music2 size={17} aria-hidden="true" />
            <span>Music</span>
          </button>

          <section className="music-mini-player__panel" aria-hidden={!isOpen}>
            <header className="music-mini-player__header">
              <span>GameHub Music</span>
              <button
                type="button"
                className="music-mini-player__icon-button"
                aria-label="Hide music player"
                onClick={(event) => {
                  setIsOpen(false);
                  event.currentTarget.blur();
                }}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </header>

            <div className="music-mini-player__track">
              {track?.coverArt ? (
                <img src={track.coverArt} alt="" />
              ) : (
                <span className="music-mini-player__art-placeholder">
                  <Music2 size={24} aria-hidden="true" />
                </span>
              )}
              <span className="music-mini-player__track-copy">
                <strong>{track?.title ?? "Select a queued track"}</strong>
                <small>{track?.artist ?? "GameHub Music"}</small>
              </span>
            </div>

            <label className="music-mini-player__progress">
              <span className="sr-only">Track position</span>
              <input
                type="range"
                min={0}
                max={Math.max(1, durationMs)}
                step={1000}
                value={progressMs}
                disabled={!durationMs}
                onChange={(event) =>
                  void window.electron.musicSeek(Number(event.target.value))
                }
              />
              <span className="music-mini-player__times">
                <small>{formatTime(progressMs)}</small>
                <small>{formatTime(durationMs)}</small>
              </span>
            </label>

            <div className="music-mini-player__controls">
              <button
                type="button"
                className="music-mini-player__icon-button"
                aria-label="Previous track"
                onClick={() => void window.electron.musicPrevious()}
              >
                <SkipBack size={18} fill="currentColor" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="music-mini-player__play-button"
                aria-label={isPlaying ? "Pause" : "Play"}
                disabled={isResolving}
                onClick={handlePlayPause}
              >
                {isResolving ? (
                  <LoaderCircle
                    className="music-mini-player__spinner"
                    size={19}
                    aria-hidden="true"
                  />
                ) : isPlaying ? (
                  <Pause size={19} fill="currentColor" aria-hidden="true" />
                ) : (
                  <Play size={19} fill="currentColor" aria-hidden="true" />
                )}
              </button>
              <button
                type="button"
                className="music-mini-player__icon-button"
                aria-label="Next track"
                onClick={() => void window.electron.musicNext()}
              >
                <SkipForward size={18} fill="currentColor" aria-hidden="true" />
              </button>
              <button
                type="button"
                className={`music-mini-player__icon-button${
                  showQueue ? " music-mini-player__icon-button--active" : ""
                }`}
                aria-label={showQueue ? "Hide queue" : "Show queue"}
                aria-expanded={showQueue}
                onClick={() => setShowQueue((visible) => !visible)}
              >
                <ListMusic size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="music-mini-player__volume">
              <button
                type="button"
                className="music-mini-player__icon-button"
                aria-label={musicState.muted ? "Unmute music" : "Mute music"}
                onClick={() =>
                  void window.electron.musicSetVolume(
                    musicState.volume,
                    !musicState.muted
                  )
                }
              >
                {musicState.muted || musicState.volume === 0 ? (
                  <VolumeX size={16} aria-hidden="true" />
                ) : (
                  <Volume2 size={16} aria-hidden="true" />
                )}
              </button>
              <label>
                <span className="sr-only">Music volume</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={musicState.volume}
                  onChange={(event) =>
                    void window.electron.musicSetVolume(
                      Number(event.target.value),
                      false
                    )
                  }
                />
              </label>
            </div>

            {(localError || musicState.playbackError) && (
              <p className="music-mini-player__error">
                {localError ?? musicState.playbackError}
              </p>
            )}

            {showQueue && (
              <ol className="music-mini-player__queue" aria-label="Music queue">
                {queuePreview.map(({ track: queuedTrack, index }) => (
                  <li
                    key={`${queuedTrack.id}-${index}`}
                    className={
                      index === musicState.currentIndex
                        ? "music-mini-player__queue-item music-mini-player__queue-item--current"
                        : "music-mini-player__queue-item"
                    }
                  >
                    <button
                      type="button"
                      onClick={() => void window.electron.musicPlay(index)}
                    >
                      <span>{queuedTrack.title}</span>
                      <small>{queuedTrack.artist}</small>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}

      {/* Music-only streams do not contain a caption track. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioARef} preload="auto" hidden />
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioBRef} preload="auto" hidden />
    </aside>
  );
}
