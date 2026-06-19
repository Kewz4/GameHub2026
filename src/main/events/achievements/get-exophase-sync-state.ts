import { registerEvent } from "../register-event";
import { getSyncSnapshot } from "./exophase-sync-broadcast";
import type { ExophaseSyncProgress } from "@main/services/achievements/exophase";

/**
 * Returns the live Exophase sync snapshot so a page opened while a sync is
 * already running can render the progress bar instantly, instead of waiting for
 * the next streamed `on-exophase-sync-progress` event (which can be a few
 * seconds out when a slow per-game step is in flight).
 */
const getExophaseSyncState = (
  _event: Electron.IpcMainInvokeEvent
): { active: boolean; progress: ExophaseSyncProgress | null } =>
  getSyncSnapshot();

registerEvent("getExophaseSyncState", getExophaseSyncState);
