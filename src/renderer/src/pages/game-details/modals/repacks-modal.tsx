import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  PlusCircleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  TrophyIcon,
  ZapIcon,
} from "@primer/octicons-react";
import { Tooltip } from "react-tooltip";

import {
  Badge,
  Button,
  DebridBadge,
  Modal,
  TextField,
  CheckboxField,
} from "@renderer/components";
import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import EpicLogo from "@renderer/assets/epic-logo.svg?react";
import GogLogo from "@renderer/assets/gog-logo.svg?react";
import XboxLogo from "@renderer/assets/xbox-logo.svg?react";
import BattleNetLogo from "@renderer/assets/battlenet-logo.svg?react";
import RiotLogo from "@renderer/assets/riot-logo.svg?react";
import UbisoftLogo from "@renderer/assets/ubisoft-logo.svg?react";
import EaLogo from "@renderer/assets/ea-logo.svg?react";
import type { DownloadSource, Game, GameRepack } from "@types";

import { DownloadSettingsModal } from "./download-settings-modal";
import {
  EpicGogDownloadModal,
  type EpicGogPlatform,
} from "./epic-gog-download-modal";
import { gameDetailsContext } from "@renderer/context";
import { Downloader } from "@shared";
import { orderBy } from "lodash-es";
import {
  useDate,
  useDownload,
  useFeature,
  useAppDispatch,
  useAppSelector,
  useToast,
} from "@renderer/hooks";
import { clearNewDownloadOptions } from "@renderer/features";
import { levelDBService } from "@renderer/services/leveldb.service";
import { getGameKey } from "@renderer/helpers";
import { getGameOrigin } from "@renderer/helpers/game-origin";
import { resolveRepackFileSelection } from "@renderer/helpers/resolve-repack-file-selection";
import "./repacks-modal.scss";

export interface RepacksModalProps {
  visible: boolean;
  startDownload: (
    repack: GameRepack,
    downloader: Downloader,
    downloadPath: string,
    automaticallyExtract: boolean,
    addToQueueOnly?: boolean,
    fileIndices?: number[],
    selectedFilesSize?: number | null,
    automaticallyDeleteArchiveFiles?: boolean,
    signal?: AbortSignal
  ) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
  sharedLink?: boolean;
}

export function RepacksModal({
  visible,
  startDownload,
  onClose,
  sharedLink = false,
}: Readonly<RepacksModalProps>) {
  const [filteredRepacks, setFilteredRepacks] = useState<GameRepack[]>([]);
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const [repack, setRepack] = useState<GameRepack | null>(null);
  const [showSelectFolderModal, setShowSelectFolderModal] = useState(false);
  const [downloadSources, setDownloadSources] = useState<DownloadSource[]>([]);
  const [selectedFingerprints, setSelectedFingerprints] = useState<string[]>(
    []
  );
  const [filterTerm, setFilterTerm] = useState("");

  const [hashesInDebrid, setHashesInDebrid] = useState<Record<string, boolean>>(
    {}
  );
  const [lastCheckTimestamp, setLastCheckTimestamp] = useState<string | null>(
    null
  );
  const [isLoadingTimestamp, setIsLoadingTimestamp] = useState(true);
  const [viewedRepackIds, setViewedRepackIds] = useState<Set<string>>(
    new Set()
  );

  const { game, repacks, objectId, shop, gameTitle } =
    useContext(gameDetailsContext);
  const { addGameToQueue } = useDownload();

  const { t } = useTranslation("game_details");

  const { formatDate } = useDate();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const {
    showSuccessToast: _showSuccessToast,
    showErrorToast: _showErrorToast,
  } = useToast();
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const getHashFromMagnet = (magnet: string) => {
    if (!magnet || typeof magnet !== "string") {
      return null;
    }

    const hashRegex = /xt=urn:btih:([a-zA-Z0-9]+)/i;
    const match = magnet.match(hashRegex);

    return match ? match[1].toLowerCase() : null;
  };

  const { isFeatureEnabled, Feature } = useFeature();

  useEffect(() => {
    if (!isFeatureEnabled(Feature.NimbusPreview)) {
      return;
    }

    const magnets = repacks.flatMap((repack) =>
      repack.uris.filter((uri) => uri.startsWith("magnet:"))
    );

    window.electron.checkDebridAvailability(magnets).then((availableHashes) => {
      setHashesInDebrid(availableHashes);
    });
  }, [repacks, isFeatureEnabled, Feature]);

  useEffect(() => {
    const fetchDownloadSources = async () => {
      const sources = (await levelDBService.values(
        "downloadSources"
      )) as DownloadSource[];
      const sorted = orderBy(sources, "createdAt", "desc");
      setDownloadSources(sorted);
    };

    fetchDownloadSources();
  }, []);

  useEffect(() => {
    const fetchLastCheckTimestamp = async () => {
      setIsLoadingTimestamp(true);

      try {
        const timestamp = (await levelDBService.get(
          "downloadSourcesSinceValue",
          null,
          "utf8"
        )) as string | null;

        setLastCheckTimestamp(timestamp);
      } catch {
        setLastCheckTimestamp(null);
      } finally {
        setIsLoadingTimestamp(false);
      }
    };

    if (visible && userPreferences?.enableNewDownloadOptionsBadges !== false) {
      fetchLastCheckTimestamp();
    } else {
      setIsLoadingTimestamp(false);
    }
  }, [visible, repacks, userPreferences?.enableNewDownloadOptionsBadges]);

  useEffect(() => {
    if (
      visible &&
      game?.newDownloadOptionsCount &&
      game.newDownloadOptionsCount > 0
    ) {
      const gameKey = getGameKey(game.shop, game.objectId);
      levelDBService
        .get(gameKey, "games")
        .then((gameData) => {
          if (gameData) {
            const updated = {
              ...(gameData as Game),
              newDownloadOptionsCount: undefined,
            };
            return levelDBService.put(gameKey, updated, "games");
          }
          return Promise.resolve();
        })
        .catch(() => {});

      const gameId = `${game.shop}:${game.objectId}`;
      dispatch(clearNewDownloadOptions({ gameId }));
    }
  }, [visible, game, dispatch]);

  const REGION_RE = /\((USA|Europe|Japan|World)\)/i;

  // Prefer the structured `region` field (set by the minerva handlers); fall
  // back to parsing the title only for older entries that lack it.
  const regionOf = (repack: GameRepack): string | null => {
    if (repack.region) return repack.region;
    const m = repack.title.match(REGION_RE);
    return m ? m[1] : null;
  };

  const availableRegions = useMemo<string[]>(() => {
    const isMinerva = repacks.some((r) =>
      r.downloadSourceName?.toLowerCase().includes("minerva")
    );
    if (!isMinerva) return [];
    const regions = new Set<string>();
    for (const r of repacks) {
      const region = regionOf(r);
      if (region) regions.add(region);
    }
    return Array.from(regions);
  }, [repacks]);

  // Auto-select USA when regions first appear
  useEffect(() => {
    if (availableRegions.length > 0 && selectedRegion === null) {
      setSelectedRegion(
        availableRegions.includes("USA") ? "USA" : availableRegions[0]
      );
    }
    if (availableRegions.length === 0) setSelectedRegion(null);
  }, [availableRegions]);

  const sortedRepacks = useMemo(() => {
    const contentTypeOrder = { game: 0, update: 1, dlc: 2 };
    return orderBy(
      repacks,
      [
        (repack) => contentTypeOrder[repack.contentType ?? "game"] ?? 0,
        (repack) => {
          const magnet = repack.uris.find((uri) => uri.startsWith("magnet:"));
          const hash = magnet ? getHashFromMagnet(magnet) : null;
          return hash ? (hashesInDebrid[hash] ?? false) : false;
        },
        (repack) => repack.uploadDate,
      ],
      ["asc", "desc", "desc"]
    );
  }, [repacks, hashesInDebrid]);

  const getRepackAvailabilityStatus = (
    repack: GameRepack
  ): "online" | "partial" | "offline" => {
    const uris = Array.isArray(repack.uris) ? repack.uris : [];
    const unavailableSet = new Set(repack.unavailableUris ?? []);
    const availableCount = uris.filter(
      (uri) => !unavailableSet.has(uri)
    ).length;
    const unavailableCount = uris.length - availableCount;

    if (uris.length === 0) return "offline";
    if (unavailableCount === 0) return "online";
    if (availableCount === 0) return "offline";
    return "partial";
  };

  useEffect(() => {
    const term = filterTerm.trim().toLowerCase();

    const byRegion = sortedRepacks.filter((repack) => {
      if (!selectedRegion || availableRegions.length < 2) return true;
      const region = regionOf(repack);
      if (!region) return true; // region-free entries (e.g. World) always shown
      return region.toLowerCase() === selectedRegion.toLowerCase();
    });

    const byTerm = byRegion.filter((repack) => {
      if (!term) return true;
      const lowerTitle = repack.title.toLowerCase();
      const lowerRepacker = repack.downloadSourceName.toLowerCase();
      return lowerTitle.includes(term) || lowerRepacker.includes(term);
    });

    const bySource = byTerm.filter((repack) => {
      if (selectedFingerprints.length === 0) return true;

      return downloadSources.some(
        (src) =>
          src.fingerprint &&
          selectedFingerprints.includes(src.fingerprint) &&
          src.name === repack.downloadSourceName
      );
    });

    setFilteredRepacks(bySource);
  }, [
    sortedRepacks,
    filterTerm,
    selectedFingerprints,
    downloadSources,
    selectedRegion,
    availableRegions,
  ]);

  const openDownloadSettings = (repack: GameRepack) => {
    setRepack(repack);
    setShowSelectFolderModal(true);
    setViewedRepackIds((prev) => new Set(prev).add(repack.id));
  };

  const handleRepackClick = (repack: GameRepack) => {
    const ct = repack.contentType ?? "game";
    if (ct !== "game") {
      openDownloadSettings(repack);
      return;
    }

    // For base game repacks, check if there are updates/DLC to prompt about —
    // but ONLY for the SAME region as the base the user picked. Otherwise a USA
    // download would also offer (and total the size of) the European update+DLC,
    // and vice-versa. Region-free update/DLC ("World") always apply.
    const baseRegion = regionOf(repack);
    const sameRegion = (r: GameRepack) => {
      const region = regionOf(r);
      if (!region || !baseRegion) return true;
      return region.toLowerCase() === baseRegion.toLowerCase();
    };
    const updates = sortedRepacks.filter(
      (r) => r.contentType === "update" && sameRegion(r)
    );
    const dlcs = sortedRepacks.filter(
      (r) => r.contentType === "dlc" && sameRegion(r)
    );

    if (updates.length === 0 && dlcs.length === 0) {
      openDownloadSettings(repack);
      return;
    }

    setPendingBaseRepack(repack);
    setPendingUpdates(updates);
    setPendingDLCs(dlcs);
    setApplyUpdate(false);
    setApplyDLC(false);
    setViewedRepackIds((prev) => new Set(prev).add(repack.id));

    if (updates.length > 0) {
      setShowUpdatePrompt(true);
    } else if (dlcs.length > 0) {
      setShowDLCPrompt(true);
    }
  };

  /** Parse a human-readable size string like "1.8 GB" → gigabytes as a number. */
  const parseSizeGB = (size: string | null): number => {
    if (!size) return 0;
    const m = size.match(/([\d.]+)\s*(TB|GB|MB|KB)/i);
    if (!m) return 0;
    const v = parseFloat(m[1]);
    switch (m[2].toUpperCase()) {
      case "TB":
        return v * 1024;
      case "GB":
        return v;
      case "MB":
        return v / 1024;
      case "KB":
        return v / (1024 * 1024);
      default:
        return 0;
    }
  };

  const formatGB = (gb: number): string => {
    if (gb === 0) return "";
    return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(gb * 1024).toFixed(0)} MB`;
  };

  const totalDownloadSize = (packs: (GameRepack | null)[]): string => {
    const total = packs
      .filter(Boolean)
      .reduce((s, r) => s + parseSizeGB(r!.fileSize), 0);
    return formatGB(total);
  };

  const handleUpdatePromptConfirm = () => {
    setApplyUpdate(true);
    setShowUpdatePrompt(false);
    if (pendingDLCs.length > 0) {
      setShowDLCPrompt(true);
    } else {
      openDownloadSettings(pendingBaseRepack!);
    }
  };

  const handleUpdatePromptCancel = () => {
    setShowUpdatePrompt(false);
    if (pendingDLCs.length > 0) {
      setShowDLCPrompt(true);
    } else {
      openDownloadSettings(pendingBaseRepack!);
    }
  };

  const handleDLCPromptConfirm = () => {
    setApplyDLC(true);
    setShowDLCPrompt(false);
    openDownloadSettings(pendingBaseRepack!);
  };

  const handleDLCPromptCancel = () => {
    setApplyDLC(false);
    setShowDLCPrompt(false);
    openDownloadSettings(pendingBaseRepack!);
  };

  // Called after the base game download/queue is confirmed so we can queue update + DLC
  const handleBaseDownloadStarted = async (
    downloader: Parameters<typeof startDownload>[1],
    downloadPath: Parameters<typeof startDownload>[2],
    automaticallyExtract: Parameters<typeof startDownload>[3],
    automaticallyDeleteArchiveFiles: Parameters<typeof startDownload>[7]
  ) => {
    if (!objectId || !shop) return;

    // Minerva update/DLC repacks live inside a shared collection torrent —
    // resolve the repack's exact file so the queued download doesn't pull the
    // whole archive (or a wrong-region file). Skip queuing when the file
    // can't be resolved rather than start an unbounded download.
    const selectionFor = async (
      rp: GameRepack,
      uri: string
    ): Promise<{
      fileIndices: number[] | undefined;
      selectedFilesSize: number | null;
    } | null> => {
      if (!rp.fileName || !uri?.startsWith("magnet:")) {
        return { fileIndices: undefined, selectedFilesSize: null };
      }
      try {
        const selection = await resolveRepackFileSelection(rp, uri);
        return selection
          ? {
              fileIndices: selection.fileIndices,
              selectedFilesSize: selection.selectedFilesSize,
            }
          : { fileIndices: undefined, selectedFilesSize: null };
      } catch (err) {
        console.error("[minerva] Skipping queue — file not resolved:", err);
        return null;
      }
    };

    if (applyUpdate && pendingUpdates.length > 0) {
      const updateRepack = pendingUpdates[0];
      const updateUri =
        updateRepack.uris.find((u) => u.startsWith("magnet:")) ??
        updateRepack.uris[0];
      const updateSelection = await selectionFor(updateRepack, updateUri);
      // updateRepack.title is now already "Update v208" (enriched in IPC handler)
      if (updateSelection) {
        await addGameToQueue({
          objectId: `${objectId}::update`,
          title: gameTitle
            ? `${gameTitle} — ${updateRepack.title}`
            : updateRepack.title,
          shop,
          downloader,
          downloadPath,
          uri: updateUri,
          automaticallyExtract,
          automaticallyDeleteArchiveFiles:
            automaticallyDeleteArchiveFiles ?? false,
          fileSize: updateRepack.fileSize,
          fileIndices: updateSelection.fileIndices,
          selectedFilesSize: updateSelection.selectedFilesSize,
          targetFileName: updateRepack.fileName ?? null,
          // Route the update into the same "Emulator Games/<platform>" folder
          // as the base game so the post-download hook can place it correctly.
          emulatorSystem: updateRepack.emulatorSystem ?? null,
        }).catch(() => {});
      }
    }

    if (applyDLC && pendingDLCs.length > 0) {
      for (const dlcRepack of pendingDLCs) {
        const dlcSlug = dlcRepack.title
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "-")
          .slice(0, 40);
        const dlcUri =
          dlcRepack.uris.find((u) => u.startsWith("magnet:")) ??
          dlcRepack.uris[0];
        const dlcSelection = await selectionFor(dlcRepack, dlcUri);
        if (!dlcSelection) continue;
        await addGameToQueue({
          objectId: `${objectId}::dlc::${dlcSlug}`,
          // dlcRepack.title is now the DLC name (e.g. "DLC Pack 2") from IPC handler
          title: gameTitle
            ? `${gameTitle} — ${dlcRepack.title}`
            : dlcRepack.title,
          shop,
          downloader,
          downloadPath,
          uri: dlcUri,
          automaticallyExtract,
          automaticallyDeleteArchiveFiles:
            automaticallyDeleteArchiveFiles ?? false,
          fileSize: dlcRepack.fileSize,
          fileIndices: dlcSelection.fileIndices,
          selectedFilesSize: dlcSelection.selectedFilesSize,
          targetFileName: dlcRepack.fileName ?? null,
          emulatorSystem: dlcRepack.emulatorSystem ?? null,
        }).catch(() => {});
      }
    }
  };

  const handleFilter: React.ChangeEventHandler<HTMLInputElement> = (event) => {
    setFilterTerm(event.target.value);
  };

  const toggleFingerprint = (fingerprint: string) => {
    setSelectedFingerprints((prev) =>
      prev.includes(fingerprint)
        ? prev.filter((f) => f !== fingerprint)
        : [...prev, fingerprint]
    );
  };

  const checkIfLastDownloadedOption = (repack: GameRepack) => {
    if (!game?.download) return false;
    return repack.uris.some((uri) => uri.includes(game.download!.uri));
  };

  const isNewRepack = (repack: GameRepack): boolean => {
    if (isLoadingTimestamp) return false;

    if (viewedRepackIds.has(repack.id)) return false;

    if (!lastCheckTimestamp || !repack.createdAt) {
      return false;
    }

    try {
      const lastCheckDate = new Date(lastCheckTimestamp);

      if (isNaN(lastCheckDate.getTime())) {
        return false;
      }

      const lastCheckUtc = lastCheckDate.toISOString();

      return repack.createdAt > lastCheckUtc;
    } catch {
      return false;
    }
  };

  // Update / DLC prompt state
  const [pendingBaseRepack, setPendingBaseRepack] = useState<GameRepack | null>(
    null
  );
  const [pendingUpdates, setPendingUpdates] = useState<GameRepack[]>([]);
  const [pendingDLCs, setPendingDLCs] = useState<GameRepack[]>([]);
  const [applyUpdate, setApplyUpdate] = useState(false);
  const [applyDLC, setApplyDLC] = useState(false);
  const [showUpdatePrompt, setShowUpdatePrompt] = useState(false);
  const [showDLCPrompt, setShowDLCPrompt] = useState(false);

  const [isFilterDrawerOpen, setIsFilterDrawerOpen] = useState(false);
  const [showHyperVisorModal, setShowHyperVisorModal] = useState(false);
  const [epicGogModal, setEpicGogModal] = useState<{
    platform: EpicGogPlatform;
    objectId: string;
  } | null>(null);

  const ACHIEVEMENT_CRACKERS = useMemo(
    () => [
      "CODEX",
      "GOLDBERG",
      "EMPRESS",
      "SKIDROW",
      "FLT",
      "RAZOR1911",
      "RLD",
      "RUNE",
      "ONLINEFIX",
      "CREAMAPI",
      "3DM",
      "RLE",
      "SMARTSTEAMEMU",
      "DODI",
      "FITGIRL",
    ],
    []
  );

  const repackSupportsAchievements = useCallback(
    (title: string) => {
      const upper = title.toUpperCase();
      return ACHIEVEMENT_CRACKERS.some((c) => upper.includes(c));
    },
    [ACHIEVEMENT_CRACKERS]
  );

  const repackIsHyperVisor = (title: string) =>
    title.toLowerCase().includes("hypervisor");

  useEffect(() => {
    if (!visible) {
      setFilterTerm("");
      setSelectedFingerprints([]);
      setIsFilterDrawerOpen(false);
      setSelectedRegion(null);
    }
  }, [visible]);

  return (
    <>
      {showHyperVisorModal && (
        <Modal
          visible={showHyperVisorModal}
          title="HyperVisor Crack"
          description="What is a HyperVisor crack and how to set it up"
          onClose={() => setShowHyperVisorModal(false)}
        >
          <div className="repacks-modal__hypervisor-info">
            <p>
              Some games use <strong>VMProtect</strong> or similar DRM that
              detects when a hypervisor (virtual machine) is running on your
              CPU. A HyperVisor crack bypasses this detection — but it requires
              specific BIOS and Windows settings.
            </p>
            <h4>Setup steps</h4>
            <ol>
              <li>
                <strong>Disable Hyper-V in Windows</strong> — open &quot;Turn
                Windows features on or off&quot; and uncheck all Hyper-V
                entries. Restart.
              </li>
              <li>
                <strong>Disable Device Guard / Credential Guard</strong> — in
                Group Policy: Computer Configuration → Administrative Templates
                → System → Device Guard → turn off &quot;Turn on Virtualization
                Based Security&quot;.
              </li>
              <li>
                <strong>Enable Virtualization in BIOS</strong> — enter
                BIOS/UEFI, find the CPU settings and enable Intel VT-x or AMD-V
                (sometimes labelled &quot;SVM Mode&quot;).
              </li>
              <li>
                Reboot and launch the game. The crack intercepts the hypervisor
                detection call and reports no hypervisor is present.
              </li>
            </ol>
            <p className="repacks-modal__hypervisor-note">
              Note: disabling Hyper-V will prevent WSL2, Windows Sandbox, and
              Android subsystem from running while it is off.
            </p>
          </div>
        </Modal>
      )}

      <DownloadSettingsModal
        visible={showSelectFolderModal}
        onClose={() => setShowSelectFolderModal(false)}
        startDownload={async (
          rp,
          downloader,
          downloadPath,
          automaticallyExtract,
          addToQueueOnly,
          fileIndices,
          selectedFilesSize,
          automaticallyDeleteArchiveFiles,
          signal
        ) => {
          const response = await startDownload(
            rp,
            downloader,
            downloadPath,
            automaticallyExtract,
            addToQueueOnly,
            fileIndices,
            selectedFilesSize,
            automaticallyDeleteArchiveFiles,
            signal
          );
          if (response.ok && pendingBaseRepack?.id === rp.id) {
            await handleBaseDownloadStarted(
              downloader,
              downloadPath,
              automaticallyExtract,
              automaticallyDeleteArchiveFiles
            );
            setPendingBaseRepack(null);
            setPendingUpdates([]);
            setPendingDLCs([]);
            setApplyUpdate(false);
            setApplyDLC(false);
          }
          return response;
        }}
        repack={repack}
      />

      {/* ── Update prompt ─────────────────────────────────────────────── */}
      <Modal
        visible={showUpdatePrompt}
        title={t("apply_update_title", { defaultValue: "Apply Update?" })}
        onClose={handleUpdatePromptCancel}
        clickOutsideToClose={false}
      >
        <div className="repacks-modal__prompt-content">
          <p className="repacks-modal__prompt-intro">
            {t("apply_update_intro", {
              defaultValue:
                "An update is available for this game. It will be queued to download automatically after the base game finishes.",
            })}
          </p>

          <div className="repacks-modal__prompt-items">
            {pendingUpdates.map((u) => (
              <div key={u.id} className="repacks-modal__prompt-item">
                <span className="repacks-modal__prompt-item-name">
                  {u.title}
                </span>
                {u.fileSize && (
                  <span className="repacks-modal__prompt-item-size">
                    {u.fileSize}
                  </span>
                )}
              </div>
            ))}
          </div>

          {pendingBaseRepack && (
            <div className="repacks-modal__prompt-total">
              <span>
                {t("total_download_size", {
                  defaultValue: "Total download",
                })}
              </span>
              <span>
                {totalDownloadSize([pendingBaseRepack, ...pendingUpdates])}
              </span>
            </div>
          )}

          <div className="repacks-modal__prompt-actions">
            <Button theme="outline" onClick={handleUpdatePromptCancel}>
              {t("skip_update", { defaultValue: "Skip update" })}
            </Button>
            <Button theme="primary" onClick={handleUpdatePromptConfirm}>
              {t("yes_queue_update", { defaultValue: "Yes, queue update" })}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── DLC prompt ────────────────────────────────────────────────── */}
      <Modal
        visible={showDLCPrompt}
        title={t("apply_dlc_title", {
          defaultValue: `Apply All DLC? (${pendingDLCs.length} pack${pendingDLCs.length !== 1 ? "s" : ""})`,
          count: pendingDLCs.length,
        })}
        onClose={handleDLCPromptCancel}
        clickOutsideToClose={false}
      >
        <div className="repacks-modal__prompt-content">
          <p className="repacks-modal__prompt-intro">
            {t("apply_dlc_intro", {
              defaultValue:
                "The following DLC packs were found. They will be queued after the base game (and update, if selected).",
            })}
          </p>

          <div className="repacks-modal__prompt-items">
            {pendingDLCs.map((dlc) => (
              <div key={dlc.id} className="repacks-modal__prompt-item">
                <span className="repacks-modal__prompt-item-name">
                  {dlc.title}
                </span>
                {dlc.fileSize && (
                  <span className="repacks-modal__prompt-item-size">
                    {dlc.fileSize}
                  </span>
                )}
              </div>
            ))}
          </div>

          {pendingDLCs.length > 0 && (
            <div className="repacks-modal__prompt-total">
              <span>
                {t("total_dlc_size", { defaultValue: "Total DLC size" })}
              </span>
              <span>{totalDownloadSize(pendingDLCs)}</span>
            </div>
          )}

          <div className="repacks-modal__prompt-actions">
            <Button theme="outline" onClick={handleDLCPromptCancel}>
              {t("skip_dlc", { defaultValue: "Skip DLC" })}
            </Button>
            <Button theme="primary" onClick={handleDLCPromptConfirm}>
              {t("yes_queue_dlc", {
                defaultValue: "Yes, queue all DLC",
              })}
            </Button>
          </div>
        </div>
      </Modal>

      {epicGogModal && (
        <EpicGogDownloadModal
          visible={true}
          platform={epicGogModal.platform}
          onClose={() => setEpicGogModal(null)}
          onConfirm={(customPath) => {
            if (epicGogModal.platform === "epic") {
              window.electron
                .downloadViaLegendary(epicGogModal.objectId, customPath)
                .catch(() => {});
            } else {
              window.electron
                .downloadViaGogdl(epicGogModal.objectId, customPath)
                .catch(() => {});
            }
            onClose();
            navigate("/downloads");
          }}
        />
      )}

      <Modal
        visible={visible}
        title={t("download_options_title")}
        description={
          sharedLink
            ? t("shared_link_description", {
                defaultValue:
                  "📤 Shared by a friend — pick a download source below",
              })
            : t("repacks_modal_description")
        }
        onClose={onClose}
      >
        <div
          className={`repacks-modal__filter-container ${isFilterDrawerOpen ? "repacks-modal__filter-container--drawer-open" : ""}`}
        >
          <div className="repacks-modal__filter-top">
            <TextField
              placeholder={t("filter")}
              value={filterTerm}
              onChange={handleFilter}
            />
            {downloadSources.length > 0 && (
              <Button
                type="button"
                theme="outline"
                onClick={() => setIsFilterDrawerOpen(!isFilterDrawerOpen)}
                className="repacks-modal__filter-toggle"
              >
                {t("filter_by_source")}
                {isFilterDrawerOpen ? <ChevronUpIcon /> : <ChevronDownIcon />}
              </Button>
            )}
          </div>

          <div
            className={`repacks-modal__download-sources ${isFilterDrawerOpen ? "repacks-modal__download-sources--open" : ""}`}
          >
            <div className="repacks-modal__source-grid">
              {downloadSources
                .filter(
                  (
                    source
                  ): source is DownloadSource & { fingerprint: string } =>
                    source.fingerprint !== undefined
                )
                .map((source) => {
                  const label = source.name || source.url;
                  const truncatedLabel =
                    label.length > 16 ? label.substring(0, 16) + "..." : label;
                  return (
                    <div
                      key={source.fingerprint}
                      className="repacks-modal__source-item"
                    >
                      <CheckboxField
                        label={truncatedLabel}
                        checked={selectedFingerprints.includes(
                          source.fingerprint
                        )}
                        onChange={() => toggleFingerprint(source.fingerprint)}
                      />
                    </div>
                  );
                })}
            </div>
          </div>
        </div>

        {game &&
          (() => {
            const hasSteamConnected = Boolean(userPreferences?.steamId);
            const altShops = game.alternativeShops ?? [];
            const isGogGame =
              game.shop === "gog" || altShops.some((s) => s.shop === "gog");
            const isEpicGame =
              game.shop === "epic" || altShops.some((s) => s.shop === "epic");
            // Show Steam download button only when the game is actually owned
            // on Steam (synced from the Steam library) — not for catalog-added
            // entries that merely use the steam shop for assets.
            const isOwnedOnSteam =
              game.shop === "steam" &&
              hasSteamConnected &&
              !(game as any)._synthesized &&
              getGameOrigin(game) === "sync";
            // Client-launcher platforms: the library entry already stores the
            // correct client URI/exe, so "download officially" just opens it —
            // the platform's client handles install if the game is missing.
            const clientPlatforms = [
              {
                shop: "xbox" as const,
                label: "Download with Xbox app",
                Icon: XboxLogo,
                modifier: "xbox",
              },
              {
                shop: "battlenet" as const,
                label: "Download with Battle.net",
                Icon: BattleNetLogo,
                modifier: "battlenet",
              },
              {
                shop: "riot" as const,
                label: "Download with Riot Client",
                Icon: RiotLogo,
                modifier: "riot",
              },
              {
                shop: "ubisoft" as const,
                label: "Download with Ubisoft Connect",
                Icon: UbisoftLogo,
                modifier: "ubisoft",
              },
              {
                shop: "ea" as const,
                label: "Download with EA app",
                Icon: EaLogo,
                modifier: "ea",
              },
            ].filter(
              ({ shop }) =>
                (game.shop === shop &&
                  getGameOrigin(game) === "sync" &&
                  game.executablePath) ||
                altShops.some((s) => s.shop === shop && s.executablePath)
            );

            const hasPlatformOptions =
              isOwnedOnSteam ||
              isGogGame ||
              isEpicGame ||
              clientPlatforms.length > 0;

            if (!hasPlatformOptions) return null;

            const epicObjectId =
              game.shop === "epic"
                ? game.objectId
                : altShops.find((s) => s.shop === "epic")?.objectId;
            const gogObjectId =
              game.shop === "gog"
                ? game.objectId
                : altShops.find((s) => s.shop === "gog")?.objectId;

            return (
              <div className="repacks-modal__platform-options">
                <p className="repacks-modal__platform-options-label">
                  {t("own_this_game", {
                    defaultValue: "You own this game — download officially",
                  })}
                </p>
                <div className="repacks-modal__platform-buttons">
                  {isOwnedOnSteam && (
                    <button
                      type="button"
                      className="repacks-modal__platform-button repacks-modal__platform-button--steam"
                      onClick={() => {
                        window.electron.openGame(
                          game.shop,
                          game.objectId,
                          `steam://install/${game.objectId}`,
                          null
                        );
                        onClose();
                      }}
                    >
                      <SteamLogo className="repacks-modal__platform-icon" />
                      <span>{"Download with Steam"}</span>
                    </button>
                  )}
                  {isEpicGame && epicObjectId && (
                    <button
                      type="button"
                      className="repacks-modal__platform-button repacks-modal__platform-button--epic"
                      onClick={() =>
                        setEpicGogModal({
                          platform: "epic",
                          objectId: epicObjectId,
                        })
                      }
                    >
                      <EpicLogo className="repacks-modal__platform-icon" />
                      <span>{"Download with Epic Games"}</span>
                    </button>
                  )}
                  {isGogGame && gogObjectId && (
                    <button
                      type="button"
                      className="repacks-modal__platform-button repacks-modal__platform-button--gog"
                      onClick={() =>
                        setEpicGogModal({
                          platform: "gog",
                          objectId: gogObjectId,
                        })
                      }
                    >
                      <GogLogo className="repacks-modal__platform-icon" />
                      <span>{"Download with GOG"}</span>
                    </button>
                  )}
                  {clientPlatforms.map(({ shop, label, Icon, modifier }) => (
                    <button
                      key={shop}
                      type="button"
                      className={`repacks-modal__platform-button repacks-modal__platform-button--${modifier}`}
                      onClick={() => {
                        if (game.shop === shop && game.executablePath) {
                          window.electron.openGame(
                            game.shop,
                            game.objectId,
                            game.executablePath,
                            game.launchOptions
                          );
                        } else {
                          const alt = altShops.find((s) => s.shop === shop);
                          if (alt?.executablePath) {
                            window.electron.openGame(
                              alt.shop,
                              alt.objectId,
                              alt.executablePath,
                              null
                            );
                          }
                        }
                        onClose();
                      }}
                    >
                      <Icon className="repacks-modal__platform-icon" />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
                <div className="repacks-modal__or-divider">
                  <span>— OR —</span>
                </div>
              </div>
            );
          })()}

        {availableRegions.length > 1 && (
          <div className="repacks-modal__region-picker">
            <span className="repacks-modal__region-label">Region:</span>
            {availableRegions.map((region) => (
              <button
                key={region}
                type="button"
                className={`repacks-modal__region-chip${selectedRegion === region ? " repacks-modal__region-chip--active" : ""}`}
                onClick={() => setSelectedRegion(region)}
              >
                {region}
              </button>
            ))}
          </div>
        )}

        <div className="repacks-modal__repacks">
          {filteredRepacks.length === 0 ? (
            <div className="repacks-modal__no-results">
              <div className="repacks-modal__no-results-content">
                <div className="repacks-modal__no-results-text">
                  {t("no_repacks_found")}
                </div>
                <div className="repacks-modal__no-results-button">
                  <Button
                    type="button"
                    theme="primary"
                    onClick={() => {
                      onClose();
                      navigate("/settings?tab=2");
                    }}
                  >
                    <PlusCircleIcon />
                    {t("add_download_source", { ns: "settings" })}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            (() => {
              const seenTypes = new Set<string>();
              return filteredRepacks.map((repack) => {
                const isLastDownloadedOption =
                  checkIfLastDownloadedOption(repack);
                const availabilityStatus = getRepackAvailabilityStatus(repack);
                const tooltipId = `availability-orb-${repack.id}`;
                const ct = repack.contentType;
                let sectionHeader: React.ReactNode = null;
                if (ct && ct !== "game" && !seenTypes.has(ct)) {
                  seenTypes.add(ct);
                  const label =
                    ct === "update"
                      ? t("updates_section", { defaultValue: "Updates" })
                      : t("dlc_section", { defaultValue: "DLC" });
                  sectionHeader = (
                    <div
                      key={`section-${ct}`}
                      className="repacks-modal__section-header"
                    >
                      {label}
                    </div>
                  );
                }

                const button = (
                  <Button
                    key={repack.id}
                    theme="dark"
                    onClick={() => handleRepackClick(repack)}
                    className="repacks-modal__repack-button"
                  >
                    <span
                      className={`repacks-modal__availability-orb repacks-modal__availability-orb--${availabilityStatus}`}
                      data-tooltip-id={tooltipId}
                      data-tooltip-content={t(`source_${availabilityStatus}`)}
                    />
                    <Tooltip id={tooltipId} />

                    <p className="repacks-modal__repack-title">
                      {repack.title}
                      {userPreferences?.enableNewDownloadOptionsBadges !==
                        false &&
                        isNewRepack(repack) && (
                          <span className="repacks-modal__new-badge">
                            {t("new_download_option")}
                          </span>
                        )}
                    </p>

                    {isLastDownloadedOption && (
                      <Badge>{t("last_downloaded_option")}</Badge>
                    )}

                    <div className="repacks-modal__badges">
                      {repackSupportsAchievements(repack.title) && (
                        <span className="repacks-modal__badge repacks-modal__badge--achievements">
                          <TrophyIcon size={12} />
                          {t("achievements_supported", {
                            defaultValue: "Achievements",
                          })}
                        </span>
                      )}
                      {repackIsHyperVisor(repack.title) && (
                        <button
                          type="button"
                          className="repacks-modal__badge repacks-modal__badge--hypervisor"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowHyperVisorModal(true);
                          }}
                        >
                          <ZapIcon size={12} />
                          HyperVisor Crack
                        </button>
                      )}
                      {ct && ct !== "game" && (
                        <span
                          className={`repacks-modal__badge repacks-modal__badge--content-type repacks-modal__badge--content-type-${ct}`}
                        >
                          {ct === "update" ? "Update" : "DLC"}
                        </span>
                      )}
                    </div>

                    <p className="repacks-modal__repack-info">
                      {repack.fileSize} - {repack.downloadSourceName} -{" "}
                      {repack.uploadDate ? formatDate(repack.uploadDate) : ""}
                    </p>

                    {repack.installNotes && (
                      <p className="repacks-modal__install-notes">
                        {repack.installNotes}
                      </p>
                    )}

                    {hashesInDebrid[
                      getHashFromMagnet(repack.uris[0]) ?? ""
                    ] && <DebridBadge />}
                  </Button>
                );

                return sectionHeader ? (
                  <React.Fragment key={repack.id}>
                    {sectionHeader}
                    {button}
                  </React.Fragment>
                ) : (
                  button
                );
              });
            })()
          )}
        </div>
      </Modal>
    </>
  );
}
