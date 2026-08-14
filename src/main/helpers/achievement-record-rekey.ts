import type { GameAchievement, UnlockedAchievement } from "@types";

const cloneAchievementRecord = (
  record: GameAchievement,
  updatedAt: number
): GameAchievement => ({
  ...record,
  achievements: [...(record.achievements ?? [])],
  unlockedAchievements: [...(record.unlockedAchievements ?? [])],
  achievementProgress: record.achievementProgress
    ? [...record.achievementProgress]
    : undefined,
  updatedAt,
});

/**
 * Build the single achievement row that survives an explicit identity rekey.
 *
 * A manually-added game can have local unlock history before it is matched to
 * a canonical Steam app. In that case Steam has no row to merge into yet, so
 * the source row itself must move to the canonical key. Keeping this policy
 * pure also makes the destructive half of the transition testable: callers
 * persist the returned canonical row before deleting the source key.
 */
export const mergeAchievementRecordForRekey = (
  canonical: GameAchievement | null,
  source: GameAchievement,
  updatedAt = Date.now()
): GameAchievement => {
  if (!canonical) return cloneAchievementRecord(source, updatedAt);

  const byName = new Map<string, UnlockedAchievement>();
  for (const achievement of [
    ...(canonical.unlockedAchievements ?? []),
    ...(source.unlockedAchievements ?? []),
  ]) {
    const key = (achievement.name ?? "").toUpperCase();
    const previous = byName.get(key);
    if (
      !previous ||
      (achievement.unlockTime ?? 0) < (previous.unlockTime ?? 0)
    ) {
      byName.set(key, achievement);
    }
  }

  return {
    ...canonical,
    achievements: [...(canonical.achievements ?? [])],
    unlockedAchievements: [...byName.values()],
    achievementProgress: canonical.achievementProgress
      ? [...canonical.achievementProgress]
      : undefined,
    updatedAt,
  };
};

interface AchievementRecordRekeyStore {
  put: (key: string, record: GameAchievement) => Promise<void>;
  remove: (key: string) => Promise<void>;
}

export const persistAchievementRecordRekey = async (
  canonicalKey: string,
  sourceKey: string,
  canonical: GameAchievement | null,
  source: GameAchievement,
  store: AchievementRecordRekeyStore,
  updatedAt = Date.now()
) => {
  const merged = mergeAchievementRecordForRekey(canonical, source, updatedAt);

  // The order is intentional: a crash can temporarily leave a duplicate, but
  // can never erase the user's only local achievement history.
  await store.put(canonicalKey, merged);
  await store.remove(sourceKey);

  return merged;
};
