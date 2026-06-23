import type { AchievementFile, AchievementProgress, Game } from "@types";
import { gameAchievementsSublevel, levelKeys } from "@main/level";
import { parseAchievementProgressFile } from "./parse-achievement-file";
import { getUnlockedAchievements } from "@main/events/user/get-unlocked-achievements";
import { WindowManager } from "../window-manager";
import { achievementsLogger } from "../logger";

const progressKey = (a: { name: string }) => a.name.toUpperCase();

/** Returns true when the two progress lists differ in any value, so we only
 *  write to LevelDB / notify the renderer when something actually changed. */
const progressChanged = (
  prev: AchievementProgress[] | undefined,
  next: AchievementProgress[]
): boolean => {
  if ((prev?.length ?? 0) !== next.length) return true;
  const prevMap = new Map((prev ?? []).map((p) => [progressKey(p), p]));
  for (const p of next) {
    const before = prevMap.get(progressKey(p));
    if (!before || before.current !== p.current || before.max !== p.max) {
      return true;
    }
  }
  return false;
};

/**
 * Parse fractional achievement progress from all of a game's local achievement
 * files and persist it onto the game's achievement record. Progress is local
 * only (never synced to the cloud) and is surfaced on locked achievements in
 * the UI. Unlocked achievements are filtered out downstream, so stale progress
 * for an achievement that later unlocks is harmless.
 */
export const storeAchievementProgress = async (
  game: Game,
  achievementFiles: AchievementFile[]
): Promise<void> => {
  if (!achievementFiles.length) return;

  const merged = new Map<string, AchievementProgress>();

  for (const file of achievementFiles) {
    for (const entry of parseAchievementProgressFile(file.filePath, file.type)) {
      const key = progressKey(entry);
      const existing = merged.get(key);
      // Highest reported current wins when multiple files mention the same
      // achievement (e.g. a Steam-path file plus a cracker file).
      if (!existing || entry.current > existing.current) {
        merged.set(key, entry);
      }
    }
  }

  const next = [...merged.values()];

  const gameKey = levelKeys.game(game.shop, game.objectId);
  const record = await gameAchievementsSublevel.get(gameKey).catch(() => null);

  // Don't create a record from nothing — definitions are seeded elsewhere.
  if (!record) return;

  // Exophase records use their own apiNames; never attach cracker progress.
  if (record.source === "exophase") return;

  if (!progressChanged(record.achievementProgress, next)) return;

  await gameAchievementsSublevel.put(gameKey, {
    ...record,
    achievementProgress: next,
  });

  achievementsLogger.log(
    "Stored achievement progress",
    `${game.shop}:${game.objectId}`,
    `(${next.length} in-progress)`
  );

  // Refresh any open achievements page for this game.
  await getUnlockedAchievements(game.objectId, game.shop, true)
    .then((achievements) => {
      WindowManager.mainWindow?.webContents.send(
        `on-update-achievements-${game.objectId}-${game.shop}`,
        achievements
      );
    })
    .catch(() => {});
};
