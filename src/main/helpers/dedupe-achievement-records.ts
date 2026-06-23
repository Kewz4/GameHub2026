import {
  gamesSublevel,
  gamesShopAssetsSublevel,
  gameAchievementsSublevel,
  exophaseCacheSublevel,
} from "@main/level";
import { idCacheKey } from "@main/services/achievements/exophase/exophase-cache";
import { logger } from "@main/services/logger";
import type { GameShop, UnlockedAchievement } from "@types";
import { normalizeGameTitle } from "./normalize-game-title";

interface AchievementRecordInfo {
  key: string;
  title: string | null;
  unlockedCount: number;
  inActiveLibrary: boolean;
  unlocked: UnlockedAchievement[];
}

function unlockedNameSet(
  defs: { name?: string | null }[] | undefined,
  unlocked: { name?: string | null }[] | undefined
): Set<string> {
  const validNames = new Set((defs ?? []).map((a) => (a.name ?? "").toUpperCase()));
  const out = new Set<string>();
  for (const u of unlocked ?? []) {
    const name = (u.name ?? "").toUpperCase();
    if (validNames.has(name)) out.add(name);
  }
  return out;
}

/**
 * Collapse duplicate achievement records that belong to the same game stored
 * under different keys (e.g. a Steam entry and an Exophase/Xbox import of the
 * same title). This runs independently of the game-record dedup so it also
 * cleans up leftovers from merges that happened on older app versions — where
 * the duplicate game was already soft-deleted but its achievement record was
 * never removed and still surfaces in the profile breakdown.
 *
 * For each group of same-title records it keeps the survivor (most unlocked
 * achievements, preferring an active in-library entry), folds the others'
 * unlocked achievements into it, and deletes the duplicates.
 *
 * Returns the number of duplicate achievement records removed.
 */
export async function dedupeAchievementRecordsByTitle(): Promise<number> {
  const entries = await gameAchievementsSublevel.iterator().all();
  const records: AchievementRecordInfo[] = [];

  for (const [key, achievements] of entries) {
    const sep = key.indexOf(":");
    const keyShop = (sep >= 0 ? key.slice(0, sep) : key) as GameShop;
    const keyObjectId = sep >= 0 ? key.slice(sep + 1) : "";

    const game = await gamesSublevel.get(key).catch(() => null);
    const assets = await gamesShopAssetsSublevel.get(key).catch(() => null);
    const exo =
      !game?.title && !assets?.title
        ? await exophaseCacheSublevel
            .get(idCacheKey(keyShop, keyObjectId))
            .catch(() => null)
        : null;

    const title = game?.title ?? assets?.title ?? exo?.title ?? null;

    records.push({
      key,
      title,
      unlockedCount: unlockedNameSet(
        achievements?.achievements,
        achievements?.unlockedAchievements
      ).size,
      inActiveLibrary: Boolean(game) && !game?.isDeleted,
      unlocked: achievements?.unlockedAchievements ?? [],
    });
  }

  // Group by normalized title. Records without a resolvable title are left
  // untouched — we can't safely tell them apart.
  const byTitle = new Map<string, AchievementRecordInfo[]>();
  for (const record of records) {
    if (!record.title) continue;
    const norm = normalizeGameTitle(record.title);
    if (!norm) continue;
    const bucket = byTitle.get(norm) ?? [];
    bucket.push(record);
    byTitle.set(norm, bucket);
  }

  let removed = 0;

  for (const bucket of byTitle.values()) {
    if (bucket.length <= 1) continue;

    // Survivor: most unlocked, then prefer an active in-library entry.
    bucket.sort((a, b) => {
      if (b.unlockedCount !== a.unlockedCount) {
        return b.unlockedCount - a.unlockedCount;
      }
      if (a.inActiveLibrary !== b.inActiveLibrary) {
        return a.inActiveLibrary ? -1 : 1;
      }
      return 0;
    });

    const [survivor, ...duplicates] = bucket;

    const survivorRecord = await gameAchievementsSublevel
      .get(survivor.key)
      .catch(() => null);
    if (!survivorRecord) continue;

    // Union all unlocked achievements into the survivor (earliest unlockTime).
    const byName = new Map<string, UnlockedAchievement>();
    const allUnlocked = [
      ...(survivorRecord.unlockedAchievements ?? []),
      ...duplicates.flatMap((d) => d.unlocked),
    ];
    for (const a of allUnlocked) {
      const name = (a.name ?? "").toUpperCase();
      const prev = byName.get(name);
      if (!prev || (a.unlockTime ?? 0) < (prev.unlockTime ?? 0)) {
        byName.set(name, a);
      }
    }

    await gameAchievementsSublevel.put(survivor.key, {
      ...survivorRecord,
      unlockedAchievements: [...byName.values()],
      updatedAt: Date.now(),
    });

    for (const duplicate of duplicates) {
      await gameAchievementsSublevel.del(duplicate.key).catch(() => {});
      removed++;
      logger.log(
        `dedupeAchievementRecords: removed duplicate achievement record [${duplicate.key}] → kept [${survivor.key}]`
      );
    }
  }

  return removed;
}
