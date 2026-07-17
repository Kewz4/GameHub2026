import { createContext, useCallback, useEffect, useRef, useState } from "react";

import { setHeaderTitle } from "@renderer/features";
import { levelDBService } from "@renderer/services/leveldb.service";
import { orderBy } from "lodash-es";
import { getSteamLanguage, ensureArray } from "@renderer/helpers";
import {
  useAppDispatch,
  useAppSelector,
  useDownload,
  useUserDetails,
} from "@renderer/hooks";

import type {
  DownloadSource,
  EmulatorSystem,
  GameRepack,
  GameShop,
  GameStats,
  LibraryGame,
  ShopDetailsWithAssets,
  UserAchievement,
} from "@types";

/**
 * Maps a Launchbox platform string to an EmulatorSystem for minerva lookups.
 * Extends the main-process platformToSystem helper to cover all minerva-supported systems.
 */
function platformToEmulatorSystem(
  platform: string | null | undefined
): EmulatorSystem | null {
  if (!platform) return null;
  const p = platform.toLowerCase();
  // Fast path: an exact EmulatorSystem key (passed by the search dropdown for
  // games not yet in the library).
  const EXACT: EmulatorSystem[] = [
    "ps1",
    "ps2",
    "ps3",
    "psp",
    "n3ds",
    "nds",
    "dsi",
    "n64",
    "gb",
    "gbc",
    "gba",
    "wiiu",
    "wii",
    "gc",
    "switch",
  ];
  if ((EXACT as string[]).includes(p)) return p as EmulatorSystem;
  if (p.includes("playstation 3") || p.includes("ps3")) return "ps3";
  if (p.includes("playstation 2") || p.includes("ps2")) return "ps2";
  if (p.includes("playstation portable") || p.includes("psp")) return "psp";
  if (p.includes("playstation") || p.includes("ps1") || p.includes("psx"))
    return "ps1";
  if (p.includes("nintendo 64") || p.includes("n64")) return "n64";
  if (p.includes("game boy advance") || p.includes("gba")) return "gba";
  if (p.includes("game boy color") || p.includes("gbc")) return "gbc";
  if (p.includes("game boy")) return "gb";
  if (p.includes("nintendo ds") || p.includes("nds")) return "nds";
  if (p.includes("nintendo dsi") || p.includes("dsi")) return "dsi";
  if (p.includes("nintendo 3ds") || p.includes("3ds")) return "n3ds";
  if (p.includes("nintendo switch") || p.includes("switch")) return "switch";
  if (p.includes("wii u") || p.includes("wiiu")) return "wiiu";
  if (p.includes("gamecube") || p.includes("gc")) return "gc";
  if (p.includes("wii")) return "wii";
  return null;
}

import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import {
  GameDetailsContext,
  GameOptionsCategoryId,
} from "./game-details.context.types";
import { getGameExecutableFilters, SteamContentDescriptor } from "@shared";

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
  /**
   * Console/emulated platform for games opened from search that are not yet in
   * the library (carried as the `platform` route param). Lets the minerva ROM
   * lookup run without a stored game record.
   */
  platform?: string;
}

export function GameDetailsContextProvider({
  children,
  objectId,
  gameTitle,
  shop,
  platform,
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

  const { t, i18n } = useTranslation("game_details");
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

    // launchbox (console/emulated) games are owned by the RetroAchievements
    // effect below — skip them here so the two don't race on setAchievements.
    if (userDetails && shop !== "custom" && shop !== "launchbox") {
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
    // launchbox (console/emulated) games use the minerva effect below instead
    if (shop === "custom" || shop === "launchbox") return;

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

        setRepacks(
          ensureArray<GameRepack>(
            downloads,
            `/games/${shop}/${objectId}/download-sources`
          )
        );
      } catch (error) {
        console.error("Failed to fetch download sources:", error);
      }
    };

    fetchDownloadSources();
  }, [shop, objectId]);

  // For launchbox (emulated) games, fetch GameHub Vault ROM sources.
  // Works both for library games (system derived from the stored platform) and
  // for games opened straight from search (system from the `platform` param).
  useEffect(() => {
    if (!gameTitle) return;
    if (game && game.shop !== "launchbox") return;

    // Resolve the console system from (in priority order): the stored library
    // platform, the `platform` route param, or a `minerva:<system>:…` objectId
    // (catalogue results and shared links carry it there).
    const systemFromObjectId = objectId?.startsWith("minerva:")
      ? objectId.split(":")[1]
      : null;
    const system = platformToEmulatorSystem(
      game?.platform ?? platform ?? systemFromObjectId
    );
    if (!system) return;

    const mergeRepacks = (minervaRepacks: import("@types").GameRepack[]) => {
      if (minervaRepacks && minervaRepacks.length > 0) {
        setRepacks((prev) => {
          const existingIds = new Set(prev.map((r) => r.id));
          const newRepacks = minervaRepacks.filter(
            (r) => !existingIds.has(r.id)
          );
          return [...prev, ...newRepacks];
        });
      }
    };

    // Exact prefix scan (base + updates + DLC for THIS title) is authoritative
    // and region-tagged. The fuzzy catalogue search is only a fallback for when
    // the title doesn't match exactly — running both would collide on the same
    // repack id (same id, possibly different title) and leak wrong-region or
    // wrong-game entries.
    let cancelled = false;
    window.electron
      .getMinervaDownloadOptions(system, gameTitle)
      .then((primary) => {
        if (cancelled) return;
        if (primary && primary.length > 0) {
          mergeRepacks(primary);
          return;
        }
        return window.electron
          .searchMinervaCatalogue(gameTitle, system)
          .then((fallback) => {
            if (!cancelled) mergeRepacks(fallback);
          });
      })
      .catch((err) => {
        console.error("[minerva] Failed to fetch download options:", err);
      });

    return () => {
      cancelled = true;
    };
  }, [game?.objectId, game?.platform, gameTitle, platform, objectId]);

  // For RA-capable console games, resolve the RetroAchievements set by title so
  // the full achievement list (e.g. 0/34) shows before the first in-emulator
  // unlock. Main returns [] for non-RA systems or when no credentials are set.
  // Deliberately NOT gated on a GameHub account login — RetroAchievements only
  // needs the RA credentials configured in Settings → Emulation.
  useEffect(() => {
    if (!gameTitle) return;
    if (game && game.shop !== "launchbox") return;

    const systemFromObjectId = objectId?.startsWith("minerva:")
      ? objectId.split(":")[1]
      : null;
    const system = platformToEmulatorSystem(
      game?.platform ?? platform ?? systemFromObjectId
    );
    if (!system) return;

    let cancelled = false;
    window.electron
      .loadRetroAchievementsList(
        shop,
        objectId,
        system as EmulatorSystem,
        gameTitle
      )
      .then((raAchievements) => {
        if (cancelled || raAchievements.length === 0) return;
        setAchievements(raAchievements);
      })
      .catch((err) => {
        console.error("[retroachievements] Failed to load list:", err);
      });

    return () => {
      cancelled = true;
    };
  }, [game?.objectId, game?.platform, gameTitle, platform, objectId, shop]);

  const getDownloadsPath = async () => {
    if (userPreferences?.downloadsPath) return userPreferences.downloadsPath;
    return window.electron.getDefaultDownloadsPath();
  };

  const selectGameExecutable = async () => {
    const downloadsPath = await getDownloadsPath();

    // For console/emulated games the "executable" is a ROM (or, for folder-based
    // systems like Cemu, the extracted game FOLDER) — not a Windows .exe. Filter
    // by the emulator's own launchable file types, and switch to a directory
    // picker when the system is folder-based.
    const emulatorSystem =
      shop === "launchbox"
        ? platformToEmulatorSystem(game?.platform ?? platform)
        : null;

    if (emulatorSystem) {
      const romConfig = await window.electron
        .getEmulatorRomFilters(emulatorSystem)
        .catch(() => ({ extensions: [] as string[], folderBased: false }));

      // On Windows/Linux, ['openFile','openDirectory'] resolves to a directory
      // picker (Electron can't do both) — exactly what Cemu needs; on macOS the
      // user can pick either. Non-folder systems stay file-only with ROM filters.
      const properties: Array<"openFile" | "openDirectory"> =
        romConfig.folderBased ? ["openFile", "openDirectory"] : ["openFile"];

      const romFilters = romConfig.extensions.length
        ? [
            {
              name: t("game_rom", { defaultValue: "Game ROM" }),
              extensions: romConfig.extensions,
            },
            { name: t("all_files"), extensions: ["*"] },
          ]
        : undefined;

      return window.electron
        .showOpenDialog({
          properties,
          defaultPath: downloadsPath,
          filters: romFilters,
        })
        .then(({ filePaths }) =>
          filePaths && filePaths.length > 0 ? filePaths[0] : null
        );
    }

    const filters = getGameExecutableFilters(
      globalThis.window.electron.platform,
      {
        executable: t("game_executable"),
        allFiles: t("all_files"),
      }
    );

    return window.electron
      .showOpenDialog({
        properties: ["openFile"],
        defaultPath: downloadsPath,
        filters,
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
