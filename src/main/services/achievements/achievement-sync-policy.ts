import type { SteamAchievement, UnlockedAchievement } from "@types";

const normalizeAchievementName = (name: string | null | undefined) =>
  (name ?? "").trim().toUpperCase();

const preferredUnlockTime = (left: number, right: number): number => {
  const leftIsValid = Number.isFinite(left) && left > 0;
  const rightIsValid = Number.isFinite(right) && right > 0;

  if (!leftIsValid) return right;
  if (!rightIsValid) return left;
  return Math.min(left, right);
};

export const canonicalizeAchievementDefinitions = (
  definitions: SteamAchievement[] | null | undefined
): SteamAchievement[] => {
  const byName = new Map<string, SteamAchievement>();
  for (const definition of definitions ?? []) {
    const normalized = normalizeAchievementName(definition.name);
    if (!normalized) continue;

    const previous = byName.get(normalized);
    if (!previous) {
      byName.set(normalized, definition);
      continue;
    }

    // Prefer whichever duplicate carries richer presentation metadata while
    // preserving the first canonical apiName/casing.
    byName.set(normalized, {
      ...definition,
      ...previous,
      displayName: previous.displayName || definition.displayName,
      description: previous.description || definition.description,
      icon: previous.icon || definition.icon,
      icongray: previous.icongray || definition.icongray,
    });
  }

  return [...byName.values()];
};

/**
 * Produces the only achievement payload shape that may be persisted or sent to
 * Hydra Cloud: canonical definition names, one row per name, deterministic
 * ordering, and the earliest known unlock timestamp.
 *
 * When definitions are unavailable we still deduplicate, but do not discard
 * unlocks. This preserves offline discoveries until the schema can be fetched.
 */
export const canonicalizeUnlockedAchievements = (
  definitions: Pick<SteamAchievement, "name">[] | null | undefined,
  unlocked: UnlockedAchievement[] | null | undefined
): UnlockedAchievement[] => {
  const canonicalNames = new Map<string, string>();
  for (const definition of definitions ?? []) {
    const normalized = normalizeAchievementName(definition.name);
    if (normalized && !canonicalNames.has(normalized)) {
      canonicalNames.set(normalized, definition.name);
    }
  }

  const requireDefinitionMatch = canonicalNames.size > 0;
  const byName = new Map<string, UnlockedAchievement>();

  for (const candidate of unlocked ?? []) {
    const normalized = normalizeAchievementName(candidate.name);
    if (!normalized) continue;

    const canonicalName = canonicalNames.get(normalized);
    if (requireDefinitionMatch && !canonicalName) continue;

    const next: UnlockedAchievement = {
      name: canonicalName ?? candidate.name.trim(),
      unlockTime: candidate.unlockTime,
    };
    const previous = byName.get(normalized);

    if (!previous) {
      byName.set(normalized, next);
      continue;
    }

    byName.set(normalized, {
      name: previous.name,
      unlockTime: preferredUnlockTime(
        previous.unlockTime,
        candidate.unlockTime
      ),
    });
  }

  return [...byName.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([, achievement]) => achievement);
};

export const getNewUnlockedAchievements = (
  definitions: Pick<SteamAchievement, "name">[] | null | undefined,
  existing: UnlockedAchievement[] | null | undefined,
  incoming: UnlockedAchievement[] | null | undefined
): UnlockedAchievement[] => {
  const current = canonicalizeUnlockedAchievements(definitions, existing);
  const currentNames = new Set(
    current.map((achievement) => normalizeAchievementName(achievement.name))
  );

  return canonicalizeUnlockedAchievements(definitions, incoming).filter(
    (achievement) =>
      !currentNames.has(normalizeAchievementName(achievement.name))
  );
};

export const achievementPayloadFingerprint = (
  achievements: UnlockedAchievement[]
): string =>
  achievements
    .map(
      (achievement) =>
        `${normalizeAchievementName(achievement.name)}:${achievement.unlockTime}`
    )
    .join("|");
