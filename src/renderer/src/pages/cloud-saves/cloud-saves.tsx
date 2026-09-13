import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { CloudSaveV2LibraryEntry } from "@types";
import { formatBytes } from "@shared";
import { Button } from "@renderer/components";
import { buildGameDetailsPath } from "@renderer/helpers";
import { CloudIcon, LinkExternalIcon, SyncIcon } from "@primer/octicons-react";

import "./cloud-saves.scss";

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

export default function CloudSaves() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [entries, setEntries] = useState<CloudSaveV2LibraryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      setEntries(await window.electron.getCloudSaveV2Library());
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleEntries = useMemo(() => {
    const shop = searchParams.get("shop");
    const objectId = searchParams.get("objectId");
    return entries.filter(
      (entry) =>
        (!shop || entry.shop === shop) &&
        (!objectId || entry.objectId === objectId)
    );
  }, [entries, searchParams]);

  const openManager = (entry: CloudSaveV2LibraryEntry) => {
    const gamePath = buildGameDetailsPath({
      shop: entry.shop,
      objectId: entry.objectId,
      title: entry.gameTitle,
    });
    navigate(
      `${gamePath}${gamePath.includes("?") ? "&" : "?"}openCloudSaveManager=1`
    );
  };

  return (
    <div className="cloud-saves">
      <div className="cloud-saves__header">
        <CloudIcon size={20} />
        <h2>Cloud Saves</h2>
        {!loading && (
          <span className="cloud-saves__count">
            {visibleEntries.length} game
            {visibleEntries.length === 1 ? "" : "s"}
          </span>
        )}
        <button
          type="button"
          className="cloud-saves__filter-clear"
          onClick={() => void load()}
          disabled={loading}
        >
          <SyncIcon size={14} /> Refresh
        </button>
      </div>

      <div className="cloud-saves__explainer">
        <h3>Your active save state</h3>
        <p>
          GameHub keeps one authoritative, versioned save state per game in your
          private cloud storage. Open a game&apos;s manager to review files, map
          custom locations, restore remote changes, or sync now.
        </p>
      </div>

      {loadError && (
        <div className="cloud-saves__load-error" role="alert">
          <div>
            <strong>Cloud Saves could not be refreshed.</strong>
            <span>
              {entries.length > 0
                ? "Showing the last saves loaded on this device."
                : "Check your connection and try again."}
            </span>
          </div>
          <Button type="button" theme="outline" onClick={() => void load()}>
            <SyncIcon size={14} /> Retry
          </Button>
        </div>
      )}

      {loading ? (
        <p className="cloud-saves__empty" role="status" aria-live="polite">
          <SyncIcon className="cloud-saves__loading-icon" size={20} />
          Detecting cloud saves…
        </p>
      ) : !loadError && visibleEntries.length === 0 ? (
        <div className="cloud-saves__empty">
          <CloudIcon size={32} />
          <p>No cloud saves yet.</p>
          <p style={{ opacity: 0.6, fontSize: "0.85rem" }}>
            Enable Cloud Saves from a game&apos;s options or sync it once.
          </p>
        </div>
      ) : visibleEntries.length > 0 ? (
        <div className="cloud-saves__list">
          {visibleEntries.map((entry) => (
            <div
              key={`${entry.shop}:${entry.objectId}`}
              className="cloud-saves__game-group"
            >
              <div className="cloud-saves__game-header">
                <div className="cloud-saves__game-header-toggle">
                  {entry.gameIconUrl ? (
                    <img
                      src={entry.gameIconUrl}
                      alt=""
                      className="cloud-saves__game-icon"
                    />
                  ) : (
                    <div className="cloud-saves__game-icon cloud-saves__game-icon--placeholder">
                      <CloudIcon size={14} />
                    </div>
                  )}
                  <span className="cloud-saves__game-title">
                    {entry.gameTitle}
                  </span>
                  <span className="cloud-saves__game-badge">
                    v{entry.version} · {entry.fileCount} file
                    {entry.fileCount === 1 ? "" : "s"}
                  </span>
                </div>
              </div>
              <div className="cloud-saves__entry">
                <div className="cloud-saves__entry-meta">
                  <span className="cloud-saves__entry-label">
                    Active snapshot
                  </span>
                  <span className="cloud-saves__entry-detail">
                    {formatDate(entry.updatedAt)}
                  </span>
                  <span className="cloud-saves__entry-detail">
                    {formatBytes(entry.totalSizeBytes)}
                  </span>
                </div>
                <div className="cloud-saves__entry-actions">
                  <Button type="button" onClick={() => openManager(entry)}>
                    <LinkExternalIcon size={14} /> Manage
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
