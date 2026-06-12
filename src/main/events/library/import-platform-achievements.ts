import { registerEvent } from "../register-event";
import { WindowManager } from "@main/services";
import {
  importSteamAchievements,
  importGogAchievements,
  importEpicAchievements,
  importXboxAchievements,
  type AchievementImportResult,
} from "@main/services/achievements/platform-achievement-importer";

export type AchievementImportPlatform = "steam" | "epic" | "gog" | "xbox";

const importers: Record<
  AchievementImportPlatform,
  () => Promise<AchievementImportResult>
> = {
  steam: importSteamAchievements,
  epic: importEpicAchievements,
  gog: importGogAchievements,
  xbox: importXboxAchievements,
};

const importPlatformAchievements = async (
  _event: Electron.IpcMainInvokeEvent,
  platform: AchievementImportPlatform
) => {
  const importer = importers[platform];
  if (!importer) throw new Error(`Unknown platform: ${platform}`);

  const result = await importer();
  WindowManager.sendToAppWindows("on-library-batch-complete");
  return result;
};

registerEvent("importPlatformAchievements", importPlatformAchievements);
