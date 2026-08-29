import { Header, Sidebar, Toast } from "@renderer/components";
import {
  DashIcon,
  ScreenFullIcon,
  ScreenNormalIcon,
  XIcon,
} from "@primer/octicons-react";
import {
  useAppDispatch,
  useAppSelector,
  useDownload,
  useLibrary,
  useToast,
  useUserDetails,
} from "@renderer/hooks";
import { useDownloadOptionsListener } from "@renderer/hooks/use-download-options-listener";
import i18n from "i18next";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  clearExtraction,
  closeToast,
  failClassicsScan,
  finishClassicsScan,
  hydrateClassicsScan,
  setExtractionProgress,
  setGameRunning,
  setProfileBackground,
  setUserDetails,
  setUserPreferences,
  toggleDraggingDisabled,
  updateClassicsScanProgress,
} from "@renderer/features";
import { useTranslation } from "react-i18next";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { ClassicsScanModal } from "./pages/settings/emulation/classics-scan-modal";
import { ArchiveDeletionModal } from "./pages/downloads/archive-deletion-error-modal";
import { AchievementSupportModal } from "./pages/downloads/achievement-support-modal";
import { Onboarding } from "./pages/onboarding/onboarding";
import { AddFriendModal } from "./pages/profile/profile-content/add-friend-modal";
import { MusicMiniPlayer } from "./components/music-mini-player/music-mini-player";

import type { GameShop, UserPreferences } from "@types";
import "./app.scss";
import {
  getAchievementSoundUrl,
  getAchievementSoundVolume,
  injectCustomCss,
  removeCustomCss,
} from "./helpers";
import { buildExternalResourceUrl } from "./helpers/external-resources";
import { levelDBService } from "./services/leveldb.service";
import GameHubIcon from "@renderer/assets/icons/gamehub.svg?react";
import { isDesktopSidebarVisible } from "./components/sidebar/sidebar-visibility";

export interface AppProps {
  children: React.ReactNode;
}

export function App() {
  const contentRef = useRef<HTMLDivElement>(null);
  const { updateLibrary, library } = useLibrary();

  // Listen for new download options updates
  useDownloadOptionsListener();

  const { t } = useTranslation("app");

  const { clearDownload, setLastPacket, lastPacket } = useDownload();

  const { fetchUserDetails, updateUserDetails, clearUserDetails } =
    useUserDetails();

  const dispatch = useAppDispatch();

  const navigate = useNavigate();
  const location = useLocation();

  const draggingDisabled = useAppSelector(
    (state) => state.window.draggingDisabled
  );

  const toast = useAppSelector((state) => state.toast);
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const [onboardingDone, setOnboardingDone] = useState(false);
  const [prefsChecked, setPrefsChecked] = useState(false);

  const { showSuccessToast, showErrorToast } = useToast();

  const [showArchiveDeletionModal, setShowArchiveDeletionModal] =
    useState(false);
  const [archivePaths, setArchivePaths] = useState<string[]>([]);
  const [achievementSupportGame, setAchievementSupportGame] = useState<{
    objectId: string;
    shop: GameShop;
    title: string;
  } | null>(null);
  const [showAddFriendModal, setShowAddFriendModal] = useState(false);
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);

  useEffect(() => {
    Promise.all([
      levelDBService.get("userPreferences", null, "json"),
      updateLibrary(),
    ])
      .then(([preferences]) => {
        // A fresh profile has no stored preferences — dispatch an empty object
        // rather than null so consumers gated on "preferences loaded" unblock.
        dispatch(
          setUserPreferences(
            (preferences as UserPreferences | null) ?? ({} as UserPreferences)
          )
        );
      })
      .catch(() => {
        dispatch(setUserPreferences({} as UserPreferences));
      })
      .finally(() => {
        setPrefsChecked(true);
      });
  }, [navigate, location.pathname, dispatch, updateLibrary]);

  useEffect(() => {
    const unsubscribe = window.electron.onUserPreferencesUpdated(
      (preferences) => {
        if (!preferences) {
          dispatch(setUserPreferences(null));
          return;
        }

        if (preferences.language && preferences.language !== i18n.language) {
          void i18n.changeLanguage(preferences.language);
        }

        dispatch(setUserPreferences(preferences));
      }
    );

    return () => {
      unsubscribe();
    };
  }, [dispatch]);

  useEffect(() => {
    const unsubscribe = window.electron.onDownloadProgress(
      (downloadProgress) => {
        if (
          downloadProgress?.progress === 1 &&
          !downloadProgress.isCheckingFiles &&
          !downloadProgress.isDownloadingMetadata
        ) {
          clearDownload();
          updateLibrary();
          return;
        }

        setLastPacket(downloadProgress);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [clearDownload, setLastPacket, updateLibrary]);

  useEffect(() => {
    const unsubscribe = window.electron.onHardDelete(() => {
      updateLibrary();
    });

    return () => unsubscribe();
  }, [updateLibrary]);

  useEffect(() => {
    if (!lastPacket?.gameId) return;

    const activeGame = library.find((game) => game.id === lastPacket.gameId);

    if (!activeGame) {
      clearDownload();
      return;
    }

    // If download is null the library may not have caught up with the new download
    // record yet — don't clear in that case to avoid a race condition at download start.
    if (activeGame.download && activeGame.download.status !== "active") {
      clearDownload();
    }
  }, [clearDownload, lastPacket?.gameId, library]);

  useEffect(() => {
    const onClick = async (event: MouseEvent) => {
      await window.electron.getUserPreferences();
      const language = userPreferences?.language ?? "en";

      const articleMapping = {
        pt: {
          "cannot-write-directory": 1429,
          seeding: 1442,
          "peers-and-seeds": 1449,
          "steam-achievements": 1412,
        },
        en: {
          "cannot-write-directory": 4122,
          seeding: 4116,
          "peers-and-seeds": 4119,
          "steam-achievements": 4140,
        },
      };

      const $helpCenterTarget = (event.target as HTMLElement).closest(
        "[data-open-article]"
      );

      if ($helpCenterTarget) {
        const article = $helpCenterTarget.getAttribute("data-open-article");
        const articleId =
          articleMapping[language.slice(0, 2)]?.[
            article as keyof typeof articleMapping
          ] ?? articleMapping["en"]?.[article as keyof typeof articleMapping];

        if (articleId) {
          /* article lookup preserved for future use */
        }
      }
    };

    window.addEventListener("click", onClick);

    return () => {
      window.removeEventListener("click", onClick);
    };
  }, []);

  const setupExternalResources = useCallback(async () => {
    const cachedUserDetails = window.localStorage.getItem("userDetails");

    if (cachedUserDetails) {
      const { profileBackground, ...userDetails } =
        JSON.parse(cachedUserDetails);

      dispatch(setUserDetails(userDetails));
      dispatch(setProfileBackground(profileBackground));
    }

    await window.electron.getUserPreferences();
    const userDetails = await fetchUserDetails().catch(() => null);

    if (userDetails) {
      updateUserDetails(userDetails);
    }

    if (!document.getElementById("external-resources")) {
      const $script = document.createElement("script");
      $script.id = "external-resources";
      $script.src = `${buildExternalResourceUrl(
        "/bundle.js",
        import.meta.env.RENDERER_VITE_EXTERNAL_RESOURCES_URL
      )}?t=${Date.now()}`;
      document.head.appendChild($script);
    }
  }, [fetchUserDetails, updateUserDetails, dispatch]);

  useEffect(() => {
    setupExternalResources();
  }, [setupExternalResources]);

  const onSignIn = useCallback(() => {
    fetchUserDetails().then((response) => {
      if (response) {
        updateUserDetails(response);
        showSuccessToast(t("successfully_signed_in"));
      }
    });
  }, [fetchUserDetails, t, showSuccessToast, updateUserDetails]);

  useEffect(() => {
    const unsubscribe = window.electron.onGamesRunning((gamesRunning) => {
      if (gamesRunning.length) {
        const lastGame = gamesRunning[gamesRunning.length - 1];
        const libraryGame = library.find(
          (library) => library.id === lastGame.id
        );

        if (libraryGame) {
          dispatch(
            setGameRunning({
              ...libraryGame,
              sessionDurationInMillis: lastGame.sessionDurationInMillis,
            })
          );
          return;
        }
      }
      dispatch(setGameRunning(null));
    });

    return () => {
      unsubscribe();
    };
  }, [dispatch, library]);

  useEffect(() => {
    window.electron.getActiveClassicsImport().then((snapshot) => {
      if (snapshot) dispatch(hydrateClassicsScan(snapshot));
    });

    const unsubscribe = window.electron.onClassicsImportProgress((payload) => {
      if (payload.type === "error") {
        dispatch(failClassicsScan(payload.message));
        return;
      }

      if (payload.type === "progress") {
        dispatch(updateClassicsScanProgress(payload));
        return;
      }

      dispatch(
        finishClassicsScan({
          cancelled: payload.type === "cancelled",
          system: payload.system,
          result: {
            fileCount: payload.fileCount,
            sizeBytes: payload.sizeBytes,
            matched: payload.matched,
            unmatched: payload.unmatched,
            unmatchedFiles: payload.unmatchedFiles,
          },
        })
      );
      updateLibrary();
    });

    return () => unsubscribe();
  }, [dispatch, updateLibrary]);

  useEffect(() => {
    const listeners = [
      window.electron.onSignIn(onSignIn),
      window.electron.onLibraryBatchComplete(() => {
        updateLibrary();
      }),
      window.electron.onDownloadsUpdated(() => {
        updateLibrary();
      }),
      window.electron.onDownloadHalted((gameTitle) => {
        updateLibrary();
        showErrorToast(
          t("download_halted_title", { ns: "downloads" }),
          t("download_halted_description", {
            ns: "downloads",
            title: gameTitle,
          })
        );
      }),
      window.electron.onSignOut(() => clearUserDetails()),
      window.electron.onExtractionProgress((shop, objectId, progress) => {
        dispatch(setExtractionProgress({ shop, objectId, progress }));
      }),
      window.electron.onExtractionComplete(() => {
        dispatch(clearExtraction());
        updateLibrary();
      }),
      window.electron.onExtractionFailed(() => {
        dispatch(clearExtraction());
        updateLibrary();
        showErrorToast(
          t("extraction_failed_title", { ns: "downloads" }),
          t("extraction_failed_description", { ns: "downloads" })
        );
      }),
      window.electron.onArchiveDeletionPrompt((paths) => {
        setArchivePaths(paths);
        setShowArchiveDeletionModal(true);
      }),
      window.electron.onAchievementSupportMissing((data) => {
        setAchievementSupportGame(data);
      }),
    ];

    return () => {
      listeners.forEach((unsubscribe) => unsubscribe());
    };
  }, [onSignIn, updateLibrary, clearUserDetails, dispatch, showErrorToast, t]);

  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [location.pathname, location.search]);

  useEffect(() => {
    new MutationObserver(() => {
      const modal = document.body.querySelector("[data-hydra-dialog]");

      dispatch(toggleDraggingDisabled(Boolean(modal)));
    }).observe(document.body, {
      attributes: false,
      childList: true,
    });
  }, [dispatch, draggingDisabled]);

  const loadAndApplyTheme = useCallback(async () => {
    const allThemes = (await levelDBService.values("themes")) as {
      isActive?: boolean;
      code?: string;
    }[];
    const activeTheme = allThemes.find((theme) => theme.isActive);
    if (activeTheme?.code) {
      injectCustomCss(activeTheme.code);
    } else {
      removeCustomCss();
    }
  }, []);

  useEffect(() => {
    loadAndApplyTheme();
  }, [loadAndApplyTheme]);

  useEffect(() => {
    const unsubscribe = window.electron.onCustomThemeUpdated(() => {
      loadAndApplyTheme();
    });

    return () => unsubscribe();
  }, [loadAndApplyTheme]);

  // Apply the built-in colour scheme. The CSS handles dark (default) and the
  // system-light media query; we just stamp the chosen mode on <html>.
  useEffect(() => {
    document.documentElement.setAttribute(
      "data-theme-mode",
      userPreferences?.themeMode ?? "dark"
    );
  }, [userPreferences?.themeMode]);

  const playAudio = useCallback(async () => {
    const soundUrl = await getAchievementSoundUrl();
    const volume = await getAchievementSoundVolume();
    const audio = new Audio(soundUrl);
    audio.volume = volume;
    audio.play();
  }, []);

  useEffect(() => {
    const unsubscribe = window.electron.onAchievementUnlocked(() => {
      playAudio();
    });

    return () => {
      unsubscribe();
    };
  }, [playAudio]);

  useEffect(() => {
    const unsubscribe = globalThis.electron.onNavigate((path) => {
      navigate(path);
    });
    return () => unsubscribe();
  }, [navigate]);

  useEffect(() => {
    const unsubscribe = globalThis.electron.onOpenAddFriendModal(() => {
      setShowAddFriendModal(true);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (window.electron.platform !== "linux") return;

    if (window.electron.isWayland) {
      document.body.classList.add("window-rounded");
    }

    let cancelled = false;

    const applyMaximizeState = (isMaximized: boolean) => {
      if (cancelled) return;
      setIsWindowMaximized(isMaximized);
      document.body.classList.toggle("window-maximized", isMaximized);
    };

    window.electron.isMainWindowMaximized().then(applyMaximizeState);
    const unsubscribe =
      window.electron.onWindowMaximizeChange(applyMaximizeState);

    return () => {
      cancelled = true;
      unsubscribe();
      document.body.classList.remove("window-rounded");
      document.body.classList.remove("window-maximized");
    };
  }, []);

  const handleToastClose = useCallback(() => {
    dispatch(closeToast());
  }, [dispatch]);

  const showOnboarding =
    prefsChecked && !onboardingDone && !userPreferences?.onboardingComplete;

  if (showOnboarding) {
    return <Onboarding onComplete={() => setOnboardingDone(true)} />;
  }

  return (
    <>
      {(window.electron.platform === "win32" ||
        window.electron.platform === "linux") && (
        <div
          className={`title-bar${
            window.electron.platform === "win32" ? " title-bar--windows" : ""
          }`}
        >
          <GameHubIcon
            style={{
              width: 18,
              height: 18,
              color: "var(--color-text-bright)",
              flexShrink: 0,
            }}
          />
          <h4>GameHub</h4>

          {window.electron.platform === "linux" && (
            <div className="title-bar__window-controls">
              <button
                type="button"
                className="title-bar__window-control"
                onClick={() => window.electron.minimizeMainWindow()}
                title={t("header:minimize")}
                aria-label={t("header:minimize")}
              >
                <DashIcon size={16} />
              </button>
              <button
                type="button"
                className="title-bar__window-control"
                onClick={() => window.electron.toggleMaximizeMainWindow()}
                title={
                  isWindowMaximized ? t("header:restore") : t("header:maximize")
                }
                aria-label={
                  isWindowMaximized ? t("header:restore") : t("header:maximize")
                }
              >
                {isWindowMaximized ? (
                  <ScreenNormalIcon size={16} />
                ) : (
                  <ScreenFullIcon size={16} />
                )}
              </button>
              <button
                type="button"
                className="title-bar__window-control title-bar__window-control--close"
                onClick={() => window.electron.closeMainWindow()}
                title={t("header:close")}
                aria-label={t("header:close")}
              >
                <XIcon size={16} />
              </button>
            </div>
          )}
        </div>
      )}

      <Toast
        visible={toast.visible}
        title={toast.title}
        message={toast.message}
        type={toast.type}
        onClose={handleToastClose}
        duration={toast.duration}
      />

      <MusicMiniPlayer />

      <ArchiveDeletionModal
        visible={showArchiveDeletionModal}
        archivePaths={archivePaths}
        onClose={() => setShowArchiveDeletionModal(false)}
      />

      <AchievementSupportModal
        visible={achievementSupportGame !== null}
        gameTitle={achievementSupportGame?.title ?? ""}
        shop={achievementSupportGame?.shop ?? "steam"}
        objectId={achievementSupportGame?.objectId ?? ""}
        onClose={() => setAchievementSupportGame(null)}
      />

      <AddFriendModal
        visible={showAddFriendModal}
        onClose={() => setShowAddFriendModal(false)}
      />

      <ClassicsScanModal />

      <main>
        {isDesktopSidebarVisible(userPreferences) && <Sidebar />}

        <article className="container">
          <Header />

          <section
            ref={contentRef}
            id="scrollableDiv"
            className="container__content"
          >
            <Outlet />
          </section>
        </article>
      </main>
    </>
  );
}
