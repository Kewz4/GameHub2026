import "./cloud-saves.scss";

import type { GameArtifactWithGame, GameShop } from "@types";
import { formatBytes } from "@shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CloudIcon } from "@phosphor-icons/react";
import {
  Button,
  HorizontalFocusGroup,
  Typography,
  VerticalFocusGroup,
} from "../../components";
import { IS_DESKTOP } from "../../constants";
import { useBigPictureToast } from "../../hooks";
import {
  CLOUD_SAVES_PAGE_REGION_ID,
  getCloudSavesDeleteFocusId,
  getCloudSavesRestoreFocusId,
} from "./navigation";

type GroupedSaves = Record<string, GameArtifactWithGame[]>;

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function CloudSavesPage() {
  const { showSuccessToast, showErrorToast } = useBigPictureToast();
  const [artifacts, setArtifacts] = useState<GameArtifactWithGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadArtifacts = useCallback(async () => {
    if (!IS_DESKTOP) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await globalThis.window.electron.getAllArtifacts();
      setArtifacts(result);
    } catch {
      showErrorToast("Failed to load cloud saves");
    } finally {
      setLoading(false);
    }
  }, [showErrorToast]);

  useEffect(() => {
    void loadArtifacts();
  }, [loadArtifacts]);

  const grouped = useMemo<GroupedSaves>(() => {
    const map: GroupedSaves = {};
    for (const a of artifacts) {
      const key = `${a.shop}:${a.objectId}`;
      if (!map[key]) map[key] = [];
      map[key].push(a);
    }
    return map;
  }, [artifacts]);

  const groupKeys = Object.keys(grouped);

  const busy = restoringId !== null || deletingId !== null;

  const handleRestore = useCallback(
    async (artifact: GameArtifactWithGame) => {
      setRestoringId(artifact.id);
      try {
        await globalThis.window.electron.downloadGameArtifact(
          artifact.objectId,
          artifact.shop as GameShop,
          artifact.id
        );
        showSuccessToast(`Restored save for ${artifact.gameTitle}`);
      } catch {
        showErrorToast("Failed to restore save");
      } finally {
        setRestoringId(null);
      }
    },
    [showSuccessToast, showErrorToast]
  );

  const handleDelete = useCallback(
    async (artifact: GameArtifactWithGame) => {
      setDeletingId(artifact.id);
      try {
        await globalThis.window.electron.deleteGameArtifact(artifact.id);
        setArtifacts((prev) => prev.filter((a) => a.id !== artifact.id));
        showSuccessToast("Backup deleted");
      } catch {
        showErrorToast("Failed to delete backup");
      } finally {
        setDeletingId(null);
      }
    },
    [showSuccessToast, showErrorToast]
  );

  return (
    <VerticalFocusGroup regionId={CLOUD_SAVES_PAGE_REGION_ID} asChild>
      <section className="cloud-saves-page">
        <div className="cloud-saves-page__header">
          <CloudIcon size={32} />
          <Typography className="cloud-saves-page__title">
            Cloud Saves
          </Typography>
          {!loading && groupKeys.length > 0 && (
            <Typography className="cloud-saves-page__count">
              {groupKeys.length} game{groupKeys.length !== 1 ? "s" : ""} ·{" "}
              {artifacts.length} backup{artifacts.length !== 1 ? "s" : ""}
            </Typography>
          )}
        </div>

        {loading ? (
          <Typography className="cloud-saves-page__status">
            Loading your cloud saves…
          </Typography>
        ) : groupKeys.length === 0 ? (
          <div className="cloud-saves-page__empty">
            <CloudIcon size={48} />
            <Typography>No cloud saves yet.</Typography>
            <Typography>
              Open a game and create a backup to save your progress to the
              cloud.
            </Typography>
          </div>
        ) : (
          <div className="cloud-saves-page__list">
            {groupKeys.map((key) => {
              const entries = grouped[key];
              const first = entries[0];
              return (
                <div key={key} className="cloud-saves-page__group">
                  <div className="cloud-saves-page__group-header">
                    {first.gameIconUrl ? (
                      <img
                        src={first.gameIconUrl}
                        alt={first.gameTitle}
                        className="cloud-saves-page__group-icon"
                      />
                    ) : (
                      <div className="cloud-saves-page__group-icon" />
                    )}
                    <Typography className="cloud-saves-page__group-title">
                      {first.gameTitle}
                    </Typography>
                    <Typography className="cloud-saves-page__group-badge">
                      {entries.length} backup{entries.length !== 1 ? "s" : ""}
                    </Typography>
                  </div>

                  <div className="cloud-saves-page__artifacts">
                    {entries.map((artifact) => {
                      const label =
                        artifact.label ??
                        artifact.downloadOptionTitle ??
                        `Backup — ${formatDate(artifact.createdAt)}`;
                      return (
                        <div
                          key={artifact.id}
                          className="cloud-saves-page__artifact"
                        >
                          <div className="cloud-saves-page__artifact-info">
                            <Typography className="cloud-saves-page__artifact-label">
                              {label}
                            </Typography>
                            <Typography className="cloud-saves-page__artifact-meta">
                              {formatBytes(artifact.artifactLengthInBytes)} ·{" "}
                              {artifact.hostname} · {formatDate(artifact.createdAt)}
                            </Typography>
                          </div>

                          <HorizontalFocusGroup asChild>
                            <div className="cloud-saves-page__artifact-actions">
                              <Button
                                focusId={getCloudSavesRestoreFocusId(
                                  artifact.id
                                )}
                                variant="primary"
                                disabled={busy}
                                loading={restoringId === artifact.id}
                                onClick={() => void handleRestore(artifact)}
                              >
                                {restoringId === artifact.id
                                  ? "Restoring…"
                                  : "Restore"}
                              </Button>
                              <Button
                                focusId={getCloudSavesDeleteFocusId(
                                  artifact.id
                                )}
                                variant="secondary"
                                disabled={busy}
                                loading={deletingId === artifact.id}
                                onClick={() => void handleDelete(artifact)}
                              >
                                Delete
                              </Button>
                            </div>
                          </HorizontalFocusGroup>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </VerticalFocusGroup>
  );
}
