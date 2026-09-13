export const SETTINGS_CATEGORY_IDS = [
  "general",
  "downloads",
  "notifications",
  "content_gameplay",
  "integrations",
  "achievements",
  "compatibility",
  "big_picture",
  "emulation",
  "account_privacy",
] as const;

export type SettingsCategoryId = (typeof SETTINGS_CATEGORY_IDS)[number];

const legacyTabMap: Readonly<Record<number, SettingsCategoryId>> = {
  0: "general",
  1: "content_gameplay",
  2: "downloads",
  3: "general",
  4: "integrations",
  5: "account_privacy",
};

export function isSettingsCategoryId(
  value: string
): value is SettingsCategoryId {
  return (SETTINGS_CATEGORY_IDS as readonly string[]).includes(value);
}

export function resolveSettingsCategoryId(
  tab: string | null
): SettingsCategoryId | null {
  if (!tab) return null;
  if (isSettingsCategoryId(tab)) return tab;

  const legacyIndex = Number(tab);
  if (!Number.isInteger(legacyIndex)) return null;
  return legacyTabMap[legacyIndex] ?? null;
}

export function getSettingsCategoryNavigationTarget(
  categoryIds: readonly SettingsCategoryId[],
  currentCategoryId: SettingsCategoryId,
  key: string
): SettingsCategoryId | null {
  if (categoryIds.length === 0) return null;

  if (key === "Home") return categoryIds[0] ?? null;
  if (key === "End") return categoryIds.at(-1) ?? null;

  const direction =
    key === "ArrowRight" || key === "ArrowDown"
      ? 1
      : key === "ArrowLeft" || key === "ArrowUp"
        ? -1
        : 0;
  if (direction === 0) return null;

  const currentIndex = Math.max(categoryIds.indexOf(currentCategoryId), 0);
  const nextIndex =
    (currentIndex + direction + categoryIds.length) % categoryIds.length;
  return categoryIds[nextIndex] ?? null;
}
