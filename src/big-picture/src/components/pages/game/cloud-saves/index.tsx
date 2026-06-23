import "./styles.scss";

import type { GameArtifact, GameShop } from "@types";
import { formatBytes } from "@shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, FocusItem, Typography } from "../../../common";
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
  const [hasPreview, setHasPreview] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [restoredId, setRestoredId] = useState<string | null>(null);
  const pendingRestoreRef = useRef<string | null>(null);

  const fetchArtifacts = useCallback(async () => {
    const results = await globalThis.window.electron
      .getGameArtifacts(objectId, shop)
      .catch(() => [] as GameArtifact[]);
    setArtifacts(results);
  }, [objectId, shop]);

  const fetchPreview = useCallback(async () => {
    const preview = await globalThis.window.electron
      .getGameBackupPreview(objectId, shop)
      .catch(() => null);
    setHasPreview(Boolean(preview?.overall?.totalGames));
  }, [objectId, shop]);

  useEffect(() => {
    void fetchArtifacts();
    void fetchPreview();
  }, [fetchArtifacts, fetchPreview]);

  useEffect(() => {
    const unsubUpload = globalThis.window.electron.onUploadComplete(
      objectId,
      shop,
      () => {
        setIsUploading(false);
        void fetchArtifacts();
        void fetchPreview();
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
  }, [objectId, shop, fetchArtifacts, fetchPreview]);

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

  return (
    <FocusItem
      id={focusId}
      navigationOverrides={focusNavigationOverrides}
      navigationOrder={focusNavigationOrder}
      asChild
    >
      <section
        className="game-page__sidebar-section cloud-saves-box"
        aria-label="Cloud Saves"
      >
        <div className="cloud-saves-box__header">
          <Typography className="cloud-saves-box__title">Cloud Saves</Typography>
          <Button
            variant="secondary"
            size="icon"
            disabled={busy || !hasPreview}
            loading={isUploading}
            onClick={handleUpload}
            aria-label="Create backup"
            style={{ padding: "4px 10px", fontSize: "0.75rem" }}
          >
            {isUploading ? "Uploading…" : "Backup"}
          </Button>
        </div>

        {isRestoring && (
          <p className="cloud-saves-box__status">Restoring backup…</p>
        )}

        {artifacts.length === 0 ? (
          <p className="cloud-saves-box__empty">No backups yet.</p>
        ) : (
          <ul className="cloud-saves-box__artifact-list">
            {artifacts.map((artifact) => {
              const label =
                artifact.label ?? `Backup — ${formatDate(artifact.createdAt)}`;

              return (
                <li key={artifact.id} className="cloud-saves-box__artifact">
                  <div className="cloud-saves-box__artifact-info">
                    <span className="cloud-saves-box__artifact-name">
                      {label}
                    </span>
                    <span className="cloud-saves-box__artifact-meta">
                      {formatBytes(artifact.artifactLengthInBytes)} ·{" "}
                      {artifact.hostname}
                    </span>
                    <span className="cloud-saves-box__artifact-meta">
                      {formatDate(artifact.createdAt)}
                    </span>
                  </div>

                  <div className="cloud-saves-box__artifact-actions">
                    <Button
                      variant="secondary"
                      disabled={busy}
                      loading={isRestoring && pendingRestoreRef.current === artifact.id}
                      onClick={() => handleRestore(artifact.id)}
                      style={{ padding: "4px 8px", fontSize: "0.72rem" }}
                    >
                      {restoredId === artifact.id ? "Restored ✓" : "Restore"}
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={busy}
                      loading={deletingId === artifact.id}
                      onClick={() => void handleDelete(artifact.id)}
                      style={{ padding: "4px 8px", fontSize: "0.72rem" }}
                    >
                      Delete
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </FocusItem>
  );
}
