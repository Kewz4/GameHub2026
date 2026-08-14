import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  useLibrary,
  useAppDispatch,
  useAppSelector,
  useGameCollections,
  useToast,
  useUserDetails,
} from "@renderer/hooks";
import { setHeaderTitle } from "@renderer/features";
import {
  HeartIcon,
  TelescopeIcon,
  FileDirectoryIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import { Tooltip } from "react-tooltip";
import { AuthPage, removeDiacritics } from "@shared";
import { GameCollection, LibraryGame } from "@types";
import {
  Button,
  ConfirmationModal,
  ContextMenu,
  CreateCollectionModal,
  GameContextMenu,
  Modal,
  TextField,
} from "@renderer/components";
import { useSearchParams } from "react-router-dom";
import { LibraryGameCard } from "./library-game-card";
import { LibraryGameCardLarge } from "./library-game-card-large";
import { ViewOptions, ViewMode } from "./view-options";
import { FilterOptions, SortOption } from "./filter-options";
import { getGameOrigin } from "@renderer/helpers/game-origin";
import {
  CONSOLE_FILTER_SYSTEMS,
  CONSOLE_LABELS,
  systemForGame,
} from "./console-filter";
import { SettingSelect } from "@renderer/pages/settings/emulation/setting-select";
import type { EmulatorSystem } from "@types";
import "./library.scss";

const FAVORITES_COLLECTION_ID = "__favorites__";
const SORT_OPTIONS: SortOption[] = [
  "title_asc",
  "recently_played",
  "most_played",
  "installed_first",
  "title_desc",
];

const getGameCollectionIds = (game: LibraryGame): string[] => {
  if (Array.isArray(game.collectionIds)) {
    return game.collectionIds;
  }

  const legacyCollectionId = (game as { collectionId?: string | null })
    .collectionId;

  return legacyCollectionId ? [legacyCollectionId] : [];
};

export default function Library() {
  const { library, updateLibrary } = useLibrary();
  const { showSuccessToast, showErrorToast } = useToast();
  const { userDetails } = useUserDetails();
  const {
    collections,
    loadCollections,
    hasLoaded: hasLoadedCollections,
  } = useGameCollections();
  const [searchParams, setSearchParams] = useSearchParams();

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const savedViewMode = localStorage.getItem("library-view-mode");
    return (savedViewMode as ViewMode) || "compact";
  });
  const [sortBy, setSortBy] = useState<SortOption>(() => {
    const savedSortBy = localStorage.getItem("library-sort-by");
    if (savedSortBy && SORT_OPTIONS.includes(savedSortBy as SortOption)) {
      return savedSortBy as SortOption;
    }

    return "title_asc";
  });
  const [gameContextMenu, setGameContextMenu] = useState<{
    game: LibraryGame | null;
    visible: boolean;
    position: { x: number; y: number };
  }>({ game: null, visible: false, position: { x: 0, y: 0 } });
  const [collectionContextMenu, setCollectionContextMenu] = useState<{
    collection: GameCollection | null;
    visible: boolean;
    position: { x: number; y: number };
  }>({ collection: null, visible: false, position: { x: 0, y: 0 } });
  const [activeCollection, setActiveCollection] =
    useState<GameCollection | null>(null);
  const [showRenameCollectionModal, setShowRenameCollectionModal] =
    useState(false);
  const [collectionName, setCollectionName] = useState("");
  const [isRenamingCollection, setIsRenamingCollection] = useState(false);
  const [showDeleteCollectionModal, setShowDeleteCollectionModal] =
    useState(false);
  const [isDeletingCollection, setIsDeletingCollection] = useState(false);
  const [showCreateCollectionModal, setShowCreateCollectionModal] =
    useState(false);
  const [storeFilter, setStoreFilter] = useState<string>("all");
  // Console mode is a distinct filter mode (not a store): when on, the store
  // pills are ignored and the list shows console/ROM games — all of them, or a
  // single system when one is picked from the dropdown.
  const [consoleMode, setConsoleMode] = useState(false);
  const [consoleFilter, setConsoleFilter] = useState<EmulatorSystem | "all">(
    "all"
  );

  const searchQuery = useAppSelector((state) => state.library.searchQuery);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const dispatch = useAppDispatch();
  const { t } = useTranslation(["library", "sidebar"]);

  const selectedCollectionId = searchParams.get("collection");

  const handleCollectionSelect = useCallback(
    (collectionId: string | null) => {
      const params = new URLSearchParams(searchParams);

      if (collectionId) {
        params.set("collection", collectionId);
      } else {
        params.delete("collection");
      }

      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem("library-view-mode", mode);
  }, []);

  const handleSortChange = useCallback((nextSortBy: SortOption) => {
    setSortBy(nextSortBy);
    localStorage.setItem("library-sort-by", nextSortBy);
  }, []);

  useEffect(() => {
    dispatch(setHeaderTitle(t("library")));

    const unsubscribe = window.electron.onLibraryBatchComplete(() => {
      updateLibrary();
      void loadCollections();
    });

    window.electron.refreshLibraryAssets().finally(() => {
      const collectionsPromise = hasLoadedCollections
        ? Promise.resolve([])
        : loadCollections();

      void Promise.all([updateLibrary(), collectionsPromise]);
    });

    // Audit the whole library's installation state on each page visit. Heals
    // stale "installed" flags (files deleted outside GameHub) and re-marks
    // games whose files came back. Emulated games are checked via their bound
    // ROM disc instead of a game executable.
    void window.electron
      .checkLibraryInstallation(true)
      .then((report) => {
        if (report.stale.length > 0 || report.found.length > 0) {
          updateLibrary();
        }
      })
      .catch(() => {});

    return () => {
      unsubscribe();
    };
  }, [dispatch, t, updateLibrary, loadCollections, hasLoadedCollections]);

  const handleOnMouseEnterGameCard = useCallback(() => {
    // Optional: pause animations if needed
  }, []);

  const handleOnMouseLeaveGameCard = useCallback(() => {
    // Optional: resume animations if needed
  }, []);

  const handleOpenContextMenu = useCallback(
    (game: LibraryGame, position: { x: number; y: number }) => {
      setGameContextMenu({ game, visible: true, position });
    },
    []
  );

  const handleCloseContextMenu = useCallback(() => {
    setGameContextMenu((prev) => ({ ...prev, visible: false }));
  }, []);

  const handleOpenCollectionContextMenu = useCallback(
    (
      event: React.MouseEvent<HTMLButtonElement>,
      collection: GameCollection
    ) => {
      event.preventDefault();

      setCollectionContextMenu({
        collection,
        visible: true,
        position: { x: event.clientX, y: event.clientY },
      });
    },
    []
  );

  const handleCloseCollectionContextMenu = useCallback(() => {
    setCollectionContextMenu((prev) => ({ ...prev, visible: false }));
  }, []);

  const resolveCollectionErrorMessage = useCallback(
    (
      error: unknown,
      fallbackKey: "failed_rename_collection" | "failed_delete_collection"
    ) => {
      if (!(error instanceof Error)) return t(fallbackKey);

      if (error.message.includes("game/collection-name-already-in-use")) {
        return t("collection_name_already_in_use", { ns: "sidebar" });
      }

      if (error.message.includes("game/collection-name-required")) {
        return t("collection_name_required", { ns: "sidebar" });
      }

      return t(fallbackKey);
    },
    [t]
  );

  const handleOpenRenameCollectionModal = useCallback(() => {
    const collection = collectionContextMenu.collection;
    if (!collection) return;

    setActiveCollection(collection);
    setCollectionName(collection.name);
    setShowRenameCollectionModal(true);
    handleCloseCollectionContextMenu();
  }, [collectionContextMenu.collection, handleCloseCollectionContextMenu]);

  const handleCloseRenameCollectionModal = useCallback(() => {
    if (isRenamingCollection) return;

    setShowRenameCollectionModal(false);
    setCollectionName("");
    setActiveCollection(null);
  }, [isRenamingCollection]);

  const handleRenameCollection = useCallback(async () => {
    if (!activeCollection) return;

    const nextName = collectionName.trim();
    if (!nextName) {
      showErrorToast(t("collection_name_required", { ns: "sidebar" }));
      return;
    }

    if (nextName === activeCollection.name.trim()) {
      handleCloseRenameCollectionModal();
      return;
    }

    setIsRenamingCollection(true);

    try {
      await window.electron.hydraApi.put(
        `/profile/games/collections/${activeCollection.id}`,
        {
          data: { name: nextName },
          needsAuth: true,
        }
      );

      await loadCollections();
      showSuccessToast(t("collection_renamed"));
      handleCloseRenameCollectionModal();
    } catch (error) {
      showErrorToast(
        resolveCollectionErrorMessage(error, "failed_rename_collection")
      );
    } finally {
      setIsRenamingCollection(false);
    }
  }, [
    activeCollection,
    collectionName,
    handleCloseRenameCollectionModal,
    loadCollections,
    resolveCollectionErrorMessage,
    showErrorToast,
    showSuccessToast,
    t,
  ]);

  const handleOpenDeleteCollectionModal = useCallback(() => {
    const collection = collectionContextMenu.collection;
    if (!collection) return;

    setActiveCollection(collection);
    setShowDeleteCollectionModal(true);
    handleCloseCollectionContextMenu();
  }, [collectionContextMenu.collection, handleCloseCollectionContextMenu]);

  const handleCloseDeleteCollectionModal = useCallback(() => {
    if (isDeletingCollection) return;

    setShowDeleteCollectionModal(false);
    setActiveCollection(null);
  }, [isDeletingCollection]);

  const handleDeleteCollection = useCallback(async () => {
    if (!activeCollection) return;

    setIsDeletingCollection(true);

    try {
      await window.electron.hydraApi.delete(
        `/profile/games/collections/${activeCollection.id}`,
        { needsAuth: true }
      );

      if (selectedCollectionId === activeCollection.id) {
        handleCollectionSelect(null);
      }

      await Promise.all([loadCollections(), updateLibrary()]);
      showSuccessToast(t("collection_deleted"));
      handleCloseDeleteCollectionModal();
    } catch (error) {
      showErrorToast(
        resolveCollectionErrorMessage(error, "failed_delete_collection")
      );
    } finally {
      setIsDeletingCollection(false);
    }
  }, [
    activeCollection,
    selectedCollectionId,
    handleCollectionSelect,
    loadCollections,
    updateLibrary,
    showSuccessToast,
    t,
    handleCloseDeleteCollectionModal,
    showErrorToast,
    resolveCollectionErrorMessage,
  ]);

  const handleCreateCollectionButtonClick = useCallback(() => {
    if (!userDetails) {
      window.electron.openAuthWindow(AuthPage.SignIn);
      return;
    }

    setShowCreateCollectionModal(true);
  }, [userDetails]);

  const collectionContextMenuItems = useMemo(() => {
    const isCollectionActionBusy = isRenamingCollection || isDeletingCollection;

    return [
      {
        id: "rename-collection",
        label: t("rename_collection"),
        icon: <PencilIcon size={16} />,
        onClick: handleOpenRenameCollectionModal,
        disabled: isCollectionActionBusy,
      },
      {
        id: "delete-collection",
        label: t("delete_collection"),
        icon: <TrashIcon size={16} />,
        onClick: handleOpenDeleteCollectionModal,
        danger: true,
        disabled: isCollectionActionBusy,
      },
    ];
  }, [
    handleOpenDeleteCollectionModal,
    handleOpenRenameCollectionModal,
    isDeletingCollection,
    isRenamingCollection,
    t,
  ]);

  useEffect(() => {
    if (!selectedCollectionId) return;
    if (!hasLoadedCollections) return;

    if (selectedCollectionId === FAVORITES_COLLECTION_ID) return;

    const hasCollection = collections.some(
      (collection) => collection.id === selectedCollectionId
    );

    if (!hasCollection) {
      handleCollectionSelect(null);
    }
  }, [
    collections,
    selectedCollectionId,
    handleCollectionSelect,
    hasLoadedCollections,
  ]);

  const sortedLibrary = useMemo(() => {
    return [...library].sort((a, b) => {
      switch (sortBy) {
        case "recently_played": {
          const aHasPlayed = a.lastTimePlayed !== null;
          const bHasPlayed = b.lastTimePlayed !== null;

          if (aHasPlayed && bHasPlayed) {
            const aLastPlayed = new Date(a.lastTimePlayed as Date).getTime();
            const bLastPlayed = new Date(b.lastTimePlayed as Date).getTime();
            const lastPlayedDifference = bLastPlayed - aLastPlayed;
            if (lastPlayedDifference !== 0) return lastPlayedDifference;
          } else if (aHasPlayed !== bHasPlayed) {
            return aHasPlayed ? -1 : 1;
          }

          break;
        }

        case "most_played": {
          const playTimeDifference =
            b.playTimeInMilliseconds - a.playTimeInMilliseconds;
          if (playTimeDifference !== 0) return playTimeDifference;
          break;
        }

        case "installed_first": {
          const aIsInstalled =
            Boolean(a.executablePath) || a.installedSizeInBytes != null;
          const bIsInstalled =
            Boolean(b.executablePath) || b.installedSizeInBytes != null;

          if (aIsInstalled !== bIsInstalled) {
            return aIsInstalled ? -1 : 1;
          }

          break;
        }

        case "title_desc": {
          return (b.title ?? "").localeCompare(a.title ?? "", undefined, {
            sensitivity: "base",
          });
        }

        case "title_asc":
        default:
          break;
      }

      return (a.title ?? "").localeCompare(b.title ?? "", undefined, {
        sensitivity: "base",
      });
    });
  }, [library, sortBy]);

  const filteredLibrary = useMemo(() => {
    // Companion download entries (::update / ::dlc) are download tracking, not
    // games — never show them as library cards.
    let filtered = sortedLibrary.filter(
      (game) => !game.objectId.includes("::")
    );

    if (selectedCollectionId) {
      if (selectedCollectionId === FAVORITES_COLLECTION_ID) {
        filtered = filtered.filter((game) => game.favorite);
      } else {
        filtered = filtered.filter((game) =>
          getGameCollectionIds(game).includes(selectedCollectionId)
        );
      }
    }

    if (!deferredSearchQuery.trim()) return filtered;

    const queryLower = removeDiacritics(deferredSearchQuery).toLowerCase();
    return filtered.filter((game) => {
      if (!game.title) return false;
      const titleLower = removeDiacritics(game.title).toLowerCase();
      let queryIndex = 0;

      for (
        let i = 0;
        i < titleLower.length && queryIndex < queryLower.length;
        i++
      ) {
        if (titleLower[i] === queryLower[queryIndex]) {
          queryIndex++;
        }
      }

      return queryIndex === queryLower.length;
    });
  }, [sortedLibrary, deferredSearchQuery, selectedCollectionId]);

  const storeFilteredLibrary = useMemo(() => {
    // Console mode overrides the store pills entirely: show only console/ROM
    // games (shop "launchbox"), regardless of which store pill was last active.
    if (consoleMode) {
      return filteredLibrary.filter((g) => systemForGame(g) !== null);
    }

    if (storeFilter === "all") return filteredLibrary;

    // Platform filters — a game shows under its store tab only when it
    // resolves to "sync" (owned on that platform). getGameOrigin is
    // ownership-first and uses the GameHub download record to keep repacks
    // out, so owned games never leak into Retigga and repacks never leak into
    // the platform tabs — regardless of whether libraryOrigin was stamped.
    if (
      storeFilter === "steam" ||
      storeFilter === "epic" ||
      storeFilter === "gog" ||
      storeFilter === "xbox" ||
      storeFilter === "battlenet" ||
      storeFilter === "riot" ||
      storeFilter === "ubisoft" ||
      storeFilter === "ea"
    )
      return filteredLibrary.filter(
        (g) => g.shop === storeFilter && getGameOrigin(g) === "sync"
      );

    // Retigga = PC games that came from the Hydra repack catalogue.
    // Console/emulated games (shop "launchbox") have their own Console
    // dropdown and must NOT appear here — otherwise after a clear+re-add
    // they leak into Retigga instead of staying under "All" + the console
    // dropdown.
    if (storeFilter === "retigga")
      return filteredLibrary.filter(
        (g) => getGameOrigin(g) === "catalog" && g.shop !== "launchbox"
      );

    // Custom = manually added games. Exclude console/emulated games (shop
    // "launchbox") the same way Retigga does — a pre-fix scan stamped scanned
    // ROMs with libraryOrigin "custom", so guard against those leaking here too.
    if (storeFilter === "custom")
      return filteredLibrary.filter(
        (g) => getGameOrigin(g) === "custom" && g.shop !== "launchbox"
      );

    return filteredLibrary.filter((g) => g.shop === storeFilter);
  }, [filteredLibrary, storeFilter, consoleMode]);

  // Consoles that actually have games in the library, so the Console pill only
  // offers relevant options (and hides entirely when there are no ROM games).
  const availableConsoles = useMemo(() => {
    const present = new Set<EmulatorSystem>();
    for (const game of library) {
      const system = systemForGame(game);
      if (system) present.add(system);
    }
    return CONSOLE_FILTER_SYSTEMS.filter((s) => present.has(s));
  }, [library]);

  // A selected console narrows the (store-filtered) list to that console's ROMs.
  const consoleFilteredLibrary = useMemo(() => {
    if (consoleFilter === "all") return storeFilteredLibrary;
    return storeFilteredLibrary.filter(
      (game) => systemForGame(game) === consoleFilter
    );
  }, [storeFilteredLibrary, consoleFilter]);

  // Reset the console filter if the selected console no longer has any games.
  // Guarded on hasGames so it doesn't clear a deep-linked console during the
  // brief window before the library list has loaded.
  useEffect(() => {
    if (
      library.length > 0 &&
      consoleFilter !== "all" &&
      !availableConsoles.includes(consoleFilter)
    ) {
      setConsoleFilter("all");
    }
  }, [availableConsoles, consoleFilter, library.length]);

  // Honor a ?console=<system> deep link once, applied when that console's games
  // have loaded. The emulator setup / ROM-scan flow lands the user here so they
  // arrive filtered to the console they just set up.
  const consoleDeepLinkApplied = useRef(false);
  useEffect(() => {
    if (consoleDeepLinkApplied.current) return;
    const requested = searchParams.get("console");
    if (requested && availableConsoles.includes(requested as EmulatorSystem)) {
      consoleDeepLinkApplied.current = true;
      setConsoleMode(true);
      setConsoleFilter(requested as EmulatorSystem);
    }
  }, [searchParams, availableConsoles]);

  const favoritesCount = useMemo(() => {
    return library.filter((game) => game.favorite).length;
  }, [library]);

  const libraryCollections = useMemo<GameCollection[]>(() => {
    return [
      {
        id: FAVORITES_COLLECTION_ID,
        name: t("favorites"),
        gamesCount: favoritesCount,
      },
      ...collections,
    ];
  }, [collections, favoritesCount, t]);

  // Shared filter-pill style: active pills invert to a solid white chip with
  // black text; inactive pills are a subtle outline.
  const pillStyle = (active: boolean): React.CSSProperties => ({
    padding: "4px 10px",
    borderRadius: "12px",
    border: active ? "1px solid #ffffff" : "1px solid rgba(255,255,255,0.2)",
    background: active ? "#ffffff" : "transparent",
    color: active ? "#000000" : "inherit",
    cursor: "pointer",
    fontSize: "0.8rem",
    fontWeight: active ? 600 : 400,
    opacity: active ? 1 : 0.7,
  });

  const hasGames = library.length > 0;
  const hasNoFilteredGames = consoleFilteredLibrary.length === 0;
  const isFavoritesCollectionSelected =
    selectedCollectionId === FAVORITES_COLLECTION_ID;
  const shouldShowFavoritesEmptyState =
    hasGames && isFavoritesCollectionSelected && hasNoFilteredGames;
  const shouldShowCollectionEmptyState =
    hasGames &&
    !shouldShowFavoritesEmptyState &&
    Boolean(selectedCollectionId) &&
    !isFavoritesCollectionSelected &&
    hasNoFilteredGames;

  return (
    <section className="library__content">
      {hasGames && (
        <div className="library__page-header">
          <div className="library__controls-row">
            <div className="library__controls-left">
              <FilterOptions sortBy={sortBy} onSortChange={handleSortChange} />
            </div>

            <div className="library__controls-right">
              <ViewOptions
                viewMode={viewMode}
                onViewModeChange={handleViewModeChange}
              />
            </div>
          </div>

          <div
            className="library__store-filters"
            role="group"
            aria-label="Filter by store"
            style={{
              display: "flex",
              gap: "8px",
              flexWrap: "wrap",
              marginBottom: "8px",
            }}
          >
            {(
              [
                { value: "all", label: "All" },
                { value: "steam", label: "Steam" },
                { value: "epic", label: "Epic" },
                { value: "gog", label: "GOG" },
                { value: "xbox", label: "Xbox" },
                { value: "battlenet", label: "Battle.net" },
                { value: "riot", label: "Riot" },
                { value: "ubisoft", label: "Ubisoft" },
                { value: "ea", label: "EA" },
                { value: "retigga", label: "Retigga" },
                { value: "custom", label: "Custom" },
              ] as { value: string; label: string }[]
            ).map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  // Selecting a store pill leaves console mode.
                  setStoreFilter(value);
                  setConsoleMode(false);
                  setConsoleFilter("all");
                }}
                style={pillStyle(!consoleMode && storeFilter === value)}
              >
                {label}
              </button>
            ))}

            {/* Console: first click enters console mode (all console games,
                pill stays active); once active it's a picker to narrow to one
                system. Store pills are ignored while it's active. */}
            {availableConsoles.length > 0 &&
              (consoleMode ? (
                <SettingSelect
                  variant="pill"
                  ariaLabel="Filter by console"
                  active
                  value={consoleFilter}
                  onChange={(v) =>
                    setConsoleFilter(v as EmulatorSystem | "all")
                  }
                  options={[
                    { value: "all", label: "All consoles" },
                    ...availableConsoles.map((system) => ({
                      value: system,
                      label: CONSOLE_LABELS[system] ?? system,
                    })),
                  ]}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setConsoleMode(true);
                    setConsoleFilter("all");
                  }}
                  style={pillStyle(false)}
                >
                  {t("console", { defaultValue: "Console" })}
                </button>
              ))}
          </div>

          <div className="library__collections-section">
            <div className="library__collections-header">
              <small className="library__collections-title">
                {t("collections")}
              </small>
              <button
                type="button"
                className="library__add-collection-button"
                onClick={handleCreateCollectionButtonClick}
                aria-label={t("create_collection", { ns: "sidebar" })}
                data-tooltip-id="library-create-collection-tooltip"
                data-tooltip-content={t("create_collection_tooltip", {
                  ns: "sidebar",
                })}
                data-tooltip-place="top"
              >
                <PlusIcon size={16} />
              </button>
            </div>

            <div
              className="library__collections"
              role="group"
              aria-label={t("collections")}
            >
              {libraryCollections.map((collection) => {
                const isFavoritesCollection =
                  collection.id === FAVORITES_COLLECTION_ID;

                return (
                  <button
                    key={collection.id}
                    type="button"
                    className={`library__collection-item ${selectedCollectionId === collection.id ? "library__collection-item--active" : ""}`}
                    onClick={() =>
                      handleCollectionSelect(
                        selectedCollectionId === collection.id
                          ? null
                          : collection.id
                      )
                    }
                    onContextMenu={
                      isFavoritesCollection
                        ? undefined
                        : (event) =>
                            handleOpenCollectionContextMenu(event, collection)
                    }
                  >
                    {isFavoritesCollection ? (
                      <HeartIcon size={16} />
                    ) : (
                      <FileDirectoryIcon size={16} />
                    )}
                    <span>{collection.name}</span>
                    <span className="library__collection-count">
                      {collection.gamesCount}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {!hasGames && (
        <div className="library__no-games">
          <div className="library__telescope-icon">
            <TelescopeIcon size={24} />
          </div>
          <h2>{t("no_games_title")}</h2>
          <p>{t("no_games_description")}</p>
        </div>
      )}

      {shouldShowFavoritesEmptyState && (
        <div className="library__empty">
          <div className="library__icon-container">
            <HeartIcon size={24} />
          </div>
          <h2>{t("empty_favorites_title")}</h2>
          <p>{t("empty_favorites_description")}</p>
        </div>
      )}

      {shouldShowCollectionEmptyState && (
        <div className="library__empty">
          <div className="library__icon-container">
            <FileDirectoryIcon size={24} />
          </div>
          <h2>{t("empty_collection_title")}</h2>
          <p>{t("empty_collection_description")}</p>
        </div>
      )}

      {hasGames &&
        !shouldShowFavoritesEmptyState &&
        !shouldShowCollectionEmptyState && (
          <AnimatePresence mode="wait">
            {viewMode === "large" && (
              <motion.div
                key={`${sortBy}-large`}
                className="library__games-list library__games-list--large"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                transition={{ duration: 0.2 }}
              >
                {consoleFilteredLibrary.map((game) => (
                  <LibraryGameCardLarge
                    key={game.id}
                    game={game}
                    onContextMenu={handleOpenContextMenu}
                  />
                ))}
              </motion.div>
            )}

            {viewMode !== "large" && (
              <motion.ul
                key={`${sortBy}-${viewMode}`}
                className={`library__games-grid library__games-grid--${viewMode}`}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                transition={{ duration: 0.2 }}
              >
                {consoleFilteredLibrary.map((game) => (
                  <li key={game.id} style={{ listStyle: "none" }}>
                    <LibraryGameCard
                      game={game}
                      onMouseEnter={handleOnMouseEnterGameCard}
                      onMouseLeave={handleOnMouseLeaveGameCard}
                      onContextMenu={handleOpenContextMenu}
                    />
                  </li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        )}

      {gameContextMenu.game && (
        <GameContextMenu
          game={gameContextMenu.game}
          visible={gameContextMenu.visible}
          position={gameContextMenu.position}
          onClose={handleCloseContextMenu}
        />
      )}

      <ContextMenu
        items={collectionContextMenuItems}
        visible={collectionContextMenu.visible}
        position={collectionContextMenu.position}
        onClose={handleCloseCollectionContextMenu}
      />

      <Modal
        visible={showRenameCollectionModal}
        title={t("rename_collection")}
        description={t("rename_collection_description")}
        onClose={handleCloseRenameCollectionModal}
      >
        <div className="library__collection-modal">
          <TextField
            label={t("collection_name", { ns: "sidebar" })}
            placeholder={t("collection_name_placeholder", { ns: "sidebar" })}
            value={collectionName}
            onChange={(event) => setCollectionName(event.target.value)}
            theme="dark"
            disabled={isRenamingCollection}
            maxLength={60}
          />

          <div className="library__collection-modal-actions">
            <Button
              type="button"
              theme="outline"
              onClick={handleCloseRenameCollectionModal}
              disabled={isRenamingCollection}
            >
              {t("cancel", { ns: "sidebar" })}
            </Button>

            <Button
              type="button"
              theme="primary"
              onClick={handleRenameCollection}
              disabled={!collectionName.trim() || isRenamingCollection}
            >
              {isRenamingCollection
                ? t("renaming_collection")
                : t("rename_collection")}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmationModal
        visible={showDeleteCollectionModal}
        title={t("delete_collection_title")}
        descriptionText={t("delete_collection_description", {
          collectionName: activeCollection?.name ?? "",
        })}
        onClose={handleCloseDeleteCollectionModal}
        onConfirm={() => {
          void handleDeleteCollection();
        }}
        cancelButtonLabel={t("cancel", { ns: "sidebar" })}
        confirmButtonLabel={t("delete_collection")}
        buttonsIsDisabled={isDeletingCollection}
      />

      <CreateCollectionModal
        visible={showCreateCollectionModal}
        onClose={() => setShowCreateCollectionModal(false)}
      />

      <Tooltip id="library-create-collection-tooltip" />
    </section>
  );
}
