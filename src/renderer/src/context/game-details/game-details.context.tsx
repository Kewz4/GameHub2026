import { createContext, useCallback, useEffect, useRef, useState } from "react";

import { setHeaderTitle } from "@renderer/features";
import { levelDBService } from "@renderer/services/leveldb.service";
import { orderBy } from "lodash-es";
import { getSteamLanguage } from "@renderer/helpers";
import {
  useAppDispatch,
  useAppSelector,
  useDownload,
  useUserDetails,
} from "@renderer/hooks";

import type {
  DownloadSource,
  GameRepack,
  GameShop,
  GameStats,
  LibraryGame,
  ShopDetailsWithAssets,
  UserAchievement,
} from "@types";

import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import {
  GameDetailsContext,
  GameOptionsCategoryId,
} from "./game-details.context.types";
import { SteamContentDescriptor } from "@shared";

export const gameDetailsContext = createContext<GameDetailsContext>({
  game: null,
  shopDetails: null,
  repacks: [],
  shop: "steam",
  canonicalShop: "steam",
  canonicalObjectId: undefined,
  gameTitle: "",
  isGameRunning: false,
  isLoading: false,
  objectId: undefined,
  showRepacksModal: false,
  showGameOptionsModal: false,
  gameOptionsInitialCategory: "general",
  stats: null,
  achievements: null,
  hasNSFWContentBlocked: false,
  lastDownloadedOption: null,
  isTransferring: false,
  transferProgress: 0,
  selectGameExecutable: async () => null,
  updateGame: async () => {},
  setShowGameOptionsModal: () => {},
  setGameOptionsInitialCategory: () => {},
  setShowRepacksModal: () => {},
  setHasNSFWContentBlocked: () => {},
  cancelTransfer: () => {},
});

const { Provider } = gameDetailsContext;
export const { Consumer: GameDetailsContextConsumer } = gameDetailsContext;

export interface GameDetailsContextProps {
  children: React.ReactNode;
  objectId: string;
  gameTitle: string;
  shop: GameShop;
}

export function GameDetailsContextProvider({
  children,
  objectId,
  gameTitle,
  shop,
}: Readonly<GameDetailsContextProps>) {
  const [shopDetails, setShopDetails] = useState<ShopDetailsWithAssets | null>(
    null
  );
  const [canonicalShop, setCanonicalShop] = useState<GameShop>(shop);
  const [canonicalObjectId, setCanonicalObjectId] = useState<
    string | undefined
  >(objectId);
  const [achievements, setAchievements] = useState<UserAchievement[] | null>(
    null
  );
  const [game, setGame] = useState<LibraryGame | null>(null);
  const [hasNSFWContentBlocked, setHasNSFWContentBlocked] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [isTransferring, setIsTransferring] = useState(false);
  const [transferProgress, setTransferProgress] = useState(0);

  const [stats, setStats] = useState<GameStats | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isGameRunning, setIsGameRunning] = useState(false);
  const [showRepacksModal, setShowRepacksModal] = useState(false);
  const [showGameOptionsModal, setShowGameOptionsModal] = useState(false);
  const [gameOptionsInitialCategory, setGameOptionsInitialCategory] =
    useState<GameOptionsCategoryId>("general");
  const [repacks, setRepacks] = useState<GameRepack[]>([]);

  const { i18n } = useTranslation("game_details");
  const location = useLocation();

  const dispatch = useAppDispatch();

  const { lastPacket } = useDownload();
  const { userDetails } = useUserDetails();

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const updateGame = useCallback(async () => {
    const result = await window.electron.getGameByObjectId(shop, objectId);

    if (result) {
      setGame(result);
      return;
    }

    // Catalogue entry not in library — check if the user has it under a different shop
    // (e.g. viewing a Steam catalogue entry but the user owns it on Epic/GOG)
    if (gameTitle && shop === "steam") {
      const libraryMatch = await window.electron
        .findLibraryGameByTitle(gameTitle)
        .catch(() => null);
      if (
        libraryMatch &&
        (libraryMatch.shop === "epic" || libraryMatch.shop === "gog")
      ) {
        // Synthesize a game object so the repacks modal shows the platform download button.
        // _synthesized flag prevents this from triggering the "Download via Steam" path.
        const synthetic = {
          ...libraryMatch,
          shop: "steam" as const,
          objectId,
          _synthesized: true,
          alternativeShops: [
            ...(libraryMatch.alternativeShops ?? []),
            {
              shop: libraryMatch.shop,
              objectId: libraryMatch.objectId,
              executablePath: libraryMatch.executablePath,
            },
          ],
        };
        setGame(synthetic as any);
        return;
      }
    }

    setGame(result);
  }, [shop, objectId, gameTitle]);

  const isGameDownloading =
    lastPacket?.gameId === game?.id && game?.download?.status === "active";

  useEffect(() => {
    updateGame();
  }, [updateGame, isGameDownloading, lastPacket?.gameId]);

  // Listen for transfer events
  useEffect(() => {
    const onTransferProgress = (
      _: unknown,
      shop: string,
      objectId: string,
      progress: number
    ) => {
      if (shop === game?.shop && objectId === game?.objectId) {
        setIsTransferring(progress >= 0 && progress < 1);
        setTransferProgress(progress);
      }
    };

    const onTransferComplete = (_: unknown, shop: string, objectId: string) => {
      if (shop === game?.shop && objectId === game?.objectId) {
        setIsTransferring(false);
        setTransferProgress(0);
        updateGame();
      }
    };

    const onTransferCancelled = (
      _: unknown,
      shop: string,
      objectId: string
    ) => {
      if (shop === game?.shop && objectId === game?.objectId) {
        setIsTransferring(false);
        setTransferProgress(0);
      }
    };

    const onTransferError = (_: unknown, shop: string, objectId: string) => {
      if (shop === game?.shop && objectId === game?.objectId) {
        setIsTransferring(false);
        setTransferProgress(0);
      }
    };

    window.electron.on("on-game-transfer-progress", onTransferProgress);
    window.electron.on("on-game-transfer-complete", onTransferComplete);
    window.electron.on("on-game-transfer-cancelled", onTransferCancelled);
    window.electron.on("on-game-transfer-error", onTransferError);

    return () => {
      window.electron.off("on-game-transfer-progress", onTransferProgress);
      window.electron.off("on-game-transfer-complete", onTransferComplete);
      window.electron.off("on-game-transfer-cancelled", onTransferCancelled);
      window.electron.off("on-game-transfer-error", onTransferError);
    };
  }, [game]);

  useEffect(() => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const rawShopDetailsPromise = window.electron.getGameShopDetails(
      objectId,
      shop,
      getSteamLanguage(i18n.language)
    );

    const shopDetailsPromise = rawShopDetailsPromise.then((result) => {
      if (abortController.signal.aborted) return;

      setShopDetails(result);

      // For non-Steam games, use the Steam equivalent for reviews/achievements/stats
      if (result && shop !== "steam" && (result as any).steam_appid) {
        const steamId = String((result as any).steam_appid);
        setCanonicalShop("steam");
        setCanonicalObjectId(steamId);
      } else {
        setCanonicalShop(shop);
        setCanonicalObjectId(objectId);
      }

      if (
        result?.content_descriptors?.ids?.includes(
          SteamContentDescriptor.AdultOnlySexualContent
        ) &&
        !userPreferences?.disableNsfwAlert
      ) {
        setHasNSFWContentBlocked(true);
      }

      if (result?.assets) {
        setIsLoading(false);
      }
    });

    if (shop === "steam") {
      window.electron
        .getGameStats(objectId, shop)
        .then((result) => {
          if (abortController.signal.aborted) return;
          setStats(result);
        })
        .catch(() => {});
    } else if (shop !== "custom") {
      // The stats endpoint only knows Steam ids — wait for the canonical
      // Steam equivalent instead of sending the shop's own id (400s)
      rawShopDetailsPromise
        .then((details) => {
          const steamId = (details as any)?.steam_appid;
          if (!steamId || abortController.signal.aborted) return;
          window.electron
            .getGameStats(String(steamId), "steam")
            .then((result) => {
              if (abortController.signal.aborted) return;
              setStats(result);
            })
            .catch(() => {});
        })
        .catch(() => {});
    }

    const assetsPromise = window.electron.getGameAssets(
      objectId,
      shop,
      game?.title
    );

    Promise.all([shopDetailsPromise, assetsPromise])
      .then(([_, assets]) => {
        if (assets) {
          if (abortController.signal.aborted) return;
          setShopDetails((prev) => {
            if (!prev) {
              // Game not in Hydra catalogue — create a minimal entry so hero/logo
              // images from SteamGridDB are still available to the details page.
              // Every consumer must treat the remaining fields as optional.
              return {
                name: gameTitle ?? "",
                about_the_game: "",
                short_description: "",
                detailed_description: "",
                screenshots: [],
                assets,
              } as unknown as ShopDetailsWithAssets;
            }
            return {
              ...prev,
              assets,
            };
          });
        }
      })
      .finally(() => {
        if (abortController.signal.aborted) return;
        setIsLoading(false);
      });

    if (userDetails && shop !== "custom") {
      // Achievements are indexed by Steam — wait for shopDetails so we have the canonical Steam ID
      rawShopDetailsPromise.then((details) => {
        if (abortController.signal.aborted) return;
        const steamId =
          shop !== "steam" && (details as any)?.steam_appid
            ? String((details as any).steam_appid)
            : null;
        const achObjectId = steamId ?? objectId;
        const achShop: GameShop = steamId ? "steam" : shop;
        window.electron
          .getUnlockedAchievements(achObjectId, achShop)
          .then((achievements) => {
            if (abortController.signal.aborted) return;
            setAchievements(achievements);
          })
          .catch(() => void 0);
      });
    }
  }, [
    updateGame,
    dispatch,
    objectId,
    shop,
    i18n.language,
    userDetails,
    userPreferences,
  ]);

  useEffect(() => {
    setShopDetails(null);
    setGame(null);
    setIsLoading(true);
    setIsGameRunning(false);
    setAchievements(null);
    setGameOptionsInitialCategory("general");
    setCanonicalShop(shop);
    setCanonicalObjectId(objectId);
    dispatch(setHeaderTitle(gameTitle));
  }, [objectId, gameTitle, dispatch]);

  useEffect(() => {
    const state =
      (location && (location.state as Record<string, unknown>)) || {};
    if (state.openRepacks) {
      setShowRepacksModal(true);
      try {
        window.history.replaceState({}, document.title, location.pathname);
      } catch (e) {
        console.error(e);
      }
    }
  }, [location]);

  useEffect(() => {
    if (game?.title) {
      dispatch(setHeaderTitle(game.title));
    }
  }, [game?.title, dispatch]);

  useEffect(() => {
    const unsubscribe = window.electron.onGamesRunning((gamesIds) => {
      const updatedIsGameRunning =
        !!game?.id &&
        !!gamesIds.find((gameRunning) => gameRunning.id == game.id);

      if (isGameRunning != updatedIsGameRunning) {
        updateGame();
      }

      setIsGameRunning(updatedIsGameRunning);
    });

    return () => {
      unsubscribe();
    };
  }, [game?.id, isGameRunning, updateGame]);

  useEffect(() => {
    const unsubscribe = window.electron.onLibraryBatchComplete(() => {
      updateGame();
    });

    return () => {
      unsubscribe();
    };
  }, [updateGame]);

  useEffect(() => {
    const handler = (ev: Event) => {
      try {
        const detail = (ev as CustomEvent).detail || {};
        if (detail.objectId && detail.objectId === objectId) {
          setShowRepacksModal(true);
        }
      } catch (e) {
        void e;
      }
    };

    window.addEventListener("hydra:openRepacks", handler as EventListener);

    return () => {
      window.removeEventListener("hydra:openRepacks", handler as EventListener);
    };
  }, [objectId]);

  useEffect(() => {
    const handler = (ev: Event) => {
      try {
        const detail = (ev as CustomEvent).detail || {};
        if (detail.objectId && detail.objectId === objectId) {
          setGameOptionsInitialCategory("general");
          setShowGameOptionsModal(true);
        }
      } catch (e) {
        void e;
      }
    };

    window.addEventListener("hydra:openGameOptions", handler as EventListener);

    return () => {
      window.removeEventListener(
        "hydra:openGameOptions",
        handler as EventListener
      );
    };
  }, [objectId]);

  useEffect(() => {
    const state =
      (location && (location.state as Record<string, unknown>)) || {};
    if (state.openGameOptions) {
      setGameOptionsInitialCategory("general");
      setShowGameOptionsModal(true);

      try {
        window.history.replaceState({}, document.title, location.pathname);
      } catch (_e) {
        void _e;
      }
    }
  }, [location]);

  useEffect(() => {
    const unsubscribe = window.electron.onUpdateAchievements(
      objectId,
      shop,
      (achievements) => {
        if (!userDetails) return;
        setAchievements(achievements);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [objectId, shop, userDetails]);

  useEffect(() => {
    if (shop === "custom") return;

    const fetchDownloadSources = async () => {
      try {
        const sourcesRaw = (await levelDBService.values(
          "downloadSources"
        )) as DownloadSource[];
        const sources = orderBy(sourcesRaw, "createdAt", "desc");

        const params = {
          take: 100,
          skip: 0,
          downloadSourceIds: sources.map((source) => source.id),
        };

        let downloads = await window.electron.hydraApi
          .get<
            GameRepack[]
          >(`/games/${shop}/${objectId}/download-sources`, { params, needsAuth: false })
          .catch(() => [] as GameRepack[]);

        // For non-Steam games with no repacks, search the Hydra catalogue
        // by title to find the Steam equivalent and fetch its repacks
        if ((!downloads || downloads.length === 0) && shop !== "steam") {
          try {
            const steamId = await window.electron.hydraApi
              .post<{
                edges: Array<{ shop: string; objectId: string; title: string }>;
              }>("/catalogue/search", {
                data: {
                  title: gameTitle,
                  sortBy: "popularity",
                  sortOrder: "desc",
                  downloadSourceFingerprints: [],
                  tags: [],
                  publishers: [],
                  genres: [],
                  developers: [],
                  protondbSupportBadges: [],
                  deckCompatibility: [],
                  take: 5,
                  skip: 0,
                },
                needsAuth: false,
              })
              .then((resp) => {
                const normalizedTitle = gameTitle
                  .toLowerCase()
                  .replace(/[^a-z0-9]/g, "");
                const match =
                  resp?.edges?.find(
                    (r) =>
                      r.shop === "steam" &&
                      r.title.toLowerCase().replace(/[^a-z0-9]/g, "") ===
                        normalizedTitle
                  ) ?? resp?.edges?.find((r) => r.shop === "steam");
                return match?.objectId ?? null;
              })
              .catch(() => null);

            if (steamId) {
              const steamRepacks = await window.electron.hydraApi
                .get<GameRepack[]>(`/games/steam/${steamId}/download-sources`, {
                  params,
                  needsAuth: false,
                })
                .catch(() => [] as GameRepack[]);
              if (steamRepacks?.length) downloads = steamRepacks;
            }
          } catch (_e) {
            // silent fallback
          }
        }

        setRepacks(downloads ?? []);
      } catch (error) {
        console.error("Failed to fetch download sources:", error);
      }
    };

    fetchDownloadSources();
  }, [shop, objectId]);

  const getDownloadsPath = async () => {
    if (userPreferences?.downloadsPath) return userPreferences.downloadsPath;
    return window.electron.getDefaultDownloadsPath();
  };

  const selectGameExecutable = async () => {
    const downloadsPath = await getDownloadsPath();

    return window.electron
      .showOpenDialog({
        properties: ["openFile"],
        defaultPath: downloadsPath,
        filters: [
          {
            name: "Game executable",
            extensions: ["exe", "lnk"],
          },
        ],
      })
      .then(({ filePaths }) => {
        if (filePaths && filePaths.length > 0) {
          return filePaths[0];
        }

        return null;
      });
  };

  // Handlers for cancel
  const cancelTransfer = () => {
    window.electron.cancelGameTransfer?.(shop, objectId);
    setIsTransferring(false);
    setTransferProgress(0);
  };

  return (
    <Provider
      value={{
        game,
        shopDetails,
        shop,
        canonicalShop,
        canonicalObjectId,
        repacks,
        gameTitle,
        isGameRunning,
        isLoading,
        objectId,
        showGameOptionsModal,
        gameOptionsInitialCategory,
        showRepacksModal,
        stats,
        achievements,
        hasNSFWContentBlocked,
        lastDownloadedOption: null,
        isTransferring,
        transferProgress,
        setHasNSFWContentBlocked,
        selectGameExecutable,
        updateGame,
        setShowRepacksModal,
        setShowGameOptionsModal,
        setGameOptionsInitialCategory,
        cancelTransfer,
      }}
    >
      {children}
    </Provider>
  );
}
