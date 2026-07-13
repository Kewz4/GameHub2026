import { useEffect, useRef, useState } from "react";
import gamehubIcon from "@renderer/assets/icons/gamehub.png";
import "./update-checker.scss";

type Phase =
  | "checking"
  | "not-available"
  | "available"
  | "downloading"
  | "downloaded"
  | "applying"
  | "error";

interface DownloadStats {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

function fmtBytes(b: number) {
  if (b >= 1e9) return (b / 1e9).toFixed(1) + " GB";
  if (b >= 1e6) return (b / 1e6).toFixed(1) + " MB";
  if (b >= 1e3) return (b / 1e3).toFixed(0) + " KB";
  return b + " B";
}

function fmtSpeed(bps: number) {
  return fmtBytes(bps) + "/s";
}

export default function UpdateChecker() {
  const [phase, setPhase] = useState<Phase>("checking");
  const [version, setVersion] = useState("");
  const [currentVersion, setCurrentVersion] = useState("");
  const [stats, setStats] = useState<DownloadStats | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const proceedCalled = useRef(false);
  // Track the highest percent seen so the bar never animates backwards (which
  // was the main "artifact" — electron-updater can emit a slightly lower
  // percent on some chunks, and the portable path jumps from 80% download to
  // 80% extraction start).
  const maxPercentRef = useRef(0);
  // Smoothed speed — the portable path only recalculates every 500ms, so
  // between updates bytesPerSecond drops to 0 and the display flickers.
  // Keep the last non-zero speed and let it decay gradually instead.
  const smoothedSpeedRef = useRef(0);

  const proceed = () => {
    if (proceedCalled.current) return;
    proceedCalled.current = true;
    window.electron.updateCheckerProceed();
  };

  useEffect(() => {
    const unsub = window.electron.onUpdateCheckerEvent((event) => {
      if (event.type === "checking") {
        setCurrentVersion(event.currentVersion);
        setPhase("checking");
      } else if (event.type === "not-available") {
        setCurrentVersion(event.currentVersion);
        setPhase("not-available");
        setTimeout(proceed, 1200);
      } else if (event.type === "available") {
        setVersion(event.version);
        setPhase("available");
      } else if (event.type === "downloading") {
        // Clamp percent so the bar never goes backwards.
        const percent = Math.max(maxPercentRef.current, event.percent);
        maxPercentRef.current = percent;

        // Smooth the speed: if the event sends 0 (portable path between
        // 500ms recalculations, or extraction phase), keep the last known
        // speed instead of flickering to "0 B/s".
        const rawSpeed = event.bytesPerSecond;
        if (rawSpeed > 0) {
          // Exponential moving average for a steady display.
          smoothedSpeedRef.current =
            smoothedSpeedRef.current === 0
              ? rawSpeed
              : smoothedSpeedRef.current * 0.7 + rawSpeed * 0.3;
        }

        setStats({
          percent,
          bytesPerSecond: smoothedSpeedRef.current,
          transferred: event.transferred,
          total: event.total,
        });
        setPhase("downloading");
      } else if (event.type === "downloaded") {
        setVersion(event.version);
        setPhase("downloaded");
      } else if (event.type === "applying") {
        setPhase("applying");
      } else if (event.type === "error") {
        setErrorMsg(event.message);
        setPhase("error");
        // Show the reason briefly, then continue into the app so a transient
        // GitHub failure never traps the user on the splash.
        setTimeout(proceed, 4000);
      }
    });
    return unsub;
  }, []);

  const statusLine = () => {
    switch (phase) {
      case "checking":
        return currentVersion
          ? `Checking for updates… (current: v${currentVersion})`
          : "Checking for updates…";
      case "not-available":
        return `GameHub v${currentVersion} is up to date.`;
      case "available":
        return `Update found: v${version}. Downloading…`;
      case "downloading":
        return stats
          ? `Downloading v${version} — ${fmtSpeed(stats.bytesPerSecond)}`
          : `Downloading v${version}…`;
      case "downloaded":
        return `v${version} ready to install.`;
      case "applying":
        return "Applying update…";
      case "error":
        return `Update failed: ${errorMsg}`;
    }
  };

  const showProgress =
    (phase === "downloading" || phase === "available") && stats;
  const showInstallBtn = phase === "downloaded";
  const isError = phase === "error";

  return (
    <div className="update-checker">
      <div className="update-checker__titlebar" />
      <div className="update-checker__body">
        <div className="update-checker__header">
          <img
            src={gamehubIcon}
            alt="GameHub"
            className="update-checker__logo"
          />
          <div>
            <div className="update-checker__title">GameHub Update Checker</div>
            <div className="update-checker__subtitle">
              Keeping your launcher up to date
            </div>
          </div>
        </div>

        <div className="update-checker__row">
          {(phase === "checking" ||
            phase === "available" ||
            phase === "downloading" ||
            phase === "applying") && (
            <div className="update-checker__spinner" />
          )}
          <div
            className={
              "update-checker__status" +
              (isError ? " update-checker__status--error" : "")
            }
          >
            {statusLine()}
          </div>
        </div>

        {showProgress && (
          <div className="update-checker__progress-wrap">
            <div className="update-checker__progress-bar">
              <div
                className="update-checker__progress-fill"
                style={{ width: `${Math.min(stats.percent, 100)}%` }}
              />
            </div>
            <div className="update-checker__progress-label">
              <span>{Math.round(stats.percent)}%</span>
              {stats.total > 0 && (
                <span>
                  {fmtBytes(stats.transferred)} / {fmtBytes(stats.total)}
                </span>
              )}
            </div>
          </div>
        )}

        <div className="update-checker__actions">
          <button
            type="button"
            className="update-checker__btn update-checker__btn--console"
            onClick={() => window.electron.toggleConsoleWindow()}
          >
            Open Console
          </button>

          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            {isError && (
              <button
                type="button"
                className="update-checker__btn update-checker__btn--ghost"
                onClick={proceed}
              >
                Continue anyway
              </button>
            )}
            {showInstallBtn && (
              <button
                type="button"
                className="update-checker__btn update-checker__btn--primary"
                onClick={() => window.electron.updateCheckerApply()}
              >
                Restart &amp; Install
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
