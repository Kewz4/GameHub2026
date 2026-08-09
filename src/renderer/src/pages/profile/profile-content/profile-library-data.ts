import type { UserGame } from "@types";

export type ProfileGameSort =
  | "playtime"
  | "achievementCount"
  | "playedRecently";

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

/** Merge two representations of one game without lowering local progress. */
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
 * Deduplicates first by shop/objectId and then by exact normalized title. The
 * title pass is intentionally conservative: it collapses the same title from
 * multiple import sources, but does not strip edition/remaster qualifiers.
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

export const sortProfileGames = (
  games: UserGame[],
  sortBy: ProfileGameSort
): UserGame[] =>
  [...games].toSorted((a, b) => {
    let difference = 0;
    if (sortBy === "playtime") {
      difference = (b.playTimeInSeconds ?? 0) - (a.playTimeInSeconds ?? 0);
    } else if (sortBy === "achievementCount") {
      difference =
        (b.unlockedAchievementCount ?? 0) - (a.unlockedAchievementCount ?? 0);
    } else {
      difference =
        (b.lastTimePlayed ? new Date(b.lastTimePlayed).getTime() : 0) -
        (a.lastTimePlayed ? new Date(a.lastTimePlayed).getTime() : 0);
    }

    return difference || a.title.localeCompare(b.title);
  });

export const totalProfilePlayTimeInSeconds = (games: UserGame[]): number =>
  games.reduce(
    (total, game) => total + Math.max(0, game.playTimeInSeconds ?? 0),
    0
  );

interface MergeProfileCollectionsInput {
  serverLibrary: UserGame[];
  serverPinned: UserGame[];
  localLibrary: UserGame[];
  localPinned: UserGame[];
  sortBy: ProfileGameSort;
}

export const mergeProfileGameCollections = ({
  serverLibrary,
  serverPinned,
  localLibrary,
  localPinned,
  sortBy,
}: MergeProfileCollectionsInput): {
  library: UserGame[];
  pinned: UserGame[];
} => {
  const pinned = sortProfileGames(
    dedupeProfileGames([...localPinned, ...serverPinned]),
    sortBy
  );
  const pinnedIdentities = new Set(pinned.map(profileGameKey));
  const pinnedTitles = new Set(
    pinned.map((game) => normalizedExactTitle(game.title)).filter(Boolean)
  );

  const library = sortProfileGames(
    dedupeProfileGames([...localLibrary, ...serverLibrary]).filter(
      (game) =>
        !pinnedIdentities.has(profileGameKey(game)) &&
        !pinnedTitles.has(normalizedExactTitle(game.title))
    ),
    sortBy
  );

  return { library, pinned };
};
