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
import { HydraApi } from "@main/services/hydra-api";
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
 * Pushes the unlocked achievements for a game up to the user's HydraAPI cloud
 * profile so Exophase-imported unlocks are wired into the Hydra account
 * achievement system (visible on other devices / the web profile).
 *
 * Only safe to call when the unlocked apiNames are HydraAPI names (i.e. the
 * game has HydraAPI definitions and we matched Exophase unlocks onto them) —
 * raw Exophase apiNames would be rejected/ignored by the cloud which keys by
 * the canonical (Steam) apiName. Best-effort: silently no-ops when the user is
 * logged out, lacks a subscription, or the game has no remoteId.
 */
export type HydraApiSyncStatus =
  | "synced"
  | "no-match"
  | "not-eligible"
  | "logged-out"
  | "no-remote-id"
  | "failed";

export const syncUnlockedToHydraApi = async (
  game: Game,
  unlockedAchievements: UnlockedAchievement[]
): Promise<HydraApiSyncStatus> => {
  if (!HydraApi.isLoggedIn()) {
    achievementsLogger.log(
      `[Exophase→HydraAPI] skipped ${game.shop}:${game.objectId} — not logged in to Hydra`
    );
    return "logged-out";
  }
  if (unlockedAchievements.length === 0) return "no-match";

  // Platform-synced games (Steam, GOG, etc.) are not uploaded to the Hydra
  // cloud library — so they have no remoteId. Attempt to find the remoteId by
  // fetching the user's remote game list; if the game is there, we get its id.
  let remoteId = game.remoteId;
  if (!remoteId) {
    achievementsLogger.log(
      `[Exophase→HydraAPI] ${game.shop}:${game.objectId} has no remoteId — fetching from remote`
    );
    try {
      const remoteGames =
        await HydraApi.get<
          Array<{ id: string; shop: string; objectId: string }>
        >("/profile/games");
      const match = remoteGames.find(
        (g) => g.shop === game.shop && g.objectId === game.objectId
      );
      remoteId = match?.id ?? null;
    } catch {
      // Not fatal — just skip sync if we can't resolve the id.
    }
  }

  if (!remoteId) {
    achievementsLogger.log(
      `[Exophase→HydraAPI] ${game.shop}:${game.objectId} not found in remote library — skipping`
    );
    return "no-remote-id";
  }

  try {
    await HydraApi.put(
      "/profile/games/achievements",
      { id: remoteId, achievements: unlockedAchievements },
      {}
    );
    achievementsLogger.log(
      `[Exophase→HydraAPI] synced ${unlockedAchievements.length} unlocks for ${game.shop}:${game.objectId}`
    );
    return "synced";
  } catch (err) {
    // Subscription-required / network errors are non-fatal — the unlocks are
    // already persisted locally and will retry on the next sync.
    achievementsLogger.log(
      `[Exophase→HydraAPI] cloud sync failed for ${game.shop}:${game.objectId}`,
      err instanceof Error ? err.message : String(err)
    );
    return "failed";
  }
};

/**
 * Applies cached achievement definitions onto a single library game WITHOUT any
 * network call. When HydraAPI definitions already exist for the game they are
 * PRESERVED — Exophase unlocked achievements are matched to them by display
 * name and the unlocked list is updated. This means the game page always shows
 * the full HydraAPI achievement set (with images) as the total and the correct
 * fraction unlocked (e.g. 43/117 not 43/43).
 *
 * When no HydraAPI definitions exist yet, Exophase definitions are used as a
 * fallback so the game page still shows something. Returns `applied: true` when
 * the cache had an entry and an update was written, plus the outcome of the
 * HydraAPI cloud upload (for the sync report's per-game debug view).
 */
export interface ApplyCachedResult {
  applied: boolean;
  hydraApiSync?: HydraApiSyncStatus;
  hydraApiSyncedCount?: number;
}

export const applyCachedAchievements = async (
  gameKey: string,
  game: Game
): Promise<ApplyCachedResult> => {
  // Safety guard: never create a new library entry.
  const existingGame = await gamesSublevel.get(gameKey).catch(() => null);
  if (!existingGame || existingGame.isDeleted) return { applied: false };

  const entry = await lookupCacheEntry(game);
  if (!entry || entry.definitions.length === 0) return { applied: false };

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

  // ── HydraAPI definitions not yet cached locally ──
  // For Steam games, proactively fetch from HydraAPI now so the matching can
  // work even before the user has opened the game details page. This breaks the
  // chicken-and-egg where Exophase runs before the first on-demand fetch.
  let liveHydraDefinitions: SteamAchievement[] | null = null;
  if (!hydraDefinitions && game.shop === "steam" && game.objectId) {
    try {
      if (HydraApi.isLoggedIn()) {
        const language =
          existing?.language ??
          (await db
            .get<string, string>(levelKeys.language, { valueEncoding: "utf8" })
            .catch(() => "en")) ??
          "en";
        const fetched = await HydraApi.get<SteamAchievement[]>(
          `/games/steam/${game.objectId}/achievements`,
          { language }
        ).catch(() => null);
        if (fetched && fetched.length > 0) {
          liveHydraDefinitions = fetched;
          // Persist so next run uses cache and we don't re-fetch every sync.
          await gameAchievementsSublevel.put(gameKey, {
            unlockedAchievements: existing?.unlockedAchievements ?? [],
            achievements: fetched,
            updatedAt: Date.now(),
            language,
          });
        }
      }
    } catch {
      // Non-fatal: fall back to Exophase definitions below.
    }
  }

  const resolvedHydraDefinitions = liveHydraDefinitions ?? hydraDefinitions;
  let finalUnlocked: UnlockedAchievement[];
  let finalDefinitions: SteamAchievement[];
  let finalSource: "exophase" | undefined;

  if (resolvedHydraDefinitions) {
    // ── HydraAPI definitions exist: match Exophase unlocks by display name ──
    // Leave source undefined so the game-data fetcher knows these are HydraAPI
    // definitions (with images) and doesn't short-circuit back to Exophase data.
    finalDefinitions = resolvedHydraDefinitions;
    finalSource = undefined;

    // Build a map: normalized displayName → HydraAPI apiName
    const hydraByDisplay = new Map<string, string>(
      resolvedHydraDefinitions.map((a) => [
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
      resolvedHydraDefinitions.map((d) => (d.name ?? "").toUpperCase())
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

  // Wire the unlocks into the Hydra cloud account. Only when finalSource is
  // undefined do the unlocked apiNames belong to the HydraAPI definition set
  // (canonical names the cloud accepts); Exophase-fallback names are local-only.
  if (finalSource === undefined) {
    const hydraApiSync = await syncUnlockedToHydraApi(
      existingGame,
      finalUnlocked
    );
    return {
      applied: true,
      hydraApiSync,
      hydraApiSyncedCount: hydraApiSync === "synced" ? finalUnlocked.length : 0,
    };
  }

  // Exophase-fallback definitions (no HydraAPI/Steam definitions for this game,
  // e.g. EA/PSN-only) are never uploaded — they stay local.
  return { applied: true, hydraApiSync: "not-eligible" };
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

      if ((await applyCachedAchievements(key, game)).applied) applied++;
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

/**
 * For a game that is NOT in the user's library, attempts to fetch HydraAPI
 * achievement definitions and match the unlocked Exophase display names against
 * them, then syncs any matched unlocks to the HydraAPI cloud profile.
 *
 * This is the non-library equivalent of the HydraAPI matching done inside
 * `applyCachedAchievements` — it lets Exophase-imported unlocks reach the
 * cloud even when the game hasn't been added to the local library.
 *
 * Returns a `HydraApiSyncStatus` describing the outcome.
 */
export const matchAndSyncToHydraApiForNonLibraryGame = async (
  gameKey: string,
  shop: string,
  objectId: string,
  unlockedExophaseNames: string[],
  exophaseDefinitions: SteamAchievement[]
): Promise<HydraApiSyncStatus> => {
  if (!HydraApi.isLoggedIn()) return "logged-out";
  if (shop !== "steam") return "not-eligible";
  if (unlockedExophaseNames.length === 0) return "no-match";

  const normalizeDisplayName = (s: string): string =>
    s.toLowerCase().replace(/[^a-z0-9]/g, "");

  let hydraDefinitions: SteamAchievement[] | null = null;
  try {
    const language =
      (await db
        .get<string, string>(levelKeys.language, { valueEncoding: "utf8" })
        .catch(() => "en")) ?? "en";
    const fetched = await HydraApi.get<SteamAchievement[]>(
      `/games/steam/${objectId}/achievements`,
      { language }
    ).catch(() => null);
    if (fetched && fetched.length > 0) {
      hydraDefinitions = fetched;
      // Persist the definitions into the achievements sublevel so the catalogue
      // game page can display them and future syncs don't need to re-fetch.
      const existing = await gameAchievementsSublevel
        .get(gameKey)
        .catch(() => null);
      await gameAchievementsSublevel
        .put(gameKey, {
          achievements: fetched,
          unlockedAchievements: existing?.unlockedAchievements ?? [],
          updatedAt: Date.now(),
          language,
        })
        .catch(() => {});
    }
  } catch {
    // Non-fatal — fall through to "no-match".
  }

  if (!hydraDefinitions) return "no-match";

  // normalized displayName → HydraAPI apiName
  const hydraByDisplay = new Map<string, string>(
    hydraDefinitions.map((a) => [
      normalizeDisplayName(a.displayName ?? a.name ?? ""),
      a.name ?? "",
    ])
  );

  // Exophase apiName → display name (from the entry definitions)
  const exophaseDisplay = new Map<string, string>(
    exophaseDefinitions.map((d) => [
      d.name ?? "",
      d.displayName ?? d.name ?? "",
    ])
  );

  // Match unlocked Exophase names to HydraAPI canonical names.
  const matched: UnlockedAchievement[] = [];
  for (const exoName of unlockedExophaseNames) {
    const display = exophaseDisplay.get(exoName) ?? exoName;
    const hydraName = hydraByDisplay.get(normalizeDisplayName(display));
    if (hydraName) {
      matched.push({ name: hydraName, unlockTime: Date.now() });
    }
  }

  if (matched.length === 0) return "no-match";

  // Update the persisted unlocked list with the matched HydraAPI names.
  const existing = await gameAchievementsSublevel.get(gameKey).catch(() => null);
  const existingUnlocked = existing?.unlockedAchievements ?? [];
  const existingNames = new Set(
    existingUnlocked.map((u) => (u.name ?? "").toUpperCase())
  );
  const merged = [
    ...existingUnlocked,
    ...matched.filter((u) => !existingNames.has((u.name ?? "").toUpperCase())),
  ];
  await gameAchievementsSublevel
    .put(gameKey, {
      achievements: hydraDefinitions,
      unlockedAchievements: merged,
      updatedAt: Date.now(),
      language: existing?.language ?? "en",
    })
    .catch(() => {});

  // Ensure the game exists in the HydraCloud library so it has a remoteId for
  // achievement sync. Non-library games are never in /profile/games, so we
  // register them now (with zero playtime) purely for achievement tracking.
  // This does NOT add the game to the local library — it only creates a cloud
  // record so the PUT /profile/games/achievements endpoint accepts the request.
  let remoteId: string | null = null;
  try {
    const remoteGames = await HydraApi.get<
      Array<{ id: string; shop: string; objectId: string }>
    >("/profile/games");
    const existing = remoteGames.find(
      (g) => g.shop === shop && g.objectId === objectId
    );
    if (existing) {
      remoteId = existing.id;
    } else {
      const created = await HydraApi.post<{ id: string }>(
        "/profile/games",
        {
          objectId,
          playTimeInMilliseconds: 0,
          shop,
          lastTimePlayed: null,
        }
      ).catch(() => null);
      remoteId = created?.id ?? null;
    }
  } catch {
    // Non-fatal — fall through to no-remote-id.
  }

  const syntheticGame = {
    shop: shop as GameShop,
    objectId,
    remoteId,
    title: "",
    iconUrl: null,
    coverImageUrl: null,
    isDeleted: false,
    achievementCount: hydraDefinitions.length,
    unlockedAchievementCount: merged.length,
  } as unknown as Game;

  return syncUnlockedToHydraApi(syntheticGame, merged);
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

/**
 * Convert a list of unlocked achievements (which may carry Exophase apiNames
 * like `exophase_12345`) into canonical Steam apiNames the HydraAPI cloud will
 * actually credit. The cloud keys `unlockedAchievementCount` by the Steam
 * apiName schema, so pushing raw Exophase names returns 204 but never raises
 * the count. We fetch the Steam definitions for `steamObjectId`, map their
 * displayNames → apiNames, and translate each unlock by display name.
 *
 * `localDefinitions` are the definitions stored alongside the unlocks locally
 * (Exophase defs carry both the `exophase_*` name and the human displayName).
 * Returns the translated unlock list, or `null` when definitions could not be
 * fetched (caller should then fall back to the original list).
 */
export const resolveCanonicalUnlocked = async (
  steamObjectId: string,
  localDefinitions: SteamAchievement[],
  unlocked: UnlockedAchievement[],
  language = "en"
): Promise<UnlockedAchievement[] | null> => {
  if (!HydraApi.isLoggedIn() || unlocked.length === 0) return null;

  const normalizeDisplayName = (s: string): string =>
    s.toLowerCase().replace(/[^a-z0-9]/g, "");

  const fetched = await HydraApi.get<SteamAchievement[]>(
    `/games/steam/${steamObjectId}/achievements`,
    { language }
  ).catch(() => null);
  if (!fetched || fetched.length === 0) return null;

  // normalized displayName → canonical Steam apiName
  const hydraByDisplay = new Map<string, string>(
    fetched.map((a) => [
      normalizeDisplayName(a.displayName ?? a.name ?? ""),
      a.name ?? "",
    ])
  );
  // local apiName (exophase_* or canonical) → its displayName
  const localDisplay = new Map<string, string>(
    localDefinitions.map((d) => [d.name ?? "", d.displayName ?? d.name ?? ""])
  );
  // canonical apiNames already valid for this game (passthrough fast path)
  const validCanonical = new Set(
    fetched.map((a) => (a.name ?? "").toUpperCase())
  );

  const matched: UnlockedAchievement[] = [];
  const seen = new Set<string>();
  for (const u of unlocked) {
    const rawName = u.name ?? "";
    let canonical: string | undefined;

    if (validCanonical.has(rawName.toUpperCase())) {
      // Already a canonical Steam apiName.
      canonical = fetched.find(
        (a) => (a.name ?? "").toUpperCase() === rawName.toUpperCase()
      )?.name;
    } else {
      // Translate via display name (Exophase apiName → displayName → Steam).
      const display = localDisplay.get(rawName) ?? rawName;
      canonical = hydraByDisplay.get(normalizeDisplayName(display));
    }

    if (canonical && !seen.has(canonical.toUpperCase())) {
      seen.add(canonical.toUpperCase());
      matched.push({ name: canonical, unlockTime: u.unlockTime });
    }
  }

  return matched;
};
