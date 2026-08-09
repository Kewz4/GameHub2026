import { useTranslation } from "react-i18next";

import {
  useAppSelector,
  useDownload,
  useDownloadLayout,
  useLibrary,
} from "@renderer/hooks";

import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { BinaryNotFoundModal } from "../shared-modals/binary-not-found-modal";
import "./downloads.scss";
import { DeleteGameModal } from "./delete-game-modal";
import { DownloadGroup } from "./download-group";
import {
  getDownloadId,
  getRendererDownloadBucket,
  type GameShop,
  type LibraryGame,
  type SeedingStatus,
} from "../../../../types";
import { orderBy } from "lodash-es";
import { ArrowDownIcon, FileIcon, LinkIcon } from "@primer/octicons-react";
import { CustomDownloadModal } from "./custom-download-modal";
import {
  CUSTOM_DOWNLOAD_ENTRY_OPTIONS,
  type CustomDownloadEntryIntent,
} from "@shared";
import {
  getAdjacentDownloadManagerTab,
  type DownloadManagerTab,
} from "./download-manager-tabs";

export default function Downloads() {
  const { library, updateLibrary } = useLibrary();
  const { layoutState } = useDownloadLayout();
  const extraction = useAppSelector((state) => state.download.extraction);
  const torBoxConnected = useAppSelector((state) =>
    Boolean(state.userPreferences.value?.torBoxApiToken?.trim())
  );

  const { t } = useTranslation("downloads");

  const gameToBeDeleted = useRef<[GameShop, string] | null>(null);

  const [showBinaryNotFoundModal, setShowBinaryNotFoundModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [activeTab, setActiveTab] = useState<DownloadManagerTab>("downloads");
  const downloadsTabRef = useRef<HTMLButtonElement>(null);
  const customTabRef = useRef<HTMLButtonElement>(null);
  const [customDownloadIntent, setCustomDownloadIntent] =
    useState<CustomDownloadEntryIntent | null>(null);

  const handleManagerTabKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>
  ) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

    event.preventDefault();
    const nextTab = getAdjacentDownloadManagerTab(activeTab, event.key);
    setActiveTab(nextTab);
    (nextTab === "downloads" ? downloadsTabRef : customTabRef).current?.focus();
  };

  const { removeGameInstaller, pauseSeeding } = useDownload();

  const handleDeleteGame = async () => {
    if (gameToBeDeleted.current) {
      const [shop, objectId] = gameToBeDeleted.current;

      await pauseSeeding(shop, objectId);
      await removeGameInstaller(shop, objectId);
    }
  };

  const { lastPacket } = useDownload();

  const [seedingStatus, setSeedingStatus] = useState<SeedingStatus[]>([]);

  useEffect(() => {
    window.electron.onSeedingStatus((value) => setSeedingStatus(value));

    const unsubscribeExtraction = window.electron.onExtractionComplete(() => {
      updateLibrary();
    });

    return () => {
      unsubscribeExtraction();
    };
  }, [updateLibrary]);

  const handleOpenGameInstaller = (shop: GameShop, objectId: string) =>
    window.electron.openGameInstaller(shop, objectId).then((wasOpened) => {
      if (!wasOpened) {
        setShowBinaryNotFoundModal(true);
      }

      updateLibrary();
    });

  const handleOpenDeleteGameModal = (shop: GameShop, objectId: string) => {
    gameToBeDeleted.current = [shop, objectId];
    setShowDeleteModal(true);
  };

  // Companion downloads (`base::update` / `base::dlc::…`) carry no artwork of
  // their own, so their hero renders a broken image. Borrow the base game's
  // artwork so they show the game's hero (a "DLC"/"Update" badge is added by the
  // hero component).
  const enrichedLibrary = useMemo(() => {
    const baseByKey = new Map<string, LibraryGame>();
    for (const game of library) {
      if (!game.objectId.includes("::")) {
        baseByKey.set(`${game.shop}:${game.objectId}`, game);
      }
    }
    return library.map((game) => {
      if (!game.objectId.includes("::")) return game;
      const base = baseByKey.get(
        `${game.shop}:${game.objectId.split("::")[0]}`
      );
      if (!base) return game;
      return {
        ...game,
        libraryHeroImageUrl:
          game.libraryHeroImageUrl ?? base.libraryHeroImageUrl,
        libraryImageUrl: game.libraryImageUrl ?? base.libraryImageUrl,
        logoImageUrl: game.logoImageUrl ?? base.logoImageUrl,
        coverImageUrl: game.coverImageUrl ?? base.coverImageUrl,
      };
    });
  }, [library]);

  const libraryGroup: Record<string, LibraryGame[]> = useMemo(() => {
    const initialValue: Record<string, LibraryGame[]> = {
      downloading: [],
      queued: [],
      complete: [],
    };

    const queueOrder = layoutState.queueOrder;
    const pausedOrder = layoutState.pausedOrder;
    const queueOrderIndex = new Map(queueOrder.map((id, index) => [id, index]));
    const pausedOrderIndex = new Map(
      pausedOrder.map((id, index) => [id, index])
    );

    const result = enrichedLibrary.reduce((prev, next) => {
      if (!next.download) return prev;

      const bucket = getRendererDownloadBucket(next.download, {
        hasLiveProgress:
          lastPacket?.gameId === next.id && next.download.status === "active",
        isExtracting: extraction?.visibleId === next.id,
      });

      if (bucket === "hidden") return prev;
      if (bucket === "inProgress") {
        return { ...prev, downloading: [...prev.downloading, next] };
      }

      if (bucket === "queued") {
        return { ...prev, queued: [...prev.queued, next] };
      }

      return { ...prev, complete: [...prev.complete, next] };
    }, initialValue);

    const queued = [...result.queued].sort((left, right) => {
      const leftDownload = left.download!;
      const rightDownload = right.download!;
      const leftId = getDownloadId(leftDownload);
      const rightId = getDownloadId(rightDownload);
      const leftInQueue = queueOrderIndex.get(leftId);
      const rightInQueue = queueOrderIndex.get(rightId);
      const leftInPaused = pausedOrderIndex.get(leftId);
      const rightInPaused = pausedOrderIndex.get(rightId);

      if (leftInQueue != null && rightInQueue != null) {
        return leftInQueue - rightInQueue;
      }

      if (leftInQueue != null) return -1;
      if (rightInQueue != null) return 1;

      if (leftInPaused != null && rightInPaused != null) {
        return leftInPaused - rightInPaused;
      }

      return (leftDownload.timestamp ?? 0) - (rightDownload.timestamp ?? 0);
    });

    const complete = orderBy(result.complete, (game) =>
      game.download?.progress === 1 ? 0 : 1
    );

    return {
      ...result,
      queued,
      complete,
    };
  }, [extraction?.visibleId, lastPacket?.gameId, layoutState, enrichedLibrary]);

  const queuedGameIds = useMemo(
    () => libraryGroup.queued.map((game) => game.id),
    [libraryGroup.queued]
  );

  const downloadGroups = [
    {
      title: t("download_in_progress"),
      library: libraryGroup.downloading,
      queuedGameIds: [] as string[],
    },
    {
      title: t("queued_downloads"),
      library: libraryGroup.queued,
      queuedGameIds,
    },
    {
      title: t("downloads_completed"),
      library: libraryGroup.complete,
      queuedGameIds: [] as string[],
    },
  ];

  const hasItemsInLibrary = useMemo(() => {
    return Object.values(libraryGroup).some((group) => group.length > 0);
  }, [libraryGroup]);

  return (
    <>
      <BinaryNotFoundModal
        visible={showBinaryNotFoundModal}
        onClose={() => setShowBinaryNotFoundModal(false)}
      />

      <DeleteGameModal
        visible={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        deleteGame={handleDeleteGame}
      />

      <CustomDownloadModal
        visible={customDownloadIntent !== null}
        initialIntent={customDownloadIntent ?? "link"}
        onClose={() => setCustomDownloadIntent(null)}
        onSubmitted={() => {
          setActiveTab("downloads");
          void updateLibrary();
        }}
      />

      <div className="downloads__page">
        <header className="downloads__manager-header">
          <div>
            <h2>Download manager</h2>
            <p>Manage transfers or submit your own TorBox source.</p>
          </div>
          <div
            className="downloads__tabs"
            role="tablist"
            aria-label="Download manager views"
          >
            <button
              ref={downloadsTabRef}
              id="downloads-manager-tab-downloads"
              type="button"
              role="tab"
              aria-selected={activeTab === "downloads"}
              aria-controls="downloads-manager-panel-downloads"
              tabIndex={activeTab === "downloads" ? 0 : -1}
              className={activeTab === "downloads" ? "is-active" : ""}
              onClick={() => setActiveTab("downloads")}
              onKeyDown={handleManagerTabKeyDown}
            >
              <ArrowDownIcon size={16} />
              Downloads
            </button>
            <button
              ref={customTabRef}
              id="downloads-manager-tab-custom"
              type="button"
              role="tab"
              aria-selected={activeTab === "custom"}
              aria-controls="downloads-manager-panel-custom"
              tabIndex={activeTab === "custom" ? 0 : -1}
              className={activeTab === "custom" ? "is-active" : ""}
              onClick={() => setActiveTab("custom")}
              onKeyDown={handleManagerTabKeyDown}
            >
              <LinkIcon size={16} />
              Add custom
            </button>
          </div>
        </header>

        {activeTab === "custom" ? (
          <section
            id="downloads-manager-panel-custom"
            className="downloads__custom-panel"
            role="tabpanel"
            aria-labelledby="downloads-manager-tab-custom"
          >
            <div className="downloads__custom-heading">
              <div>
                <h2>Add a game download</h2>
                <p>
                  Pick the source you found. GameHub checks TorBox, downloads
                  it, extracts supported archives, and adds the game to your
                  library.
                </p>
              </div>
              <span
                className={`downloads__torbox-status ${
                  torBoxConnected ? "is-connected" : ""
                }`}
              >
                {torBoxConnected ? "TorBox connected" : "TorBox setup needed"}
              </span>
            </div>

            <div className="downloads__custom-options">
              {CUSTOM_DOWNLOAD_ENTRY_OPTIONS.map((option) => (
                <button
                  key={option.intent}
                  type="button"
                  onClick={() => setCustomDownloadIntent(option.intent)}
                >
                  <span className="downloads__custom-option-icon">
                    {option.intent === "torrent" ? (
                      <FileIcon size={22} />
                    ) : (
                      <LinkIcon size={22} />
                    )}
                  </span>
                  <span>
                    <strong>{option.title}</strong>
                    <small>{option.description}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ) : hasItemsInLibrary ? (
          <section className="downloads__container">
            <div
              id="downloads-manager-panel-downloads"
              className="downloads__groups"
              role="tabpanel"
              aria-labelledby="downloads-manager-tab-downloads"
            >
              {downloadGroups.map((group) => (
                <DownloadGroup
                  key={group.title}
                  title={group.title}
                  library={group.library}
                  openDeleteGameModal={handleOpenDeleteGameModal}
                  openGameInstaller={handleOpenGameInstaller}
                  seedingStatus={seedingStatus}
                  queuedGameIds={group.queuedGameIds}
                />
              ))}
            </div>
          </section>
        ) : (
          <div
            id="downloads-manager-panel-downloads"
            className="downloads__no-downloads"
            role="tabpanel"
            aria-labelledby="downloads-manager-tab-downloads"
          >
            <div className="downloads__arrow-icon">
              <ArrowDownIcon size={24} />
            </div>
            <h2>{t("no_downloads_title")}</h2>
            <p>{t("no_downloads_description")}</p>
          </div>
        )}
      </div>
    </>
  );
}
