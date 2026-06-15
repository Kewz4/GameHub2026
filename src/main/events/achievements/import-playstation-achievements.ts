import { registerEvent } from "../register-event";
import { WindowManager } from "@main/services/window-manager";
import {
  importPlaystationAchievements as runPsnImport,
  type ExophasePsnImportResult,
} from "@main/services/achievements/exophase";

const importPlaystationAchievements = (
  _event: Electron.IpcMainInvokeEvent
): Promise<ExophasePsnImportResult> =>
  runPsnImport((progress) => {
    WindowManager.sendToAppWindows("on-exophase-sync-progress", progress);
  });

registerEvent("importPlaystationAchievements", importPlaystationAchievements);
