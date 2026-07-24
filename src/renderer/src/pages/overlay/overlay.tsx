import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import type { HydraOverlayContext, HydraOverlayPerformance } from "@types";
import "./overlay.scss";

type OverlayMode = "hidden" | "toast" | "pinned" | "full";

const formatSessionTime = (startedAt: number) => {
  if (!startedAt) return "0:00";
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
};

const metricValue = (value: number | null) =>
  value === null || value === undefined ? "—" : String(value);

/**
 * The in-game overlay renderer (loaded at `#/overlay`). For the injected
 * (Windows) path it is painted offscreen into the game via asdf-overlay and
 * driven by `on-overlay-mode`; on the fallback BrowserWindow it simply shows in
 * full mode. Live FPS arrives on `on-overlay-performance`.
 */
export default function Overlay() {
  const location = useLocation();
  const initialMode: OverlayMode = location.pathname.includes("overlay-fps")
    ? "pinned"
    : location.pathname.includes("overlay-toast")
      ? "toast"
      : "full";

  const [mode, setMode] = useState<OverlayMode>(initialMode);
  const [context, setContext] = useState<HydraOverlayContext | null>(null);
  const [performance, setPerformance] =
    useState<HydraOverlayPerformance | null>(null);
  const [note, setNote] = useState("");
  const [noteSaved, setNoteSaved] = useState(true);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshContext = useCallback(() => {
    window.electron
      .getOverlayContext()
      .then((next) => {
        if (next) {
          setContext(next);
          setPerformance(next.performance);
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refreshContext();
    window.electron
      .getOverlayNote()
      .then(setNote)
      .catch(() => undefined);

    const unsubscribers = [
      window.electron.onOverlayMode((next) => setMode(next as OverlayMode)),
      window.electron.onOverlayShown(() => {
        setMode("full");
        refreshContext();
      }),
      window.electron.onOverlayPerformance((value) => setPerformance(value)),
      window.electron.onOverlayGamepadAction((action) => {
        if (action === "back") void window.electron.closeHydraOverlay();
      }),
    ];
    return () => unsubscribers.forEach((off) => off?.());
  }, [refreshContext]);

  // Keep the session timer ticking while visible.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (mode === "hidden") return;
    const id = setInterval(() => forceTick((value) => value + 1), 1000);
    return () => clearInterval(id);
  }, [mode]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") void window.electron.closeHydraOverlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // This route renders in a transparent window painted over the game, so drop
  // the app's opaque body background while the overlay is mounted.
  useEffect(() => {
    document.body.classList.add("overlay-window");
    return () => document.body.classList.remove("overlay-window");
  }, []);

  const handleNoteChange = (value: string) => {
    setNote(value);
    setNoteSaved(false);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => {
      window.electron
        .saveOverlayNote(value)
        .then(() => setNoteSaved(true))
        .catch(() => undefined);
    }, 600);
  };

  const perfRows = useMemo(() => {
    const rows = context?.settings.performanceRows;
    const perf = performance;
    if (!rows || !perf) return [];
    return [
      rows.fps && { label: "FPS", value: metricValue(perf.fps) },
      rows.averageFps && { label: "Avg", value: metricValue(perf.averageFps) },
      rows.onePercentLow && {
        label: "1% low",
        value: metricValue(perf.onePercentLow),
      },
      rows.frameTime && {
        label: "Frame",
        value: perf.frameTimeMs === null ? "—" : `${perf.frameTimeMs} ms`,
      },
    ].filter(Boolean) as { label: string; value: string }[];
  }, [context, performance]);

  if (mode === "hidden") return null;

  const performanceEnabled = context?.settings.performanceEnabled ?? false;

  // Pinned / FPS-only mode: just the compact performance chip.
  if (mode === "pinned") {
    if (!performanceEnabled || !perfRows.length) return null;
    return (
      <div className="overlay overlay--pinned">
        <div className="overlay-hud">
          {perfRows.map((row) => (
            <div key={row.label} className="overlay-hud__row">
              <span className="overlay-hud__label">{row.label}</span>
              <span className="overlay-hud__value">{row.value}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Activation toast.
  if (mode === "toast") {
    return (
      <div className="overlay overlay--toast">
        <div className="overlay-toast">
          <span className="overlay-toast__dot" />
          <div>
            <strong>Overlay ready</strong>
            <p>
              Press <kbd>{context?.shortcut ?? "Shift+F3"}</kbd> or hold the
              Guide button to open it.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const game = context?.game;
  const achievements = context?.achievements ?? [];
  const unlocked = achievements.filter((a) => a.unlocked).length;

  return (
    <div className="overlay overlay--full">
      <div className="overlay-panel">
        <header className="overlay-header">
          <div className="overlay-header__game">
            {game?.coverImageUrl || game?.iconUrl ? (
              <img
                className="overlay-header__cover"
                src={game.coverImageUrl ?? game.iconUrl ?? undefined}
                alt=""
              />
            ) : (
              <div className="overlay-header__cover overlay-header__cover--empty" />
            )}
            <div>
              <h1 className="overlay-header__title">
                {game?.title ?? "In-game overlay"}
              </h1>
              <p className="overlay-header__meta">
                {game ? formatSessionTime(game.sessionStartedAt) : ""} this
                session
                {context?.user ? ` · ${context.user.displayName}` : ""}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="overlay-close"
            onClick={() => void window.electron.closeHydraOverlay()}
            aria-label="Close overlay"
          >
            ✕
          </button>
        </header>

        <div className="overlay-grid">
          {performanceEnabled && (
            <section className="overlay-card overlay-card--perf">
              <div className="overlay-card__head">
                <h2>Performance</h2>
                <label className="overlay-pin">
                  <input
                    type="checkbox"
                    checked={context?.performancePinned ?? false}
                    onChange={(event) =>
                      void window.electron.setOverlayPerformancePinned(
                        event.target.checked
                      )
                    }
                  />
                  Pin HUD
                </label>
              </div>
              <div className="overlay-perf">
                <div className="overlay-perf__fps">
                  {metricValue(performance?.fps ?? null)}
                  <span>fps</span>
                </div>
                <div className="overlay-perf__rows">
                  {perfRows
                    .filter((row) => row.label !== "FPS")
                    .map((row) => (
                      <div key={row.label} className="overlay-perf__row">
                        <span>{row.label}</span>
                        <b>{row.value}</b>
                      </div>
                    ))}
                </div>
              </div>
            </section>
          )}

          <section className="overlay-card overlay-card--ach">
            <div className="overlay-card__head">
              <h2>Achievements</h2>
              <span className="overlay-card__count">
                {unlocked}/{achievements.length}
              </span>
            </div>
            <ul className="overlay-ach">
              {achievements.slice(0, 6).map((achievement) => (
                <li
                  key={achievement.name}
                  className={`overlay-ach__item ${achievement.unlocked ? "is-unlocked" : ""}`}
                >
                  <img src={achievement.icon} alt="" loading="lazy" />
                  <div>
                    <p>{achievement.displayName}</p>
                    <small>{achievement.description}</small>
                  </div>
                </li>
              ))}
              {achievements.length === 0 && (
                <li className="overlay-ach__empty">
                  No achievements tracked for this game.
                </li>
              )}
            </ul>
          </section>

          <section className="overlay-card overlay-card--notes">
            <div className="overlay-card__head">
              <h2>Notes</h2>
              <span className="overlay-card__count">
                {noteSaved ? "Saved" : "Saving…"}
              </span>
            </div>
            <textarea
              className="overlay-notes"
              value={note}
              placeholder="Jot down a code, a boss strategy, where you left off…"
              onChange={(event) => handleNoteChange(event.target.value)}
            />
          </section>
        </div>

        <footer className="overlay-foot">
          Press <kbd>{context?.shortcut ?? "Shift+F3"}</kbd> or{" "}
          <kbd>{context?.controllerShortcut ?? "View + Menu"}</kbd> to close ·
          hold the Guide button to toggle
        </footer>
      </div>
    </div>
  );
}
