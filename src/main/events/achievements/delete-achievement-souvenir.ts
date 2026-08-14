import type { DeleteAchievementSouvenirRequest, GameShop } from "@types";
import { registerEvent } from "../register-event";
import { AchievementSouvenirService } from "@main/services/achievements/achievement-souvenir-service";

const allowedShops = new Set<GameShop>([
  "steam",
  "epic",
  "gog",
  "battlenet",
  "xbox",
  "riot",
  "ubisoft",
  "ea",
  "launchbox",
  "custom",
]);

const deleteAchievementSouvenir = async (
  _event: Electron.IpcMainInvokeEvent,
  request: DeleteAchievementSouvenirRequest
) => {
  if (
    !request ||
    !allowedShops.has(request.shop) ||
    typeof request.objectId !== "string" ||
    !request.objectId ||
    request.objectId.length > 1_024 ||
    typeof request.achievementName !== "string" ||
    !request.achievementName.trim() ||
    request.achievementName.length > 512
  ) {
    throw new Error("achievement_souvenir_delete_invalid");
  }
  await AchievementSouvenirService.delete(
    request.shop,
    request.objectId,
    request.achievementName
  );
};

registerEvent("deleteAchievementSouvenir", deleteAchievementSouvenir);
