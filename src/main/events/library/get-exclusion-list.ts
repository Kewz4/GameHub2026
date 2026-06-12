import { registerEvent } from "../register-event";
import { db, levelKeys } from "@main/level";
import type { UserPreferences } from "@types";

const getExclusionList = async (_event: Electron.IpcMainInvokeEvent) => {
  const prefs = await db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);
  return prefs?.excludedGames ?? [];
};

registerEvent("getExclusionList", getExclusionList);
