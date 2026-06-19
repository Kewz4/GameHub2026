import { ShopAssets, UnlockedAchievement } from "@types";
import { HydraApi } from "../hydra-api";
import {
  db,
  gameAchievementsSublevel,
  gamesShopAssetsSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";

type ProfileGame = {
  id: string;
  createdAt?: string | null;
  collectionIds?: string[];
  collectionId?: string | null;
  lastTimePlayed: Date | null;
  playTimeInMilliseconds: number;
  hasManuallyUpdatedPlaytime: boolean;
  isFavorite?: boolean;
  isPinned?: boolean;
  achievementCount: number;
  unlockedAchievementCount: number;
} & ShopAssets;

/**
 * For a given cloud game that has unlocks on the server, fetch the individual
 * achievement unlocks via the compare endpoint and merge them into the local
 * gameAchievementsSublevel. This is what makes "logged in with Hydra →
 * achievements appear locally" work, since /profile/games only returns counts,
 * not the actual unlock names.
 *
 * Only runs when the cloud has MORE unlocks than we have locally, so it never
 * overwrites a richer local state.
 */
const syncCloudAchievementsToLocal = async (
  shop: string,
  objectId: string,
  gameKey: string,
  cloudUnlockedCount: number,
  selfId: string
): Promise<void> => {
  const local = await gameAchievementsSublevel.get(gameKey).catch(() => null);
  const localUnlockedCount = local?.unlockedAchievements?.length ?? 0;

  // Skip if local already has at least as many unlocks as the cloud.
  if (localUnlockedCount >= cloudUnlockedCount) return;

  const compareResult = await HydraApi.get<{
    achievements: Array<{
      name?: string;
      displayName?: string;
      targetStat: { unlocked: boolean; unlockTime?: number | null };
    }>;
  }>(
    `/users/${selfId}/games/achievements/compare`,
    { shop, objectId, language: "en" }
  ).catch(() => null);

  if (!compareResult) return;

  const cloudUnlocked: UnlockedAchievement[] = compareResult.achievements
    .filter((a) => a.targetStat.unlocked && a.name)
    .map((a) => ({
      name: a.name!,
      unlockTime: a.targetStat.unlockTime ?? Date.now(),
    }));

  if (cloudUnlocked.length === 0) return;

  // Merge: keep existing local unlocks, add cloud ones not already present.
  const existingNames = new Set(
    (local?.unlockedAchievements ?? []).map((u) => u.name.toUpperCase())
  );
  const merged = [
    ...(local?.unlockedAchievements ?? []),
    ...cloudUnlocked.filter(
      (u) => !existingNames.has(u.name.toUpperCase())
    ),
  ];

  await gameAchievementsSublevel
    .put(gameKey, {
      ...local,
      achievements: local?.achievements ?? [],
      unlockedAchievements: merged,
      updatedAt: local?.updatedAt ?? Date.now(),
      language: local?.language ?? "en",
    })
    .catch(() => {});
};

const getLocalCollectionIds = (
  localGame:
    | {
        collectionIds?: string[];
      }
    | {
        collectionId?: string | null;
      }
    | null
    | undefined
): string[] => {
  if (!localGame) return [];

  if (
    Array.isArray((localGame as { collectionIds?: string[] }).collectionIds)
  ) {
    return (localGame as { collectionIds: string[] }).collectionIds;
  }

  const legacyCollectionId = (localGame as { collectionId?: string | null })
    .collectionId;

  return legacyCollectionId ? [legacyCollectionId] : [];
};

/**
 * Pulls the user's Hydra cloud profile games and reconciles them with the
 * local library.
 *
 * `createMissing` controls whether cloud games that don't yet exist locally
 * are CREATED as new library entries:
 *   • true  (default) — full sync. Used at sign-in / explicit library sync, the
 *     moments a user genuinely expects their cross-device library to come down.
 *   • false — update-only. Used by the routine library-page refresh that fires
 *     on every navigation (and right after an Exophase achievement import).
 *     In this mode we never silently materialize cloud games the user didn't
 *     deliberately add on THIS install — we only refresh data for games that
 *     are already present locally.
 */
export const mergeWithRemoteGames = async (
  { createMissing = true }: { createMissing?: boolean } = {}
) => {
  // Resolve the logged-in user's own ID once so we can pull cloud achievement
  // unlocks for any game that has more on the server than we have locally.
  const selfId = await db
    .get<string, { id: string }>(levelKeys.user, { valueEncoding: "json" })
    .then((u) => u?.id ?? null)
    .catch(() => null);

  return HydraApi.get<ProfileGame[]>("/profile/games")
    .then(async (response) => {
      for (const game of response) {
        const gameKey = levelKeys.game(game.shop, game.objectId);
        const localGame = await gamesSublevel.get(gameKey);

        // Update-only mode: skip games not already in the local library so a
        // routine refresh never adds games the user didn't add here.
        if (!localGame && !createMissing) continue;

        const localCollectionIds = getLocalCollectionIds(localGame);

        const hasRemoteCollectionField =
          Array.isArray(game.collectionIds) ||
          Object.prototype.hasOwnProperty.call(game, "collectionId");

        const remoteCollectionIds = Array.isArray(game.collectionIds)
          ? game.collectionIds
          : game.collectionId
            ? [game.collectionId]
            : [];

        const mergedCollectionIds = hasRemoteCollectionField
          ? remoteCollectionIds
          : localCollectionIds;
        const remoteAddedToLibraryAt = game.createdAt
          ? new Date(game.createdAt)
          : null;

        if (localGame) {
          const updatedLastTimePlayed =
            localGame.lastTimePlayed == null ||
            (game.lastTimePlayed &&
              new Date(game.lastTimePlayed) >
                new Date(localGame.lastTimePlayed))
              ? game.lastTimePlayed
              : localGame.lastTimePlayed;

          const updatedPlayTime =
            localGame.playTimeInMilliseconds < game.playTimeInMilliseconds
              ? game.playTimeInMilliseconds
              : localGame.playTimeInMilliseconds;

          await gamesSublevel.put(gameKey, {
            ...localGame,
            remoteId: game.id,
            addedToLibraryAt:
              localGame.addedToLibraryAt ?? remoteAddedToLibraryAt,
            lastTimePlayed: updatedLastTimePlayed,
            playTimeInMilliseconds: updatedPlayTime,
            favorite: game.isFavorite ?? localGame.favorite,
            isPinned: game.isPinned ?? localGame.isPinned,
            collectionIds: mergedCollectionIds,
            achievementCount: game.achievementCount,
            unlockedAchievementCount: game.unlockedAchievementCount,
          });
        } else {
          await gamesSublevel.put(gameKey, {
            objectId: game.objectId,
            title: game.title,
            remoteId: game.id,
            shop: game.shop,
            iconUrl: game.iconUrl,
            libraryHeroImageUrl: game.libraryHeroImageUrl,
            logoImageUrl: game.logoImageUrl,
            addedToLibraryAt: remoteAddedToLibraryAt,
            lastTimePlayed: game.lastTimePlayed,
            playTimeInMilliseconds: game.playTimeInMilliseconds,
            hasManuallyUpdatedPlaytime: game.hasManuallyUpdatedPlaytime,
            isDeleted: false,
            favorite: game.isFavorite ?? false,
            isPinned: game.isPinned ?? false,
            collectionIds: mergedCollectionIds,
            achievementCount: game.achievementCount,
            unlockedAchievementCount: game.unlockedAchievementCount,
          });
        }

        const localGameShopAsset = await gamesShopAssetsSublevel.get(gameKey);

        // Construct coverImageUrl if not provided by backend (Steam games use predictable pattern)
        const coverImageUrl =
          game.coverImageUrl ||
          (game.shop === "steam"
            ? `https://shared.steamstatic.com/store_item_assets/steam/apps/${game.objectId}/library_600x900_2x.jpg`
            : null);

        await gamesShopAssetsSublevel.put(gameKey, {
          updatedAt: Date.now(),
          ...localGameShopAsset,
          shop: game.shop,
          objectId: game.objectId,
          title: localGame?.title || game.title, // Preserve local title if it exists
          coverImageUrl,
          libraryHeroImageUrl: game.libraryHeroImageUrl,
          libraryImageUrl: game.libraryImageUrl,
          logoImageUrl: game.logoImageUrl,
          iconUrl: game.iconUrl,
          logoPosition: game.logoPosition,
          downloadSources: game.downloadSources,
        });

        // Pull individual achievement unlocks from HydraCloud when the server
        // has more than we have locally. This is what makes Hydra login restore
        // achievements that were previously synced up via Exophase/local files.
        if (selfId && game.unlockedAchievementCount > 0) {
          await syncCloudAchievementsToLocal(
            game.shop,
            game.objectId,
            gameKey,
            game.unlockedAchievementCount,
            selfId
          );
        }
      }
    })
    .catch(() => {});
};
