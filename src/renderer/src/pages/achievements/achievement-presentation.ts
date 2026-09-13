import type { ComparedAchievements, UserAchievement } from "@types";

export interface AchievementPointsSummary {
  earned: number;
  total: number;
  hasPointData: boolean;
}

export const summarizeAchievementPoints = (
  achievements: readonly UserAchievement[]
): AchievementPointsSummary => ({
  earned: achievements.reduce(
    (sum, achievement) =>
      sum + (achievement.unlocked ? (achievement.points ?? 0) : 0),
    0
  ),
  total: achievements.reduce(
    (sum, achievement) => sum + (achievement.points ?? 0),
    0
  ),
  hasPointData: achievements.some(
    (achievement) => achievement.points !== undefined
  ),
});

const normalizeAchievementLabel = (value: string) =>
  value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "");

export const resolveComparedOwnerStat = (
  achievement: ComparedAchievements["achievements"][number],
  ownerAchievements: readonly UserAchievement[]
) => {
  const label = normalizeAchievementLabel(achievement.displayName);
  const local = ownerAchievements.find(
    (candidate) => normalizeAchievementLabel(candidate.displayName) === label
  );

  if (local) {
    return {
      unlocked: local.unlocked,
      unlockTime: local.unlockTime ?? 0,
    };
  }

  return achievement.ownerStat;
};
