import { registerEvent } from "../register-event";
import { AchievementSouvenirService } from "@main/services/achievements/achievement-souvenir-service";

const getAchievementSouvenirs = async (
  _event: Electron.IpcMainInvokeEvent,
  ownerId: string
) => {
  if (typeof ownerId !== "string" || !ownerId || ownerId.length > 512) {
    throw new Error("achievement_souvenir_owner_invalid");
  }
  return AchievementSouvenirService.listProfile(ownerId);
};

registerEvent("getAchievementSouvenirs", getAchievementSouvenirs);
