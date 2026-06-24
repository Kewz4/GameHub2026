import { registerEvent } from "../register-event";
import { gamesSublevel } from "@main/level";
import { logger, WindowManager } from "@main/services";
import { deduplicateTitle } from "@main/helpers/deduplicate-title";
import { normalizeGameTitle } from "@main/helpers/normalize-game-title";
import { dedupeAchievementRecordsByTitle } from "@main/helpers/dedupe-achievement-records";

const mergeDuplicateGames = async (_event: Electron.IpcMainInvokeEvent) => {
  const all = await gamesSublevel.values().all();
  const active = all.filter((g) => !g.isDeleted);

  // Group by NORMALIZED title so fuzzy-matching catches edition variants
  // (e.g. "The Witcher: Enhanced Edition" and "The Witcher: Enhanced Edition Director's Cut"
  //  both normalize to the same base title and are treated as the same game)
  const byNormalized = new Map<string, typeof active>();
  for (const game of active) {
    const key = normalizeGameTitle(game.title);
    const bucket = byNormalized.get(key) ?? [];
    bucket.push(game);
    byNormalized.set(key, bucket);
  }

  const duplicateBuckets = [...byNormalized.values()].filter(
    (b) => b.length > 1
  );
  const total = duplicateBuckets.length;
  let current = 0;
  let merged = 0;
  const mergedTitles: string[] = [];

  WindowManager.sendToAppWindows("on-dedup-progress", {
    current,
    total,
    title: null,
  });

  for (const bucket of duplicateBuckets) {
    current++;
    const representativeTitle = bucket[0].title;
    WindowManager.sendToAppWindows("on-dedup-progress", {
      current,
      total,
      title: representativeTitle,
    });

    await deduplicateTitle(representativeTitle).catch((err) => {
      logger.warn(
        `mergeDuplicateGames: dedup failed for "${representativeTitle}"`,
        err
      );
    });
    merged += bucket.length - 1;
    mergedTitles.push(representativeTitle);
    logger.log(
      `Merged ${bucket.length - 1} duplicate(s) for "${representativeTitle}"`
    );
  }

  // Independent pass: collapse duplicate ACHIEVEMENT records by title, even when
  // there's no longer a matching pair of active game records (e.g. leftovers
  // from a merge run on an older app version where the duplicate game was
  // already soft-deleted but its achievement record was never cleaned up).
  const achievementDuplicatesRemoved =
    await dedupeAchievementRecordsByTitle().catch((err) => {
      logger.warn("mergeDuplicateGames: achievement record dedup failed", err);
      return 0;
    });

  WindowManager.sendToAppWindows("on-dedup-progress", {
    current: total,
    total,
    title: null,
    done: true,
  });
  logger.log(
    `mergeDuplicateGames: ${merged} duplicates removed, ${achievementDuplicatesRemoved} duplicate achievement record(s) removed`
  );
  return { merged, mergedTitles };
};

registerEvent("mergeDuplicateGames", mergeDuplicateGames);
