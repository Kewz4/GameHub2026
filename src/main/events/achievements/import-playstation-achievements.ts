import { registerEvent } from "../register-event";
import {
  importPlaystationAchievements as runPsnImport,
  type ExophasePsnImportResult,
} from "@main/services/achievements/exophase";
import { withSyncBroadcast } from "./exophase-sync-broadcast";

const importPlaystationAchievements = (
  _event: Electron.IpcMainInvokeEvent
): Promise<ExophasePsnImportResult> =>
  withSyncBroadcast((onProgress) => runPsnImport(onProgress));

registerEvent("importPlaystationAchievements", importPlaystationAchievements);
