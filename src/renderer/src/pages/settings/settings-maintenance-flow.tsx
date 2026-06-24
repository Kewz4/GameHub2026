import { useCallback, useRef, useState } from "react";
import {
  CheckCircleFillIcon,
  XCircleFillIcon,
  SkipIcon,
  SyncIcon,
  CircleIcon,
} from "@primer/octicons-react";

import { Button, Modal } from "@renderer/components";
import { useAppSelector } from "@renderer/hooks";
import "./settings-maintenance-flow.scss";

type StepStatus = "pending" | "running" | "done" | "skipped" | "failed";

interface StepState {
  key: string;
  label: string;
  description: string;
  status: StepStatus;
  detail: string | null;
}

/**
 * One-click "Run Full Maintenance" orchestrator. Fires every library / cloud
 * maintenance routine in a safe, dependency-aware order and reports a live
 * checklist. Steps whose preconditions aren't met (no Exophase link, not
 * logged into GameHub) are skipped rather than failed, and a failure in one
 * step never aborts the rest of the run.
 *
 * Order rationale:
 *  1. Refresh library from cloud  — pull the freshest server state first.
 *  2. Merge duplicates            — collapse dupes before counting achievements.
 *  3. Generate missing artwork    — fill cover/hero gaps on the clean library.
 *  4. Exophase achievements sync  — broad PC unlock import across platforms.
 *  5. PlayStation trophies import — PSN trophies via Exophase.
 *  6. Cloud debugger & repair     — final reconciliation, pushes local→cloud.
 */
export function SettingsMaintenanceFlow() {
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const [running, setRunning] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [steps, setSteps] = useState<StepState[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  const hasExophase = Boolean(userPreferences?.exophaseUserId);

  const buildSteps = useCallback((): StepState[] => {
    const exophaseSkip = hasExophase ? null : "Exophase account not connected";
    return [
      {
        key: "refresh",
        label: "Refresh library from cloud",
        description: "Pull the latest metadata and playtime from GameHub",
        status: "pending",
        detail: null,
      },
      {
        key: "dedup",
        label: "Merge duplicate games",
        description: "Collapse duplicate library entries",
        status: "pending",
        detail: null,
      },
      {
        key: "metadata",
        label: "Generate missing artwork",
        description: "Fetch covers from SteamGridDB for games without images",
        status: "pending",
        detail: null,
      },
      {
        key: "exophase",
        label: "Sync Exophase achievements",
        description: "Import PC unlocks across all managed platforms",
        status: exophaseSkip ? "skipped" : "pending",
        detail: exophaseSkip,
      },
      {
        key: "psn",
        label: "Import PlayStation trophies",
        description: "Credit PSN trophies via Exophase",
        status: exophaseSkip ? "skipped" : "pending",
        detail: exophaseSkip,
      },
      {
        key: "debugger",
        label: "Cloud debugger & repair",
        description: "Reconcile local vs cloud and auto-fix discrepancies",
        status: "pending",
        detail: null,
      },
    ];
  }, [hasExophase]);

  const patchStep = useCallback((key: string, patch: Partial<StepState>) => {
    setSteps((prev) =>
      prev.map((step) => (step.key === key ? { ...step, ...patch } : step))
    );
  }, []);

  const runStep = useCallback(
    async (key: string, run: () => Promise<string | null>): Promise<void> => {
      if (cancelledRef.current) return;
      // A step already marked skipped (precondition unmet) stays skipped.
      let shouldRun = true;
      setSteps((prev) => {
        const target = prev.find((step) => step.key === key);
        if (target && target.status === "skipped") shouldRun = false;
        return prev;
      });
      if (!shouldRun) return;

      patchStep(key, { status: "running", detail: null });
      try {
        const detail = await run();
        patchStep(key, { status: "done", detail });
      } catch (err) {
        patchStep(key, {
          status: "failed",
          detail: err instanceof Error ? err.message : "Failed",
        });
      } finally {
        setProgress(null);
      }
    },
    [patchStep]
  );

  const handleRun = useCallback(async () => {
    cancelledRef.current = false;
    setSteps(buildSteps());
    setModalOpen(true);
    setRunning(true);

    // 1. Refresh library assets from cloud.
    await runStep("refresh", async () => {
      await window.electron.refreshLibraryAssets();
      return "Library refreshed from cloud";
    });

    // 2. Merge duplicate games.
    await runStep("dedup", async () => {
      const unsub = window.electron.onDedupProgress((p) =>
        setProgress(`${p.current}/${p.total}${p.title ? ` — ${p.title}` : ""}`)
      );
      try {
        const result = await window.electron.mergeDuplicateGames();
        return result.merged > 0
          ? `Merged ${result.merged} duplicate game${result.merged !== 1 ? "s" : ""}`
          : "No duplicates found";
      } finally {
        unsub();
      }
    });

    // 3. Generate missing artwork.
    await runStep("metadata", async () => {
      const unsub = window.electron.onMetadataProgress((p) =>
        setProgress(`${p.current}/${p.total}${p.title ? ` — ${p.title}` : ""}`)
      );
      try {
        const result = await window.electron.generateMissingMetadata();
        return result.updated > 0
          ? `Updated ${result.updated} game${result.updated !== 1 ? "s" : ""}`
          : "All games already had artwork";
      } finally {
        unsub();
      }
    });

    // 4. Exophase achievements sync.
    await runStep("exophase", async () => {
      const unsub = window.electron.onExophaseSyncProgress((p) =>
        setProgress(`${p.current}/${p.total}${p.title ? ` — ${p.title}` : ""}`)
      );
      try {
        const result = await window.electron.syncExophaseAchievements();
        if (result.error) throw new Error(result.error);
        return `${result.totalUnlocked} unlocked across ${result.gamesWithAchievements} games`;
      } finally {
        unsub();
      }
    });

    // 5. PlayStation trophies import.
    await runStep("psn", async () => {
      const unsub = window.electron.onExophaseSyncProgress((p) =>
        setProgress(`${p.current}/${p.total}${p.title ? ` — ${p.title}` : ""}`)
      );
      try {
        const result = await window.electron.importPlaystationAchievements();
        if (result.error) throw new Error(result.error);
        return `Credited ${result.totalUnlocked} trophies onto ${result.gamesMatched} game${result.gamesMatched !== 1 ? "s" : ""}`;
      } finally {
        unsub();
      }
    });

    // 6. Cloud debugger & repair (must run last — pushes local → cloud).
    await runStep("debugger", async () => {
      const report = await window.electron.runCloudDebugger();
      if (report.notLoggedIn) {
        throw new Error("Not logged into GameHub");
      }
      const fixed = report.issues.filter((i) => i.fixed).length;
      const unfixed = report.issues.length - fixed;
      return report.issues.length === 0
        ? "No discrepancies — already in sync"
        : `${fixed} fixed, ${unfixed} remaining of ${report.issues.length} issue${report.issues.length !== 1 ? "s" : ""}`;
    });

    setRunning(false);
    setProgress(null);
  }, [buildSteps, runStep]);

  const renderIcon = (status: StepStatus) => {
    switch (status) {
      case "running":
        return <SyncIcon className="maintenance-flow__icon--spin" />;
      case "done":
        return <CheckCircleFillIcon className="maintenance-flow__icon--done" />;
      case "failed":
        return <XCircleFillIcon className="maintenance-flow__icon--failed" />;
      case "skipped":
        return <SkipIcon className="maintenance-flow__icon--skipped" />;
      default:
        return <CircleIcon className="maintenance-flow__icon--pending" />;
    }
  };

  return (
    <>
      <div className="settings-general-action-row">
        <div className="settings-general-action-row__info">
          <span>Run full maintenance</span>
          <small>
            Refresh, de-duplicate, fetch artwork, sync achievements, and
            reconcile with the cloud — all in one pass.
          </small>
        </div>
        <Button onClick={handleRun} disabled={running}>
          {running ? "Running…" : "Run all"}
        </Button>
      </div>

      <Modal
        visible={modalOpen}
        title="Full Maintenance"
        description={
          running
            ? "Running maintenance — this can take a few minutes."
            : "Maintenance complete."
        }
        onClose={() => {
          if (!running) setModalOpen(false);
        }}
        clickOutsideToClose={!running}
      >
        <ul className="maintenance-flow__list">
          {steps.map((step) => (
            <li key={step.key} className="maintenance-flow__step">
              <span className="maintenance-flow__step-icon">
                {renderIcon(step.status)}
              </span>
              <div className="maintenance-flow__step-body">
                <span className="maintenance-flow__step-label">
                  {step.label}
                </span>
                <small className="maintenance-flow__step-detail">
                  {step.status === "running" && progress
                    ? progress
                    : (step.detail ?? step.description)}
                </small>
              </div>
            </li>
          ))}
        </ul>

        {!running && (
          <div className="maintenance-flow__footer">
            <Button theme="outline" onClick={() => setModalOpen(false)}>
              Close
            </Button>
          </div>
        )}
      </Modal>
    </>
  );
}
