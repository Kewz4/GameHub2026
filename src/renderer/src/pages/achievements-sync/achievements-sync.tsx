import { useCallback, useEffect, useState } from "react";
import {
  TrophyIcon,
  DownloadIcon,
  SyncIcon,
  CheckCircleFillIcon,
  AlertIcon,
  XIcon,
  QuestionIcon,
  CloudIcon,
} from "@primer/octicons-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@renderer/components";
import { useAppDispatch, useToast } from "@renderer/hooks";
import { setHeaderTitle } from "@renderer/features";
import type { ExophaseSyncReport, ExophaseSyncReportGame } from "@types";
import "./achievements-sync.scss";

function DebugModal({
  game,
  onClose,
}: {
  game: ExophaseSyncReportGame;
  onClose: () => void;
}) {
  const d = game.debug;
  return (
    <div className="achievements-sync__debug-backdrop" onClick={onClose}>
      <div
        className="achievements-sync__debug-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="achievements-sync__debug-header">
          <strong>{game.title}</strong>
          <button
            onClick={onClose}
            className="achievements-sync__debug-close"
            type="button"
          >
            <XIcon size={16} />
          </button>
        </div>

        <table className="achievements-sync__debug-table">
          <tbody>
            <tr>
              <td>Account title</td>
              <td>{d?.accountTitle ?? game.title}</td>
            </tr>
            <tr>
              <td>Platform</td>
              <td>{d?.platformSlug ?? "—"}</td>
            </tr>
            <tr>
              <td>Awards URL</td>
              <td className="achievements-sync__debug-url">
                {d?.awardsUrl ?? "Not resolved"}
              </td>
            </tr>
            <tr>
              <td>Exophase defs</td>
              <td>{d?.exophaseDefs ?? "—"}</td>
            </tr>
            <tr>
              <td>Exophase unlocked</td>
              <td>{d?.exophaseUnlocked ?? "—"}</td>
            </tr>
            <tr>
              <td>Catalogue match</td>
              <td>
                {d?.catalogueMatched
                  ? `Yes — "${d.catalogueTitle}" (${game.shop}:${game.objectId})`
                  : "No match"}
              </td>
            </tr>
            <tr>
              <td>In library</td>
              <td>{d?.inLibrary ? "Yes" : "No"}</td>
            </tr>
            <tr>
              <td>Definition source</td>
              <td>{d?.defSource ?? "—"}</td>
            </tr>
            <tr>
              <td>HydraAPI achievements synced</td>
              <td>
                {d?.hydraApiSync === "synced"
                  ? `✓ Synced${d.hydraApiSyncedCount ? ` (${d.hydraApiSyncedCount})` : ""}`
                  : d?.hydraApiSync === "no-match"
                    ? "No Exophase unlock matched a HydraAPI achievement"
                    : d?.hydraApiSync === "not-eligible"
                      ? "Not eligible — no HydraAPI/Steam definitions (local only)"
                      : d?.hydraApiSync === "logged-out"
                        ? "Skipped — not logged in to Hydra"
                        : d?.hydraApiSync === "no-remote-id"
                          ? "Skipped — game not in your Hydra cloud library"
                          : d?.hydraApiSync === "failed"
                            ? "✗ Upload failed (subscription/network)"
                            : "—"}
              </td>
            </tr>
            {game.verificationChecks && (
              <>
                <tr>
                  <td>Persisted</td>
                  <td>{game.verificationChecks.persisted ? "✓" : "✗"}</td>
                </tr>
                <tr>
                  <td>Unlock count consistent</td>
                  <td>
                    {game.verificationChecks.unlockCountConsistent ? "✓" : "✗"}
                  </td>
                </tr>
                <tr>
                  <td>No orphan unlocks</td>
                  <td>{game.verificationChecks.noOrphanUnlocks ? "✓" : "✗"}</td>
                </tr>
              </>
            )}
            <tr>
              <td>Applied unlocked</td>
              <td>
                {game.totalUnlocked}/{game.totalAchievements}
              </td>
            </tr>
            {d?.note && (
              <tr>
                <td>Note</td>
                <td>{d.note}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AchievementsSync() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { showSuccessToast, showErrorToast } = useToast();

  const [report, setReport] = useState<ExophaseSyncReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [importingPsn, setImportingPsn] = useState(false);
  const [progress, setProgress] = useState<{
    current: number;
    total: number;
    title: string;
    phase?: string;
  } | null>(null);
  const [debugGame, setDebugGame] = useState<ExophaseSyncReportGame | null>(
    null
  );
  const [cloudGames, setCloudGames] = useState<
    Array<{
      shop: string;
      objectId: string;
      title: string;
      iconUrl: string | null;
      totalAchievements: number;
      unlockedAchievements: number;
    }>
  >([]);
  const [showCloudTab, setShowCloudTab] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    window.electron
      .getExophaseSyncReport()
      .then(setReport)
      .catch(() => setReport(null))
      .finally(() => setLoading(false));
    window.electron
      .getHydraCloudAchievements()
      .then(setCloudGames)
      .catch(() => setCloudGames([]));
  }, []);

  useEffect(() => {
    dispatch(setHeaderTitle("Achievements Sync"));
    load();
    // If a sync is already running when this page opens, reflect it immediately
    // instead of waiting for the next streamed progress event (~seconds).
    window.electron
      .getExophaseSyncState()
      .then((state) => {
        if (state?.active) {
          setSyncing(true);
          if (state.progress) setProgress(state.progress);
        }
      })
      .catch(() => {});
  }, [dispatch, load]);

  useEffect(() => {
    const offProgress = window.electron.onExophaseSyncProgress((p) => {
      setSyncing(true);
      setProgress(p);
    });
    const offActive = window.electron.onExophaseSyncActive((active) => {
      setSyncing(active);
      if (!active) {
        setProgress(null);
        setImportingPsn(false);
        load();
      }
    });
    return () => {
      offProgress();
      offActive();
    };
  }, [load]);

  const handleRunSync = async () => {
    setSyncing(true);
    setProgress(null);
    try {
      await window.electron.runExophaseBackgroundSync();
      showSuccessToast("Achievements sync finished");
      load();
    } catch {
      showErrorToast("Sync failed.");
    }
  };

  const handlePsnImport = async () => {
    setImportingPsn(true);
    setProgress(null);
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

  const busy = syncing || importingPsn;

  const renderGameRow = (g: ExophaseSyncReportGame, keyPrefix: string) => {
    const hasNoAwards =
      g.debug?.awardsUrl === null || g.debug?.exophaseDefs === 0;
    const notInLibrary = g.debug && !g.debug.inLibrary;

    return (
      <li
        key={`${keyPrefix}-${g.shop}-${g.objectId || g.title}`}
        className={`achievements-sync__row${hasNoAwards || notInLibrary ? " achievements-sync__row--dim" : ""}`}
      >
        <div
          className="achievements-sync__row-main"
          onClick={() =>
            g.objectId ? navigate(`/game/${g.shop}/${g.objectId}`) : undefined
          }
          style={{ cursor: g.objectId ? "pointer" : "default" }}
        >
          {g.iconUrl ? (
            <img src={g.iconUrl} alt="" width={32} height={32} />
          ) : (
            <div className="achievements-sync__row-icon-placeholder">
              <TrophyIcon size={16} />
            </div>
          )}
          <span className="achievements-sync__row-title">{g.title}</span>

          {g.verified !== undefined && (
            <span
              title={
                g.verificationChecks
                  ? `Persisted: ${g.verificationChecks.persisted ? "✓" : "✗"} · Unlock count: ${g.verificationChecks.unlockCountConsistent ? "✓" : "✗"} · No orphans: ${g.verificationChecks.noOrphanUnlocks ? "✓" : "✗"}`
                  : undefined
              }
              style={{
                display: "inline-flex",
                color: g.verified ? "#3fb950" : "#e3b341",
              }}
            >
              {g.verified ? (
                <CheckCircleFillIcon size={14} />
              ) : (
                <AlertIcon size={14} />
              )}
            </span>
          )}

          {g.newlyUnlocked > 0 && (
            <span className="achievements-sync__badge">
              +{g.newlyUnlocked} new
            </span>
          )}

          <span className="achievements-sync__muted">
            {g.totalUnlocked}/{g.totalAchievements}
          </span>
        </div>

        <button
          className="achievements-sync__debug-btn"
          type="button"
          title="Show match details"
          onClick={(e) => {
            e.stopPropagation();
            setDebugGame(g);
          }}
        >
          <QuestionIcon size={14} />
        </button>
      </li>
    );
  };

  return (
    <div className="achievements-sync">
      <header className="achievements-sync__header">
        <h1>
          <TrophyIcon size={22} /> Achievements Sync
        </h1>
        <div
          style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}
        >
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
            {importingPsn
              ? "Importing trophies…"
              : "Import PlayStation Achievements"}
          </Button>
          <Button
            type="button"
            theme={showCloudTab ? "primary" : "outline"}
            onClick={() => setShowCloudTab((v) => !v)}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <CloudIcon size={14} />
            Hydra Cloud ({cloudGames.length})
          </Button>
        </div>
      </header>

      {showCloudTab && (
        <section className="achievements-sync__section">
          <h2>
            <CloudIcon size={16} /> HydraAPI Cloud Achievements
          </h2>
          <p
            className="achievements-sync__muted"
            style={{ marginBottom: 8, fontSize: "0.85em" }}
          >
            Games whose unlocked achievements have been matched to HydraAPI
            Steam definitions and uploaded to your Hydra cloud account.
          </p>
          {cloudGames.length === 0 ? (
            <p className="achievements-sync__muted">
              No cloud-synced achievements yet. Run an Exophase sync to match
              Steam unlocks to your Hydra account.
            </p>
          ) : (
            <ul className="achievements-sync__list">
              {cloudGames.map((g) => (
                <li
                  key={`cloud-${g.shop}-${g.objectId}`}
                  className="achievements-sync__row"
                  onClick={() => navigate(`/game/${g.shop}/${g.objectId}`)}
                  style={{ cursor: "pointer" }}
                >
                  <div className="achievements-sync__row-main">
                    {g.iconUrl ? (
                      <img src={g.iconUrl} alt="" width={32} height={32} />
                    ) : (
                      <div className="achievements-sync__row-icon-placeholder">
                        <TrophyIcon size={16} />
                      </div>
                    )}
                    <span className="achievements-sync__row-title">
                      {g.title}
                    </span>
                    <span
                      style={{
                        display: "inline-flex",
                        color: "#3fb950",
                      }}
                    >
                      <CheckCircleFillIcon size={14} />
                    </span>
                    <span className="achievements-sync__muted">
                      {g.unlockedAchievements}/{g.totalAchievements}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {busy && progress && (
        <div className="achievements-sync__progress">
          <p className="achievements-sync__progress-label">
            {progress.phase && <strong>{progress.phase}</strong>} —{" "}
            {progress.current}/{progress.total} — {progress.title}
          </p>
          <div className="achievements-sync__progress-bar">
            <div
              className="achievements-sync__progress-fill"
              style={{
                width: `${Math.round((progress.current / Math.max(progress.total, 1)) * 100)}%`,
              }}
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
            Connect Exophase in Settings → Achievements and click "Sync now"
            above.
          </p>
        </div>
      )}

      {report && !busy && (
        <>
          <p className="achievements-sync__muted">
            Last run {new Date(report.finishedAt).toLocaleString()} —{" "}
            {report.gamesProcessed} games checked, {report.totalNewlyUnlocked}{" "}
            new achievement{report.totalNewlyUnlocked !== 1 ? "s" : ""} across{" "}
            {report.gamesUpdated} game{report.gamesUpdated !== 1 ? "s" : ""}.
          </p>

          {report.psnDetected.length > 0 && (
            <section className="achievements-sync__section">
              <h2>PlayStation games detected</h2>
              <ul className="achievements-sync__list">
                {report.psnDetected.map((g) => renderGameRow(g, "psn"))}
              </ul>
            </section>
          )}

          <section className="achievements-sync__section">
            <h2>
              <SyncIcon size={16} /> All synced games
            </h2>
            <p
              className="achievements-sync__muted"
              style={{ marginBottom: 8, fontSize: "0.85em" }}
            >
              Click the <QuestionIcon size={12} /> on any row to see exactly how
              the match was made. Dimmed rows had no awards or are not in your
              library.
            </p>
            {report.games.length === 0 ? (
              <p className="achievements-sync__muted">No games processed.</p>
            ) : (
              <ul className="achievements-sync__list">
                {report.games.map((g) => renderGameRow(g, "game"))}
              </ul>
            )}
          </section>
        </>
      )}

      {debugGame && (
        <DebugModal game={debugGame} onClose={() => setDebugGame(null)} />
      )}
    </div>
  );
}
