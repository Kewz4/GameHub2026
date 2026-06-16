import { useCallback, useEffect, useRef, useState } from "react";
import {
  TrophyIcon,
  DownloadIcon,
  SyncIcon,
} from "@primer/octicons-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@renderer/components";
import { useAppDispatch, useToast } from "@renderer/hooks";
import { setHeaderTitle } from "@renderer/features";
import type { ExophaseSyncReport } from "@types";
import "./achievements-sync.scss";

export default function AchievementsSync() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { showSuccessToast, showErrorToast } = useToast();

  const [report, setReport] = useState<ExophaseSyncReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [importingPsn, setImportingPsn] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; title: string; phase?: string } | null>(null);

  const unsubRef = useRef<(() => void) | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    window.electron
      .getExophaseSyncReport()
      .then(setReport)
      .catch(() => setReport(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    dispatch(setHeaderTitle("Achievements Sync"));
    load();
  }, [dispatch, load]);

  const handleRunSync = async () => {
    setSyncing(true);
    setProgress(null);
    unsubRef.current = window.electron.onExophaseSyncProgress((p) => setProgress(p));
    try {
      await window.electron.runExophaseBackgroundSync();
      showSuccessToast("Achievements sync finished");
      load();
    } catch {
      showErrorToast("Sync failed.");
    } finally {
      unsubRef.current?.();
      unsubRef.current = null;
      setSyncing(false);
      setProgress(null);
    }
  };

  const handlePsnImport = async () => {
    setImportingPsn(true);
    setProgress(null);
    unsubRef.current = window.electron.onExophaseSyncProgress((p) => setProgress(p));
    try {
      const result = await window.electron.importPlaystationAchievements();
      if (result.error) {
        showErrorToast("PlayStation import failed", result.error);
      } else {
        showSuccessToast(
          "PlayStation achievements imported",
          `Credited ${result.totalUnlocked} trophies onto ${result.gamesMatched} game(s).`
        );
        load();
      }
    } catch {
      showErrorToast("PlayStation import failed.");
    } finally {
      unsubRef.current?.();
      unsubRef.current = null;
      setImportingPsn(false);
      setProgress(null);
    }
  };

  const busy = syncing || importingPsn;

  return (
    <div className="achievements-sync">
      <header className="achievements-sync__header">
        <h1><TrophyIcon size={22} /> Achievements Sync</h1>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          <Button
            type="button"
            onClick={handleRunSync}
            disabled={busy}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <SyncIcon size={14} />
            {syncing ? "Syncing…" : "Sync now"}
          </Button>
          <Button
            type="button"
            theme="outline"
            onClick={handlePsnImport}
            disabled={busy}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <DownloadIcon size={14} />
            {importingPsn ? "Importing trophies…" : "Import PlayStation Achievements"}
          </Button>
        </div>
      </header>

      {busy && progress && (
        <div className="achievements-sync__progress">
          <p className="achievements-sync__progress-label">
            {progress.phase && <strong>{progress.phase}</strong>}
            {" "}— {progress.current}/{progress.total} — {progress.title}
          </p>
          <div className="achievements-sync__progress-bar">
            <div
              className="achievements-sync__progress-fill"
              style={{ width: `${Math.round((progress.current / Math.max(progress.total, 1)) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {busy && !progress && (
        <p className="achievements-sync__muted" style={{ marginTop: 8 }}>
          Starting…
        </p>
      )}

      {loading && !busy && (
        <p className="achievements-sync__muted">Loading sync report…</p>
      )}

      {!loading && !report && !busy && (
        <div className="achievements-sync__empty">
          <TrophyIcon size={32} />
          <h2>No sync yet</h2>
          <p className="achievements-sync__muted">
            Connect Exophase in Settings → Achievements and click "Sync now" above.
          </p>
        </div>
      )}

      {report && !busy && (
        <>
          <p className="achievements-sync__muted">
            Last run {new Date(report.finishedAt).toLocaleString()} — {report.gamesProcessed} games checked,{" "}
            {report.totalNewlyUnlocked} new achievement{report.totalNewlyUnlocked !== 1 ? "s" : ""} across{" "}
            {report.gamesUpdated} game{report.gamesUpdated !== 1 ? "s" : ""}.
          </p>

          {report.psnDetected.length > 0 && (
            <section className="achievements-sync__section">
              <h2>PlayStation games detected</h2>
              <p className="achievements-sync__muted">
                These library games have matching PSN trophies. Import to credit them on PC.
              </p>
              <ul className="achievements-sync__list">
                {report.psnDetected.map((g) => (
                  <li
                    key={`psn-${g.shop}-${g.objectId}`}
                    className="achievements-sync__row"
                    onClick={() => navigate(`/game/${g.shop}/${g.objectId}`)}
                  >
                    {g.iconUrl && <img src={g.iconUrl} alt="" width={32} height={32} />}
                    <span className="achievements-sync__row-title">{g.title}</span>
                    <span className="achievements-sync__badge achievements-sync__badge--psn">
                      PSN Game Detected
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="achievements-sync__section">
            <h2><SyncIcon size={16} /> Updated games</h2>
            {report.games.length === 0 ? (
              <p className="achievements-sync__muted">No new achievements this run.</p>
            ) : (
              <ul className="achievements-sync__list">
                {report.games.map((g) => (
                  <li
                    key={`${g.shop}-${g.objectId}`}
                    className="achievements-sync__row"
                    onClick={() => navigate(`/game/${g.shop}/${g.objectId}`)}
                  >
                    {g.iconUrl && <img src={g.iconUrl} alt="" width={32} height={32} />}
                    <span className="achievements-sync__row-title">{g.title}</span>
                    <span className="achievements-sync__badge">+{g.newlyUnlocked} new</span>
                    <span className="achievements-sync__muted">
                      {g.totalUnlocked}/{g.totalAchievements}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
