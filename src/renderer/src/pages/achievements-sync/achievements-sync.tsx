import { useCallback, useEffect, useState } from "react";
import { TrophyIcon, DownloadIcon, SyncIcon } from "@primer/octicons-react";
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
  const [importingPsn, setImportingPsn] = useState(false);

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

  const handlePsnImport = async () => {
    setImportingPsn(true);
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
      setImportingPsn(false);
    }
  };

  if (loading) {
    return (
      <div className="achievements-sync">
        <p className="achievements-sync__muted">Loading sync report…</p>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="achievements-sync">
        <div className="achievements-sync__empty">
          <TrophyIcon size={32} />
          <h2>No sync yet</h2>
          <p className="achievements-sync__muted">
            Achievements are synced in the background every couple of hours.
            Connect Exophase in Settings → Achievements to get started.
          </p>
          <Button type="button" onClick={() => navigate("/settings")}>
            Open Settings
          </Button>
        </div>
      </div>
    );
  }

  const finished = new Date(report.finishedAt).toLocaleString();

  return (
    <div className="achievements-sync">
      <header className="achievements-sync__header">
        <h1>
          <TrophyIcon size={22} /> Achievements Sync finished
        </h1>
        <p className="achievements-sync__muted">
          Last run {finished} — {report.gamesProcessed} games checked,{" "}
          {report.totalNewlyUnlocked} new achievement
          {report.totalNewlyUnlocked !== 1 ? "s" : ""} across{" "}
          {report.gamesUpdated} game{report.gamesUpdated !== 1 ? "s" : ""}.
        </p>
      </header>

      {report.psnDetected.length > 0 && (
        <section className="achievements-sync__section">
          <h2>PlayStation games detected</h2>
          <p className="achievements-sync__muted">
            These library games also exist on PlayStation. Import your PSN
            trophies to credit the matching achievements on PC.
          </p>
          <Button
            type="button"
            onClick={handlePsnImport}
            disabled={importingPsn}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <DownloadIcon size={14} />
            {importingPsn
              ? "Importing trophies…"
              : "Import PlayStation Achievements"}
          </Button>
          <ul className="achievements-sync__list">
            {report.psnDetected.map((g) => (
              <li
                key={`psn-${g.shop}-${g.objectId}`}
                className="achievements-sync__row"
                onClick={() => navigate(`/game/${g.shop}/${g.objectId}`)}
              >
                {g.iconUrl && (
                  <img src={g.iconUrl} alt="" width={32} height={32} />
                )}
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
        <h2>
          <SyncIcon size={16} /> Updated games
        </h2>
        {report.games.length === 0 ? (
          <p className="achievements-sync__muted">
            No new achievements this run.
          </p>
        ) : (
          <ul className="achievements-sync__list">
            {report.games.map((g) => (
              <li
                key={`${g.shop}-${g.objectId}`}
                className="achievements-sync__row"
                onClick={() => navigate(`/game/${g.shop}/${g.objectId}`)}
              >
                {g.iconUrl && (
                  <img src={g.iconUrl} alt="" width={32} height={32} />
                )}
                <span className="achievements-sync__row-title">{g.title}</span>
                <span className="achievements-sync__badge">
                  +{g.newlyUnlocked} new
                </span>
                <span className="achievements-sync__muted">
                  {g.totalUnlocked}/{g.totalAchievements}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
