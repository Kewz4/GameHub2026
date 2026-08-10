import {
  CloudIcon,
  SpinnerIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import type {
  CloudSaveOverview,
  EmulationCloudSave,
  EmulationSavePlatform,
  GameArtifact,
  LibraryGame,
  MemoryCardSaveRecord,
} from "@types";
import { formatBytes } from "@shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { platformToSystem } from "@renderer/helpers";
import {
  Button,
  Checkbox,
  HorizontalFocusGroup,
  VerticalFocusGroup,
} from "../../../common";
import { getBigPictureGameDetailsPath } from "../../../../helpers";
import { useBigPictureToast } from "../../../../hooks";
import { SettingsSection } from "../../../../pages/settings/settings-section";
import { EmulationCloudRestoreModal } from "../../../../pages/settings/emulation/emulation-cloud-restore-modal";
import { CloudSavesList } from "./cloud-saves-list";

import "./cloud-tab.scss";

export const GAME_CLOUD_SETTINGS_PRIMARY_CONTROL_ID =
  "game-cloud-settings-primary-control";
const GAME_CLOUD_SETTINGS_AUTO_SYNC_ID = "game-cloud-settings-auto-sync";

export interface GameCloudSettingsProps {
  game: LibraryGame;
  automaticCloudSync: boolean;
  onToggleAutomaticCloudSync: (checked: boolean) => void;
}

const recordKey = (record: MemoryCardSaveRecord) =>
  `${record.cardFilePath}::${record.folderName}`;

const emulationSaveToArtifact = (save: EmulationCloudSave): GameArtifact => ({
  id: save.id,
  artifactLengthInBytes: save.artifactLengthInBytes,
  downloadOptionTitle: save.fileName,
  createdAt: save.createdAt,
  updatedAt: save.updatedAt,
  hostname: save.hostname ?? "—",
  downloadCount: 0,
  label: save.label ?? undefined,
  isFrozen: false,
});

function PcCloudSaveSettings({ game }: Readonly<{ game: LibraryGame }>) {
  const { t } = useTranslation("game_details");
  const navigate = useNavigate();
  const { showErrorToast } = useBigPictureToast();
  const [overview, setOverview] = useState<CloudSaveOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setOverview(
        await globalThis.window.electron.getCloudSaveOverview(
          game.objectId,
          game.shop
        )
      );
    } catch {
      showErrorToast("Failed to load cloud saves");
    } finally {
      setLoading(false);
    }
  }, [game.objectId, game.shop, showErrorToast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openManager = () => {
    const path = getBigPictureGameDetailsPath(game);
    navigate(`${path}${path.includes("?") ? "&" : "?"}openCloudSaveManager=1`);
  };

  const toggleAutomatic = async (enabled: boolean) => {
    setUpdating(true);
    try {
      await globalThis.window.electron.setCloudSaveAutomaticSyncEnabled(
        game.objectId,
        game.shop,
        enabled
      );
      await refresh();
    } catch {
      showErrorToast("Unable to update Cloud Saves");
    } finally {
      setUpdating(false);
    }
  };

  return (
    <VerticalFocusGroup className="game-cloud-settings-tab">
      <SettingsSection
        className="game-cloud-settings-tab__section"
        title={t("cloud_saves_section_title")}
        description="Review files, map custom save locations, resolve conflicts, and sync the active save state."
      >
        <div className="game-cloud-settings-tab__section-content">
          <Button
            focusId={GAME_CLOUD_SETTINGS_PRIMARY_CONTROL_ID}
            variant="primary"
            loading={loading}
            disabled={loading}
            icon={<CloudIcon size={20} />}
            onClick={openManager}
          >
            Open Cloud Saves
          </Button>
          {overview?.activeRemoteSnapshot && (
            <p className="game-cloud-settings-tab__status-label">
              {overview.activeRemoteSnapshot.fileCount} file
              {overview.activeRemoteSnapshot.fileCount === 1 ? "" : "s"} ·{" "}
              {formatBytes(overview.activeRemoteSnapshot.totalSizeBytes)}
            </p>
          )}
          <Checkbox
            block
            focusId={GAME_CLOUD_SETTINGS_AUTO_SYNC_ID}
            label={t("enable_automatic_cloud_sync")}
            checked={overview?.isAutomaticSyncEnabled ?? false}
            disabled={loading || updating}
            onChange={(checked) => void toggleAutomatic(checked)}
          />
        </div>
      </SettingsSection>
    </VerticalFocusGroup>
  );
}

function EmulationCloudSaveSettings({
  game,
  platform,
}: Readonly<{
  game: LibraryGame;
  platform: EmulationSavePlatform;
}>) {
  const { t } = useTranslation("big_picture");
  const { showErrorToast, showSuccessToast } = useBigPictureToast();
  const [saves, setSaves] = useState<EmulationCloudSave[]>([]);
  const [records, setRecords] = useState<MemoryCardSaveRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [uploadingCardKey, setUploadingCardKey] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<EmulationCloudSave | null>(
    null
  );

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const localPromise =
        platform === "ps2"
          ? globalThis.window.electron.listPs2MemcardSaves()
          : globalThis.window.electron.listPs1MemcardSaves();
      const [remote, local] = await Promise.all([
        globalThis.window.electron.listEmulationSaves(platform, game.objectId),
        localPromise,
      ]);
      setSaves(remote.filter((save) => save.objectId === game.objectId));
      setRecords(local.filter((record) => record.objectId === game.objectId));
    } catch {
      setLoadError(true);
      showErrorToast("Memory-card backups could not be loaded");
    } finally {
      setLoading(false);
    }
  }, [game.objectId, platform, showErrorToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const artifacts = useMemo(() => saves.map(emulationSaveToArtifact), [saves]);

  const uploadCard = async (record: MemoryCardSaveRecord) => {
    const key = recordKey(record);
    setUploadingCardKey(key);
    try {
      await globalThis.window.electron.uploadEmulationSave(
        platform,
        record.cardFilePath,
        record.folderName
      );
      showSuccessToast("Cloud save uploaded");
      await load();
    } catch {
      showErrorToast("Cloud save upload failed");
    } finally {
      setUploadingCardKey(null);
    }
  };

  const deleteSave = async (id: string) => {
    setDeletingId(id);
    try {
      await globalThis.window.electron.deleteEmulationSave(id);
      await load();
    } catch {
      showErrorToast("Unable to remove cloud save");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <VerticalFocusGroup className="game-cloud-settings-tab">
      {records.length > 0 && (
        <SettingsSection
          className="game-cloud-settings-tab__section"
          title="Memory Card Backups"
          description={t("cloud_saves_section_description_memory")}
        >
          <div className="game-cloud-settings-tab__saves-list">
            {records.map((record) => {
              const key = recordKey(record);
              const uploading = uploadingCardKey === key;
              return (
                <div key={key} className="game-cloud-settings-tab__save-card">
                  <div className="game-cloud-settings-tab__save-copy">
                    <p className="game-cloud-settings-tab__save-title">
                      {record.title ?? record.folderName}
                    </p>
                    <p className="game-cloud-settings-tab__save-info">
                      {record.cardLabel} · {formatBytes(record.sizeBytes)}
                    </p>
                  </div>
                  <HorizontalFocusGroup asChild>
                    <div className="game-cloud-settings-tab__save-actions">
                      <Button
                        focusId={`${GAME_CLOUD_SETTINGS_PRIMARY_CONTROL_ID}-${key}`}
                        variant="secondary"
                        loading={uploading}
                        disabled={uploading}
                        icon={
                          uploading ? (
                            <SpinnerIcon size={20} />
                          ) : (
                            <UploadSimpleIcon size={20} weight="bold" />
                          )
                        }
                        onClick={() => void uploadCard(record)}
                      >
                        {uploading ? "Uploading…" : t("create_backup")}
                      </Button>
                    </div>
                  </HorizontalFocusGroup>
                </div>
              );
            })}
          </div>
        </SettingsSection>
      )}

      <SettingsSection
        className="game-cloud-settings-tab__section game-cloud-settings-tab__section--backups"
        title="Memory Card Cloud Backups"
        description={t("cloud_saves_list_description")}
      >
        {loadError ? (
          <div className="game-cloud-settings-tab__error" role="alert">
            <span>Memory-card backups could not be loaded.</span>
            <Button variant="secondary" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        ) : null}
        <CloudSavesList
          artifacts={artifacts}
          loading={loading}
          restoringArtifactId={restoreTarget?.id ?? null}
          updatingArtifactId={null}
          deletingArtifactId={deletingId}
          onRestoreArtifact={async (id) => {
            const save = saves.find((candidate) => candidate.id === id);
            if (save) setRestoreTarget(save);
          }}
          onToggleArtifactFreeze={async () => undefined}
          onDeleteArtifact={deleteSave}
          hideFreeze
        />
      </SettingsSection>

      <EmulationCloudRestoreModal
        save={restoreTarget}
        platform={platform}
        onClose={() => setRestoreTarget(null)}
        onRestored={() => {
          setRestoreTarget(null);
          void load();
        }}
        onRestoreSuccess={() => showSuccessToast("Cloud save restored")}
        onRestoreError={() => showErrorToast("Failed to restore cloud save")}
        regionId="emu-saves-restore-modal-region"
        actionsRegionId="emu-saves-restore-modal-actions"
        pickButtonId="emu-saves-restore-pick-button"
        confirmButtonId="emu-saves-restore-confirm"
      />
    </VerticalFocusGroup>
  );
}

export function GameCloudSettingsTab({
  game,
}: Readonly<GameCloudSettingsProps>) {
  const system =
    game.shop === "launchbox" ? platformToSystem(game.platform) : null;
  if (system === "ps1" || system === "ps2") {
    return (
      <>
        <PcCloudSaveSettings game={game} />
        <EmulationCloudSaveSettings
          game={game}
          platform={system as EmulationSavePlatform}
        />
      </>
    );
  }
  return <PcCloudSaveSettings game={game} />;
}
