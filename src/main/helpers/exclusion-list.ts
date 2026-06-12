import { db, levelKeys } from "@main/level";
import type { ExcludedGame, UserPreferences } from "@types";

/** Loads the user's game exclusion list from preferences. */
export const getExcludedGames = async (): Promise<ExcludedGame[]> => {
  const prefs = await db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);
  return prefs?.excludedGames ?? [];
};

/** Matches by shop+objectId, falling back to a case-insensitive title match
 * so excluded games are skipped even when found through a different shop. */
export const isGameExcluded = (
  excluded: ExcludedGame[],
  shop: string,
  objectId: string,
  title?: string
): boolean => {
  const normalizedTitle = title?.trim().toLowerCase();
  return excluded.some(
    (g) =>
      (g.shop === shop && g.objectId === objectId) ||
      (normalizedTitle !== undefined &&
        g.title.trim().toLowerCase() === normalizedTitle)
  );
};
