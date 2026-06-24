import "./styles.scss";

import type { GameArtifact, GameShop } from "@types";
import { formatBytes } from "@shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { CloudIcon } from "@phosphor-icons/react";
import { Button, FocusItem, Modal, Typography } from "../../../common";
import type { FocusOverrides } from "../../../../services";

interface CloudSavesBoxProps {
  objectId: string;
  shop: GameShop;
  focusId?: string;
  focusNavigationOverrides?: FocusOverrides;
  focusNavigationOrder?: number;
}

function formatDate(isoString: string) {
  return new Date(isoString).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function CloudSavesBox({
  objectId,
  shop,
  focusId,
  focusNavigationOverrides,
  focusNavigationOrder,
}: Readonly<CloudSavesBoxProps>) {
  const [artifacts, setArtifacts] = useState<GameArtifact[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [restoredId, setRestoredId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const pendingRestoreRef = useRef<string | null>(null);

  const fetchArtifacts = useCallback(async () => {
    const results = await globalThis.window.electron
      .getGameArtifacts(objectId, shop)
      .catch(() => [] as GameArtifact[]);
    setArtifacts(results);
  }, [objectId, shop]);

  useEffect(() => {
    void fetchArtifacts();
  }, [fetchArtifacts]);

  useEffect(() => {
    const unsubUpload = globalThis.window.electron.onUploadComplete(
      objectId,
      shop,
      () => {
        setIsUploading(false);
        void fetchArtifacts();
      }
    );

    const unsubDownload = globalThis.window.electron.onBackupDownloadComplete(
      objectId,
      shop,
      (success) => {
        if (success && pendingRestoreRef.current) {
          setRestoredId(pendingRestoreRef.current);
        }
        pendingRestoreRef.current = null;
        setIsRestoring(false);
        void fetchArtifacts();
      }
    );

    return () => {
      unsubUpload();
      unsubDownload();
    };
  }, [objectId, shop, fetchArtifacts]);

  const handleUpload = () => {
    setIsUploading(true);
    globalThis.window.electron
      .uploadSaveGame(objectId, shop, null)
      .catch(() => setIsUploading(false));
  };

  const handleRestore = (artifactId: string) => {
    setRestoredId(null);
    pendingRestoreRef.current = artifactId;
    setIsRestoring(true);
    globalThis.window.electron
      .downloadGameArtifact(objectId, shop, artifactId)
      .catch(() => {
        setIsRestoring(false);
        pendingRestoreRef.current = null;
      });
  };

  const handleDelete = async (artifactId: string) => {
    setDeletingId(artifactId);
    try {
      await globalThis.window.electron.deleteGameArtifact(artifactId);
      setArtifacts((prev) => prev.filter((a) => a.id !== artifactId));
    } finally {
      setDeletingId(null);
    }
  };

  const busy = isUploading || isRestoring || deletingId !== null;

  const latestArtifact = artifacts[0];
  const subtitle = latestArtifact
    ? `Last backup: ${formatDate(latestArtifact.createdAt)}`
    : "No backups yet";

  return (
    <>
      <FocusItem
        id={focusId}
        navigationOverrides={focusNavigationOverrides}
        navigationOrder={focusNavigationOrder}
        asChild
      >
        <button
          type="button"
          className="game-page__sidebar-section cloud-saves-entry"
          aria-label="Cloud Saves"
          onClick={() => setShowModal(true)}
        >
          <CloudIcon size={28} className="cloud-saves-entry__icon" />
          <div className="cloud-saves-entry__body">
            <Typography className="cloud-saves-entry__title">
              Cloud Saves
            </Typography>
            <Typography className="cloud-saves-entry__subtitle">
              {subtitle}
            </Typography>
          </div>
          <Typography className="cloud-saves-entry__count">
            {artifacts.length > 0 ? artifacts.length : ""}
          </Typography>
        </button>
      </FocusItem>

      <Modal
        visible={showModal}
        title="Cloud Saves"
        onClose={() => setShowModal(false)}
      >
        <div className="cloud-saves-modal">
          <div className="cloud-saves-modal__actions">
            <Button
              variant="primary"
              disabled={busy}
              loading={isUploading}
              onClick={handleUpload}
            >
              {isUploading ? "Uploading…" : "Create Backup"}
            </Button>
          </div>

          {isRestoring && (
            <p className="cloud-saves-modal__status">Restoring backup…</p>
          )}

          {artifacts.length === 0 ? (
            <p className="cloud-saves-modal__empty">
              No backups yet. Create a backup to save your progress to the
              cloud.
            </p>
          ) : (
            <ul className="cloud-saves-modal__list">
              {artifacts.map((artifact) => {
                const label =
                  artifact.label ??
                  `Backup — ${formatDate(artifact.createdAt)}`;
                return (
                  <li key={artifact.id} className="cloud-saves-modal__artifact">
                    <div className="cloud-saves-modal__artifact-info">
                      <span className="cloud-saves-modal__artifact-name">
                        {label}
                      </span>
                      <span className="cloud-saves-modal__artifact-meta">
                        {formatBytes(artifact.artifactLengthInBytes)} ·{" "}
                        {artifact.hostname}
                      </span>
                      <span className="cloud-saves-modal__artifact-meta">
                        {formatDate(artifact.createdAt)}
                      </span>
                    </div>
                    <div className="cloud-saves-modal__artifact-actions">
                      <Button
                        variant="secondary"
                        disabled={busy}
                        loading={
                          isRestoring &&
                          pendingRestoreRef.current === artifact.id
                        }
                        onClick={() => handleRestore(artifact.id)}
                      >
                        {restoredId === artifact.id ? "Restored ✓" : "Restore"}
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={busy}
                        loading={deletingId === artifact.id}
                        onClick={() => void handleDelete(artifact.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Modal>
    </>
  );
}
