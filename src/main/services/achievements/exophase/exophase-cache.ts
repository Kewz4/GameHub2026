import {
  exophaseCacheSublevel,
  gameAchievementsSublevel,
  gamesSublevel,
  db,
  levelKeys,
} from "@main/level";
import type {
  ExophaseCacheEntry,
  Game,
  GameShop,
  SteamAchievement,
  UnlockedAchievement,
  UserPreferences,
} from "@types";
import { achievementsLogger } from "@main/services/logger";
import { WindowManager } from "@main/services/window-manager";
import { R2Sync } from "@main/services/r2-sync";
import { DEFAULT_MANAGED_SHOPS, SHOP_TO_EXOPHASE_SLUG } from "./constants";
import {
  normalizeExophaseTitle,
  type ExophaseAchievement,
} from "./exophase-api";

const SHARED_CACHE_BLOB = "exophase-cache.json";

/**
 * Cache keys. A game matched to the Hydra catalogue is keyed by its canonical
 * `id:<shop>:<objectId>` so it applies to the exact library record. EVERY entry
 * is ALSO keyed by `title:<normalizedTitle>` so a custom game added later (e.g.
 * a PS4-only title not in the catalogue) inherits the cached achievements by
 * name. Definitions + the owner's unlocks live in the entry and are shared via
 * R2.
 */
export const idCacheKey = (shop: GameShop, objectId: string): string =>
  `id:${shop}:${objectId}`;

export const titleCacheKey = (title: string): string =>
  `title:${normalizeExophaseTitle(title)}`;

/** The full set of LevelDB keys an entry should be written under. */
export const entryKeys = (entry: ExophaseCacheEntry): string[] => {
  const keys = [titleCacheKey(entry.normalizedTitle || entry.title)];
  if (entry.objectId) keys.unshift(idCacheKey(entry.shop, entry.objectId));
  return keys;
};

export const toDefinitions = (
  achievements: ExophaseAchievement[]
): SteamAchievement[] =>
  achievements.map((a) => ({
    name: a.apiName,
    displayName: a.displayName,
    description: a.description,
    icon: a.iconUrl,
    icongray: a.iconUrl,
    hidden: false,
    points: a.points ?? undefined,
  }));

export const getPrefs = (): Promise<UserPreferences | null> =>
  db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);

export const isManagedShop = (
  shop: GameShop,
  prefs: UserPreferences | null
): boolean => {
  if (!SHOP_TO_EXOPHASE_SLUG[shop]) return false;
  const managed = prefs?.exophaseManagedPlatforms ?? DEFAULT_MANAGED_SHOPS;
  return managed.includes(shop);
};

/** Looks up the cache for a library game: by canonical id first (when the game
 *  is a real catalogue entry), then by title (covers custom games). */
export const lookupCacheEntry = async (
  game: Game
): Promise<ExophaseCacheEntry | null> => {
  if (game.shop && game.objectId) {
    const byId = await exophaseCacheSublevel
      .get(idCacheKey(game.shop, game.objectId))
      .catch(() => null);
    if (byId) return byId;
  }
  return exophaseCacheSublevel
    .get(titleCacheKey(game.title))
    .then((v) => v ?? null)
    .catch(() => null);
};

export const putCacheEntry = async (
  entry: ExophaseCacheEntry
): Promise<void> => {
  for (const key of entryKeys(entry)) {
    await exophaseCacheSublevel.put(key, entry).catch(() => {});
  }
};

const mergeUnlocked = (
  ...lists: UnlockedAchievement[][]
): UnlockedAchievement[] => {
  const byName = new Map<string, UnlockedAchievement>();
  for (const list of lists) {
    for (const a of list) {
      const key = (a.name ?? "").toUpperCase();
      const existing = byName.get(key);
      if (!existing || a.unlockTime < existing.unlockTime) byName.set(key, a);
    }
  }
  return [...byName.values()];
};

/** Normalises a display name for fuzzy matching across Exophase/HydraAPI. */
const normalizeDisplayName = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Applies cached achievement definitions onto a single library game WITHOUT any
 * network call. When HydraAPI definitions already exist for the game they are
 * PRESERVED — Exophase unlocked achievements are matched to them by display
 * name and the unlocked list is updated. This means the game page always shows
 * the full HydraAPI achievement set (with images) as the total and the correct
 * fraction unlocked (e.g. 43/117 not 43/43).
 *
 * When no HydraAPI definitions exist yet, Exophase definitions are used as a
 * fallback so the game page still shows something. Returns true when the cache
 * had an entry and an update was written.
 */
export const applyCachedAchievements = async (
  gameKey: string,
  game: Game
): Promise<boolean> => {
  // Safety guard: never create a new library entry.
  const existingGame = await gamesSublevel.get(gameKey).catch(() => null);
  if (!existingGame || existingGame.isDeleted) return false;

  const entry = await lookupCacheEntry(game);
  if (!entry || entry.definitions.length === 0) return false;

  const existing = await gameAchievementsSublevel
    .get(gameKey)
    .catch(() => null);

  // Determine whether we have HydraAPI definitions to preserve. We consider
  // data "from HydraAPI" when its source is absent or not "exophase" and it
  // has a non-empty achievement list.
  const hydraDefinitions =
    existing?.source !== "exophase" && existing?.achievements?.length
      ? existing.achievements
      : null;

  let finalDefinitions: SteamAchievement[];
  let finalUnlocked: UnlockedAchievement[];
  let finalSource: "exophase" | undefined;

  if (hydraDefinitions) {
    // ── HydraAPI definitions exist: match Exophase unlocks by display name ──
    // Leave source undefined so the game-data fetcher knows these are HydraAPI
    // definitions (with images) and doesn't short-circuit back to Exophase data.
    finalDefinitions = hydraDefinitions;
    finalSource = undefined;

    // Build a map: normalized displayName → HydraAPI apiName
    const hydraByDisplay = new Map<string, string>(
      hydraDefinitions.map((a) => [
        normalizeDisplayName(a.displayName ?? a.name ?? ""),
        a.name ?? "",
      ])
    );

    // Build a map: Exophase apiName → display name (from entry.definitions)
    const exophaseDisplay = new Map<string, string>(
      entry.definitions.map((d) => [
        d.name ?? "",
        d.displayName ?? d.name ?? "",
      ])
    );

    // Convert Exophase unlocked list to HydraAPI apiNames via display name.
    const exophaseUnlocked: UnlockedAchievement[] = [];
    for (const u of entry.unlocked ?? []) {
      const display = exophaseDisplay.get(u.name ?? "") ?? u.name ?? "";
      const hydraName = hydraByDisplay.get(normalizeDisplayName(display));
      if (hydraName) {
        exophaseUnlocked.push({ name: hydraName, unlockTime: u.unlockTime });
      }
    }

    const validNames = new Set(
      hydraDefinitions.map((d) => (d.name ?? "").toUpperCase())
    );
    finalUnlocked = mergeUnlocked(
      existing?.unlockedAchievements ?? [],
      exophaseUnlocked
    ).filter((u) => validNames.has((u.name ?? "").toUpperCase()));
  } else {
    // ── No HydraAPI data yet: use Exophase definitions as fallback ──
    finalDefinitions = entry.definitions;
    finalSource = "exophase";

    const validNames = new Set(
      entry.definitions.map((d) => (d.name ?? "").toUpperCase())
    );
    finalUnlocked = mergeUnlocked(
      existing?.unlockedAchievements ?? [],
      entry.unlocked ?? []
    ).filter((u) => validNames.has((u.name ?? "").toUpperCase()));
  }

  await gameAchievementsSublevel.put(gameKey, {
    achievements: finalDefinitions,
    unlockedAchievements: finalUnlocked,
    updatedAt: existing?.updatedAt ?? Date.now(),
    language: existing?.language ?? "en",
    source: finalSource,
  });

  await gamesSublevel.put(gameKey, {
    ...game,
    achievementCount: finalDefinitions.length,
    unlockedAchievementCount: finalUnlocked.length,
  });

  WindowManager.mainWindow?.webContents.send(
    `on-update-achievements-${game.objectId}-${game.shop}`,
    finalUnlocked
  );
  return true;
};

/**
 * Fast, network-free pass over the whole library: for every managed game that
 * has no Exophase achievements yet, apply definitions straight from the cache.
 * Called right after a library sync / scan / repack so newly-added games light
 * up their achievement list instantly. Returns how many games were filled.
 */
let applyingCache = false;

export const applyCacheToLibrary = async (): Promise<number> => {
  if (applyingCache) return 0;
  const prefs = await getPrefs();
  if (prefs?.exophaseEnabled === false) return 0;

  applyingCache = true;
  let applied = 0;
  try {
    for await (const [key, game] of gamesSublevel.iterator()) {
      if (!game || game.isDeleted) continue;
      if (!isManagedShop(game.shop, prefs)) continue;

      const existing = await gameAchievementsSublevel
        .get(key)
        .catch(() => null);
      // Already has Exophase data — leave it (the background sync owns updates).
      if (existing?.source === "exophase" && existing.achievements?.length) {
        continue;
      }

      if (await applyCachedAchievements(key, game)) applied++;
    }

    if (applied > 0) {
      WindowManager.sendToAppWindows("on-library-batch-complete");
      achievementsLogger.log(
        `[Exophase cache] applied cached definitions to ${applied} game(s)`
      );
    }
    return applied;
  } finally {
    applyingCache = false;
  }
};

/** Download the shared cache blob from R2 and merge it in (newest wins). */
export const pullSharedCache = async (): Promise<number> => {
  const raw = await R2Sync.downloadSharedJson(SHARED_CACHE_BLOB).catch(
    () => null
  );
  if (!raw) return 0;

  let entries: ExophaseCacheEntry[];
  try {
    entries = JSON.parse(raw);
  } catch {
    return 0;
  }
  if (!Array.isArray(entries)) return 0;

  let merged = 0;
  for (const entry of entries) {
    if (!entry?.shop || !entry.definitions) continue;
    let wrote = false;
    for (const key of entryKeys(entry)) {
      const local = await exophaseCacheSublevel.get(key).catch(() => null);
      if (!local || (entry.updatedAt ?? 0) > (local.updatedAt ?? 0)) {
        await exophaseCacheSublevel.put(key, entry).catch(() => {});
        wrote = true;
      }
    }
    if (wrote) merged++;
  }

  await db
    .put(levelKeys.exophaseCacheSyncedAt, Date.now(), { valueEncoding: "json" })
    .catch(() => {});
  achievementsLogger.log(
    `[Exophase cache] pulled shared cache: ${entries.length} entries, ${merged} newer`
  );
  return merged;
};

/** Upload the full local cache as the shared blob (last writer extends it). */
export const pushSharedCache = async (): Promise<void> => {
  // Each logical entry is stored under both an id key and a title key; dedupe
  // by logical identity so the shared blob doesn't accumulate duplicates.
  const byLogical = new Map<string, ExophaseCacheEntry>();
  for await (const [, entry] of exophaseCacheSublevel.iterator()) {
    if (!entry) continue;
    const logical = entry.objectId
      ? idCacheKey(entry.shop, entry.objectId)
      : titleCacheKey(entry.normalizedTitle || entry.title);
    const existing = byLogical.get(logical);
    if (!existing || (entry.updatedAt ?? 0) >= (existing.updatedAt ?? 0)) {
      byLogical.set(logical, entry);
    }
  }
  const entries = [...byLogical.values()];
  if (entries.length === 0) return;
  await R2Sync.uploadSharedJson(
    SHARED_CACHE_BLOB,
    JSON.stringify(entries)
  ).catch((err) =>
    achievementsLogger.warn("[Exophase cache] push failed", err)
  );
};
