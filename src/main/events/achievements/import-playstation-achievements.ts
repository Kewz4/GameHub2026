import { registerEvent } from "../register-event";
import {
  importPlaystationAchievements as runPsnImport,
  type ExophasePsnImportResult,
} from "@main/services/achievements/exophase";
import { withSyncBroadcast } from "./exophase-sync-broadcast";
import { db, levelKeys } from "@main/level";
import type { ExophaseSyncReport, ExophaseSyncReportGame } from "@types";
import { runCloudDebuggerInternal } from "@main/events/library/run-cloud-debugger";

/**
 * Merges the PSN run's report into whatever Achievements Sync report is already
 * persisted (from the PC sync), deduplicating by shop:objectId and keeping the
 * entry with the most unlocks. Without this, PSN-imported games never showed up
 * on the Sync report page.
 */
const mergeAndPersistReport = async (psnReport?: ExophaseSyncReport) => {
  if (!psnReport) return;

  const existing = await db
    .get<string, ExophaseSyncReport>(levelKeys.exophaseSyncReport, {
      valueEncoding: "json",
    })
    .catch(() => null);

  const byKey = new Map<string, ExophaseSyncReportGame>();
  const add = (g: ExophaseSyncReportGame) => {
    const key = `${g.shop}:${g.objectId || g.title}`;
    const prev = byKey.get(key);
    if (!prev || g.totalUnlocked > prev.totalUnlocked) byKey.set(key, g);
  };
  existing?.games.forEach(add);
  psnReport.games.forEach(add);

  const merged: ExophaseSyncReport = {
    startedAt: psnReport.startedAt,
    finishedAt: psnReport.finishedAt,
    gamesProcessed: (existing?.gamesProcessed ?? 0) + psnReport.gamesProcessed,
    gamesUpdated: [...byKey.values()].filter((g) => g.newlyUnlocked > 0).length,
    totalNewlyUnlocked: [...byKey.values()].reduce(
      (n, g) => n + g.newlyUnlocked,
      0
    ),
    games: [...byKey.values()],
    psnDetected: existing?.psnDetected ?? [],
  };

  await db
    .put(levelKeys.exophaseSyncReport, merged, { valueEncoding: "json" })
    .catch(() => {});
};

const importPlaystationAchievements = async (
  _event: Electron.IpcMainInvokeEvent
): Promise<ExophasePsnImportResult> => {
  const result = await withSyncBroadcast((onProgress) =>
    runPsnImport(onProgress)
  );
  await mergeAndPersistReport(result.report);
  if (
    (result.report?.totalNewlyUnlocked ?? 0) > 0 ||
    result.totalUnlocked > 0
  ) {
    await runCloudDebuggerInternal();
  }
  return result;
};

registerEvent("importPlaystationAchievements", importPlaystationAchievements);
