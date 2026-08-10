import type { AchievementGameStat, UserGame } from "@types";

export type BigPictureProfileView = "games" | "achievements";

export type BigPictureProfileSort =
  | "playedRecently"
  | "playtime"
  | "achievementCount"
  | "title";

export const profileGameKey = (game: Pick<UserGame, "shop" | "objectId">) =>
  `${game.shop}:${game.objectId}`;

const normalizedExactTitle = (title: string) =>
  title.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");

const latestDate = (
  left: UserGame["lastTimePlayed"],
  right: UserGame["lastTimePlayed"]
) => {
  const leftTime = left ? new Date(left).getTime() : 0;
  const rightTime = right ? new Date(right).getTime() : 0;
  return rightTime > leftTime ? right : left;
};

const preferText = <T extends string | null | undefined>(
  left: T,
  right: T
): T => (left?.trim() ? left : right);

/** Merge repeated local/cloud representations without lowering richer progress. */
export const mergeProfileGame = (
  left: UserGame,
  right: UserGame
): UserGame => ({
  ...right,
  ...left,
  title: preferText(left.title, right.title),
  iconUrl: preferText(left.iconUrl, right.iconUrl),
  coverImageUrl: preferText(left.coverImageUrl, right.coverImageUrl),
  libraryImageUrl: preferText(left.libraryImageUrl, right.libraryImageUrl),
  libraryHeroImageUrl: preferText(
    left.libraryHeroImageUrl,
    right.libraryHeroImageUrl
  ),
  logoImageUrl: preferText(left.logoImageUrl, right.logoImageUrl),
  playTimeInSeconds: Math.max(
    left.playTimeInSeconds ?? 0,
    right.playTimeInSeconds ?? 0
  ),
  achievementCount: Math.max(
    left.achievementCount ?? 0,
    right.achievementCount ?? 0
  ),
  unlockedAchievementCount: Math.max(
    left.unlockedAchievementCount ?? 0,
    right.unlockedAchievementCount ?? 0
  ),
  achievementsPointsEarnedSum: Math.max(
    left.achievementsPointsEarnedSum ?? 0,
    right.achievementsPointsEarnedSum ?? 0
  ),
  lastTimePlayed: latestDate(left.lastTimePlayed, right.lastTimePlayed),
  isPinned: Boolean(left.isPinned || right.isPinned),
});

/**
 * Dedupe the complete profile dataset first by stable identity and then by an
 * exact normalized title. The title pass is deliberately conservative so an
 * imported copy cannot create a second card, while editions remain distinct.
 */
export const dedupeProfileGames = (games: UserGame[]): UserGame[] => {
  const byIdentity = new Map<string, UserGame>();

  for (const game of games) {
    const key = profileGameKey(game);
    const existing = byIdentity.get(key);
    byIdentity.set(key, existing ? mergeProfileGame(existing, game) : game);
  }

  const byTitle = new Map<string, UserGame>();

  for (const game of byIdentity.values()) {
    const titleKey = normalizedExactTitle(game.title);
    const key = titleKey || profileGameKey(game);
    const existing = byTitle.get(key);
    byTitle.set(key, existing ? mergeProfileGame(existing, game) : game);
  }

  return [...byTitle.values()];
};

export const profileGameHasAchievements = (
  game: Pick<UserGame, "achievementCount" | "unlockedAchievementCount">
) =>
  (game.achievementCount ?? 0) > 0 || (game.unlockedAchievementCount ?? 0) > 0;

export const sortProfileGames = (
  games: UserGame[],
  sortBy: BigPictureProfileSort
): UserGame[] =>
  [...games].toSorted((left, right) => {
    let difference = 0;

    if (sortBy === "playtime") {
      difference =
        (right.playTimeInSeconds ?? 0) - (left.playTimeInSeconds ?? 0);
    } else if (sortBy === "achievementCount") {
      difference =
        (right.unlockedAchievementCount ?? 0) -
        (left.unlockedAchievementCount ?? 0);
    } else if (sortBy === "playedRecently") {
      difference =
        (right.lastTimePlayed ? new Date(right.lastTimePlayed).getTime() : 0) -
        (left.lastTimePlayed ? new Date(left.lastTimePlayed).getTime() : 0);
    }

    return difference || left.title.localeCompare(right.title);
  });

function achievementStatAsProfileGame(stat: AchievementGameStat): UserGame {
  return {
    objectId: stat.objectId,
    shop: stat.shop,
    title: stat.title,
    iconUrl: stat.iconUrl,
    libraryHeroImageUrl: null,
    libraryImageUrl: null,
    logoImageUrl: null,
    logoPosition: null,
    coverImageUrl: null,
    downloadSources: [],
    playTimeInSeconds: 0,
    lastTimePlayed: null,
    unlockedAchievementCount: stat.unlockedAchievementCount,
    achievementCount: Math.max(
      stat.achievementCount,
      stat.unlockedAchievementCount
    ),
    achievementsPointsEarnedSum: 0,
    hasManuallyUpdatedPlaytime: false,
    isFavorite: false,
    isPinned: false,
  };
}

/** Add achievement-only local games before the same full-dataset dedupe pass. */
export const mergeAchievementStatsIntoProfileGames = (
  games: UserGame[],
  achievementStats: AchievementGameStat[]
) =>
  dedupeProfileGames([
    ...games,
    ...achievementStats.map(achievementStatAsProfileGame),
  ]);

/** API pages are fetched in parallel after the first page reveals totalCount. */
export const getProfileLibraryPageOffsets = (
  totalCount: number,
  pageSize: number
) => {
  if (!Number.isFinite(totalCount) || pageSize <= 0) return [];

  const offsets: number[] = [];
  for (let skip = pageSize; skip < totalCount; skip += pageSize) {
    offsets.push(skip);
  }
  return offsets;
};

/** Kept for callers/tests that need pinned-first ordering before a later sort. */
export function mergeUniqueProfileGames(
  pinnedGames: UserGame[],
  libraryGames: UserGame[],
  limit = Number.POSITIVE_INFINITY
) {
  return dedupeProfileGames([...pinnedGames, ...libraryGames]).slice(0, limit);
}
