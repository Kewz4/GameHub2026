import { registerEvent } from "../register-event";
import { db, levelKeys } from "@main/level";
import type { UserPreferences } from "@types";

const addGameToExclusionList = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: string,
  objectId: string,
  title: string
) => {
  const prefs = await db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => ({}) as UserPreferences);

  const existing = prefs?.excludedGames ?? [];
  const alreadyExcluded = existing.some(
    (g) => g.shop === shop && g.objectId === objectId
  );
  if (alreadyExcluded) return existing;

  const updated = [
    ...existing,
    { shop, objectId, title, excludedAt: new Date().toISOString() },
  ];

  await db.put(
    levelKeys.userPreferences,
    { ...(prefs ?? {}), excludedGames: updated },
    { valueEncoding: "json" }
  );

  return updated;
};

registerEvent("addGameToExclusionList", addGameToExclusionList);
