import type {
  EmulatorSystem,
  GameAchievement,
  GameShop,
  SteamAchievement,
  UnlockedAchievement,
  UserPreferences,
} from "@types";
import { db, gameAchievementsSublevel, levelKeys } from "@main/level";
import { achievementsLogger } from "../../logger";
import { resolveRaGameId } from "./ra-game-resolver";
import { getGameInfoAndUserProgress, raBadgeUrl } from "./ra-api";

async function getCredentials(): Promise<{
  username: string;
  apiKey: string;
} | null> {
  const prefs = await db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);

  const username = prefs?.retroAchievementsUsername?.trim();
  const apiKey = prefs?.retroAchievementsApiKey?.trim();
  if (!username || !apiKey) return null;
  return { username, apiKey };
}

/**
 * Resolve a console game's RetroAchievements set by title and persist the full
 * definition list (with the user's earned status) to the achievements cache, so
 * the game-details page can show e.g. "0/34" *before* the first in-emulator
 * unlock. Any unlocks already recorded by the live watcher are preserved.
 *
 * Returns true when a set was found and stored.
 */
export async function loadRaAchievementList(
  shop: GameShop,
  objectId: string,
  system: EmulatorSystem,
  title: string
): Promise<boolean> {
  const credentials = await getCredentials();
  if (!credentials) return false;

  const gameId = await resolveRaGameId(
    system,
    title,
    credentials.username,
    credentials.apiKey
  );
  if (!gameId) return false;

  const progress = await getGameInfoAndUserProgress(
    credentials.username,
    credentials.apiKey,
    gameId
  );
  if (!progress || progress.achievements.length === 0) return false;

  const gameKey = levelKeys.game(shop, objectId);
  const cached = await gameAchievementsSublevel.get(gameKey).catch(() => null);

  const definitions: SteamAchievement[] = progress.achievements.map((a) => ({
    name: String(a.id),
    displayName: a.title,
    description: a.description,
    icon: raBadgeUrl(a.badgeName),
    icongray: raBadgeUrl(a.badgeName),
    hidden: false,
    points: a.points,
  }));

  // Merge the watcher's existing unlocks with whatever RA reports as earned, so
  // a refresh never drops an unlock recorded mid-session.
  const unlocked = new Map<string, UnlockedAchievement>();
  for (const u of cached?.unlockedAchievements ?? []) unlocked.set(u.name, u);
  for (const a of progress.achievements) {
    if (a.dateEarned) {
      unlocked.set(String(a.id), {
        name: String(a.id),
        unlockTime: Math.floor(new Date(a.dateEarned).getTime() / 1000),
      });
    }
  }

  const record: GameAchievement = {
    achievements: definitions,
    unlockedAchievements: [...unlocked.values()],
    updatedAt: Date.now(),
    language: cached?.language ?? "en",
    source: "retroachievements",
  };

  await gameAchievementsSublevel.put(gameKey, record);

  achievementsLogger.log(
    "Loaded RetroAchievements set for",
    title,
    `(gameId ${gameId}, ${definitions.length} achievements, ${unlocked.size} unlocked)`
  );
  return true;
}
