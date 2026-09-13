import "./cloud-saves.scss";

import type { CloudSaveV2LibraryEntry } from "@types";
import { formatBytes } from "@shared";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CloudIcon, SpinnerIcon } from "@phosphor-icons/react";
import { Button, Typography, VerticalFocusGroup } from "../../components";
import { IS_DESKTOP } from "../../constants";
import { getBigPictureGameDetailsPath } from "../../helpers";
import {
  CLOUD_SAVES_EMPTY_REFRESH_ID,
  CLOUD_SAVES_PAGE_REGION_ID,
  getCloudSavesManageFocusId,
} from "./navigation";

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

export default function CloudSavesPage() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<CloudSaveV2LibraryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    if (!IS_DESKTOP) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(false);
    try {
      setEntries(await globalThis.window.electron.getCloudSaveV2Library());
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openManager = (entry: CloudSaveV2LibraryEntry) => {
    const path = getBigPictureGameDetailsPath(entry);
    navigate(`${path}${path.includes("?") ? "&" : "?"}openCloudSaveManager=1`);
  };

  return (
    <VerticalFocusGroup regionId={CLOUD_SAVES_PAGE_REGION_ID} asChild>
      <section className="cloud-saves-page">
        <div className="cloud-saves-page__header">
          <CloudIcon size={32} />
          <Typography className="cloud-saves-page__title">
            Cloud Saves
          </Typography>
          {!loading && (
            <Typography className="cloud-saves-page__count">
              {entries.length} game{entries.length === 1 ? "" : "s"}
            </Typography>
          )}
        </div>

        {loadError && (
          <div className="cloud-saves-page__error" role="alert">
            <div>
              <Typography>Cloud Saves could not be refreshed.</Typography>
              <Typography>
                {entries.length > 0
                  ? "Showing the last saves loaded on this device."
                  : "Check your connection and try again."}
              </Typography>
            </div>
            <Button
              focusId="cloud-saves-retry"
              variant="secondary"
              onClick={() => void load()}
            >
              Retry
            </Button>
          </div>
        )}

        {loading ? (
          <div
            className="cloud-saves-page__status"
            role="status"
            aria-live="polite"
          >
            <SpinnerIcon
              className="cloud-saves-page__status-spinner"
              size={28}
              aria-hidden="true"
            />
            <Typography className="cloud-saves-page__status-copy">
              Detecting cloud saves…
            </Typography>
          </div>
        ) : !loadError && entries.length === 0 ? (
          <div className="cloud-saves-page__empty">
            <CloudIcon size={48} />
            <Typography>No cloud saves yet.</Typography>
            <Typography>
              Enable Cloud Saves from a game&apos;s options or sync it once.
            </Typography>
            <Button
              focusId={CLOUD_SAVES_EMPTY_REFRESH_ID}
              variant="secondary"
              onClick={() => void load()}
            >
              Refresh
            </Button>
          </div>
        ) : entries.length > 0 ? (
          <div className="cloud-saves-page__list">
            {entries.map((entry) => (
              <div
                key={`${entry.shop}:${entry.objectId}`}
                className="cloud-saves-page__group"
              >
                <div className="cloud-saves-page__group-header">
                  {entry.gameIconUrl ? (
                    <img
                      src={entry.gameIconUrl}
                      alt=""
                      className="cloud-saves-page__group-icon"
                    />
                  ) : (
                    <div className="cloud-saves-page__group-icon" />
                  )}
                  <Typography className="cloud-saves-page__group-title">
                    {entry.gameTitle}
                  </Typography>
                  <Typography className="cloud-saves-page__group-badge">
                    v{entry.version} · {entry.fileCount} file
                    {entry.fileCount === 1 ? "" : "s"}
                  </Typography>
                </div>
                <div className="cloud-saves-page__artifact">
                  <div className="cloud-saves-page__artifact-info">
                    <Typography className="cloud-saves-page__artifact-label">
                      Active snapshot
                    </Typography>
                    <Typography className="cloud-saves-page__artifact-meta">
                      {formatBytes(entry.totalSizeBytes)} ·{" "}
                      {formatDate(entry.updatedAt)}
                    </Typography>
                  </div>
                  <Button
                    focusId={getCloudSavesManageFocusId(
                      entry.shop,
                      entry.objectId
                    )}
                    variant="primary"
                    onClick={() => openManager(entry)}
                  >
                    Manage
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </section>
    </VerticalFocusGroup>
  );
}
