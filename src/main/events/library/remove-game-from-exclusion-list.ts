import { registerEvent } from "../register-event";
import { db, levelKeys } from "@main/level";
import type { UserPreferences } from "@types";

const removeGameFromExclusionList = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: string,
  objectId: string
) => {
  const prefs = await db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => ({}) as UserPreferences);

  const existing = prefs?.excludedGames ?? [];
  const updated = existing.filter(
    (g) => !(g.shop === shop && g.objectId === objectId)
  );

  await db.put(
    levelKeys.userPreferences,
    { ...(prefs ?? {}), excludedGames: updated },
    { valueEncoding: "json" }
  );

  return updated;
};

registerEvent("removeGameFromExclusionList", removeGameFromExclusionList);
