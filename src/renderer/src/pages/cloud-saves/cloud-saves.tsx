import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { GameArtifactWithGame, GameShop } from "@types";
import { Button } from "@renderer/components";
import { useToast } from "@renderer/hooks";
import {
  CloudIcon,
  DownloadIcon,
  TrashIcon,
  AlertIcon,
  ChevronDownIcon,
  LinkExternalIcon,
} from "@primer/octicons-react";
import { buildGameDetailsPath } from "@renderer/helpers";
import "./cloud-saves.scss";

type GroupedSaves = Record<string, GameArtifactWithGame[]>;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function CloudSaves() {
  const { t: _t } = useTranslation("game_details");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const filterShop = searchParams.get("shop") ?? null;
  const filterObjectId = searchParams.get("objectId") ?? null;
  const { showSuccessToast, showErrorToast } = useToast();

  const [artifacts, setArtifacts] = useState<GameArtifactWithGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const loadArtifacts = useCallback(async () => {
    setLoading(true);
    try {
      const result = await window.electron.getAllArtifacts();
      setArtifacts(result);
    } catch {
      showErrorToast("Cloud Saves", "Failed to load cloud saves.");
    } finally {
      setLoading(false);
    }
  }, [showErrorToast]);

  useEffect(() => {
    loadArtifacts();
  }, [loadArtifacts]);

  const grouped = useMemo<GroupedSaves>(() => {
    const map: GroupedSaves = {};
    for (const a of artifacts) {
      if (filterShop && a.shop !== filterShop) continue;
      if (filterObjectId && a.objectId !== filterObjectId) continue;
      const key = `${a.shop}:${a.objectId}`;
      if (!map[key]) map[key] = [];
      map[key].push(a);
    }
    return map;
  }, [artifacts, filterShop, filterObjectId]);

  const toggleGroup = useCallback((key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const handleRestore = useCallback(
    async (artifact: GameArtifactWithGame) => {
      setRestoringId(artifact.id);
      try {
        await window.electron.downloadGameArtifact(
          artifact.objectId,
          artifact.shop as GameShop,
          artifact.id
        );
        showSuccessToast(
          "Cloud Saves",
          `Restored save for ${artifact.gameTitle}.`
        );
      } catch {
        showErrorToast("Cloud Saves", "Failed to restore save.");
      } finally {
        setRestoringId(null);
      }
    },
    [showSuccessToast, showErrorToast]
  );

  const handleDelete = useCallback(
    async (artifact: GameArtifactWithGame) => {
      if (confirmDeleteId !== artifact.id) {
        setConfirmDeleteId(artifact.id);
        return;
      }

      setDeletingId(artifact.id);
      setConfirmDeleteId(null);
      try {
        await window.electron.deleteGameArtifact(artifact.id);
        setArtifacts((prev) => prev.filter((a) => a.id !== artifact.id));
        showSuccessToast("Cloud Saves", "Backup deleted.");
      } catch {
        showErrorToast("Cloud Saves", "Failed to delete backup.");
      } finally {
        setDeletingId(null);
      }
    },
    [confirmDeleteId, showSuccessToast, showErrorToast]
  );

  if (loading) {
    return (
      <div className="cloud-saves">
        <div className="cloud-saves__header">
          <CloudIcon size={20} />
          <h2>Cloud Saves</h2>
        </div>
        <p className="cloud-saves__empty">Loading your cloud saves…</p>
      </div>
    );
  }

  const keys = Object.keys(grouped);

  return (
    <div className="cloud-saves">
      <div className="cloud-saves__header">
        <CloudIcon size={20} />
        <h2>Cloud Saves</h2>
        <span className="cloud-saves__count">
          {keys.length} game{keys.length !== 1 ? "s" : ""}
          {filterObjectId
            ? null
            : ` · ${artifacts.length} backup${artifacts.length !== 1 ? "s" : ""}`}
        </span>
        {filterObjectId && (
          <button
            type="button"
            className="cloud-saves__filter-clear"
            onClick={() => navigate("/cloud-saves")}
          >
            View all saves
          </button>
        )}
      </div>

      <div className="cloud-saves__explainer">
        <h3>How cloud saves work</h3>
        <ul>
          <li>
            <strong>Automatic saves</strong> — When you enable &quot;Automatic
            cloud sync&quot; for a game, GameHub backs up your save files each
            time you launch or close the game. No action needed.
          </li>
          <li>
            <strong>Manual saves</strong> — Open any game&apos;s detail page, go
            to the Cloud Sync panel, and click &quot;Create Backup&quot; any
            time you want a snapshot.
          </li>
          <li>
            <strong>Restoring</strong> — Click <em>Restore</em> on any backup
            below to overwrite your local save with that cloud snapshot. Make
            sure the game is closed before restoring.
          </li>
          <li>
            <strong>Your saves are private</strong> — Backups are stored under
            your personal account ID and are never visible to other users.
          </li>
        </ul>
      </div>

      {keys.length === 0 ? (
        <div className="cloud-saves__empty">
          <CloudIcon size={32} />
          <p>No cloud saves yet.</p>
          <p style={{ opacity: 0.6, fontSize: "0.85rem" }}>
            Enable automatic cloud sync on a game, or create a backup from the
            game details panel.
          </p>
        </div>
      ) : (
        <div className="cloud-saves__list">
          {keys.map((key) => {
            const entries = grouped[key];
            const first = entries[0];
            const isExpanded = expandedGroups.has(key);
            return (
              <div key={key} className="cloud-saves__game-group">
                <div className="cloud-saves__game-header">
                  <button
                    type="button"
                    className="cloud-saves__game-header-toggle"
                    onClick={() => toggleGroup(key)}
                    aria-expanded={isExpanded}
                  >
                    <ChevronDownIcon
                      size={16}
                      className={`cloud-saves__chevron${isExpanded ? " cloud-saves__chevron--expanded" : ""}`}
                    />
                    {first.gameIconUrl ? (
                      <img
                        src={first.gameIconUrl}
                        alt={first.gameTitle}
                        className="cloud-saves__game-icon"
                      />
                    ) : (
                      <div className="cloud-saves__game-icon cloud-saves__game-icon--placeholder">
                        <CloudIcon size={14} />
                      </div>
                    )}
                    <span className="cloud-saves__game-title">
                      {first.gameTitle}
                    </span>
                    <span className="cloud-saves__game-badge">
                      {entries.length} save{entries.length !== 1 ? "s" : ""}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="cloud-saves__icon-btn cloud-saves__game-link-btn"
                    title="Go to game page"
                    onClick={() =>
                      navigate(
                        buildGameDetailsPath({
                          shop: first.shop as GameShop,
                          objectId: first.objectId,
                          title: first.gameTitle ?? first.objectId,
                        })
                      )
                    }
                  >
                    <LinkExternalIcon size={14} />
                  </button>
                </div>

                <div
                  className={`cloud-saves__entries${isExpanded ? " cloud-saves__entries--open" : ""}`}
                >
                  {entries.map((artifact) => {
                    const isRestoring = restoringId === artifact.id;
                    const isDeleting = deletingId === artifact.id;
                    const pendingDelete = confirmDeleteId === artifact.id;

                    return (
                      <div key={artifact.id} className="cloud-saves__entry">
                        <div className="cloud-saves__entry-meta">
                          <span className="cloud-saves__entry-label">
                            {artifact.label ??
                              artifact.downloadOptionTitle ??
                              "Backup"}
                          </span>
                          <span className="cloud-saves__entry-detail">
                            {formatDate(artifact.createdAt)}
                          </span>
                          <span className="cloud-saves__entry-detail">
                            {formatBytes(artifact.artifactLengthInBytes)}
                          </span>
                          {artifact.hostname && (
                            <span className="cloud-saves__entry-detail cloud-saves__entry-host">
                              {artifact.hostname}
                            </span>
                          )}
                        </div>

                        <div className="cloud-saves__entry-actions">
                          <Button
                            type="button"
                            onClick={() => handleRestore(artifact)}
                            disabled={isRestoring || isDeleting}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "6px",
                            }}
                          >
                            <DownloadIcon size={13} />
                            {isRestoring ? "Restoring…" : "Restore"}
                          </Button>

                          {pendingDelete ? (
                            <div className="cloud-saves__confirm-delete">
                              <AlertIcon size={13} />
                              <span>Sure?</span>
                              <button
                                type="button"
                                className="cloud-saves__danger-btn"
                                onClick={() => handleDelete(artifact)}
                                disabled={isDeleting}
                              >
                                Delete
                              </button>
                              <button
                                type="button"
                                className="cloud-saves__cancel-btn"
                                onClick={() => setConfirmDeleteId(null)}
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="cloud-saves__icon-btn cloud-saves__icon-btn--danger"
                              onClick={() => handleDelete(artifact)}
                              disabled={isDeleting || isRestoring}
                              title="Delete backup"
                            >
                              <TrashIcon size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
