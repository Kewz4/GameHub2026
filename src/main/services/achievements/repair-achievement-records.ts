import { gameAchievementsSublevel, gamesSublevel } from "@main/level";
import { achievementsLogger } from "../logger";
import {
  achievementPayloadFingerprint,
  canonicalizeAchievementDefinitions,
  canonicalizeUnlockedAchievements,
} from "./achievement-sync-policy";

export interface AchievementRepairSummary {
  scanned: number;
  repaired: number;
  removedDefinitionDuplicates: number;
  removedUnlockRows: number;
}

let repairInFlight: Promise<AchievementRepairSummary> | null = null;

/** Repairs stale source-name and duplicate rows without deleting game history. */
export const repairAchievementRecords = async () => {
  if (repairInFlight) return repairInFlight;

  repairInFlight = (async (): Promise<AchievementRepairSummary> => {
    const summary: AchievementRepairSummary = {
      scanned: 0,
      repaired: 0,
      removedDefinitionDuplicates: 0,
      removedUnlockRows: 0,
    };

    for await (const [key, record] of gameAchievementsSublevel.iterator()) {
      if (!record) continue;
      summary.scanned++;

      const definitions = canonicalizeAchievementDefinitions(
        record.achievements ?? []
      );
      const unlocked = canonicalizeUnlockedAchievements(
        definitions,
        record.unlockedAchievements ?? []
      );
      const definitionDelta =
        (record.achievements?.length ?? 0) - definitions.length;
      const unlockDelta =
        (record.unlockedAchievements?.length ?? 0) - unlocked.length;
      const changed =
        definitionDelta !== 0 ||
        achievementPayloadFingerprint(record.unlockedAchievements ?? []) !==
          achievementPayloadFingerprint(unlocked);

      if (!changed) continue;

      await gameAchievementsSublevel.put(key, {
        ...record,
        achievements: definitions,
        unlockedAchievements: unlocked,
        updatedAt: record.updatedAt,
      });
      summary.repaired++;
      summary.removedDefinitionDuplicates += Math.max(0, definitionDelta);
      summary.removedUnlockRows += Math.max(0, unlockDelta);

      const game = await gamesSublevel.get(key).catch(() => null);
      if (game) {
        await gamesSublevel.put(key, {
          ...game,
          achievementCount:
            definitions.length > 0 ? definitions.length : game.achievementCount,
          unlockedAchievementCount: unlocked.length,
        });
      }
    }

    if (summary.repaired > 0) {
      achievementsLogger.log(
        `[Achievements repair] ${summary.repaired}/${summary.scanned} records normalized; removed ${summary.removedUnlockRows} stale/duplicate unlock rows and ${summary.removedDefinitionDuplicates} duplicate definitions`
      );
    }
    return summary;
  })().finally(() => {
    repairInFlight = null;
  });

  return repairInFlight;
};
