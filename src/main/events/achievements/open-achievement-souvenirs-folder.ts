import fs from "node:fs";
import { shell } from "electron";
import { achievementSouvenirsPath } from "@main/constants";
import { registerEvent } from "../register-event";

const openAchievementSouvenirsFolder = async () => {
  await fs.promises.mkdir(achievementSouvenirsPath, { recursive: true });
  const error = await shell.openPath(achievementSouvenirsPath);
  if (error) throw new Error("achievement_souvenir_folder_open_failed");
};

registerEvent("openAchievementSouvenirsFolder", openAchievementSouvenirsFolder);
