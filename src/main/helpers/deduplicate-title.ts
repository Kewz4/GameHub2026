/**
 * Ensures there is exactly one library entry for a given game title.
 *
 * Canonical priority (highest wins):
 *
 *   TIER 1 — Hydra catalogue entries (any shop with a known catalogue objectId):
 *     steam   → score 20  (richest metadata: hero images, achievements, stats)
 *     epic    → score 18
 *     gog     → score 18
 *     xbox    → score 18
 *     battlenet → score 16
 *
 *   TIER 2 — Custom entries (no catalogue match, local exe only):
 *     custom  → score 1
 *
 *   Within the same score, the earliest addedToLibraryAt wins as a tiebreaker.
 *
 * The surviving entry inherits executablePath / launchOptions from any
 * duplicate that has one, so the user never loses their exe path.
 * All other duplicates are soft-deleted (isDeleted: true).
 *
 * Returns the key of the surviving (canonical) entry.
 */

import { gamesSublevel, gameAchievementsSublevel } from "@main/level";
import { logger } from "@main/services";
import type { Game, UnlockedAchievement } from "@types";
import { normalizeGameTitle } from "./normalize-game-title";

/**
 * Fold a soft-deleted duplicate's achievement progress into the surviving
 * entry, then drop the duplicate's achievement record. Without this, the
 * profile achievement breakdown (which reads gameAchievementsSublevel directly)
 * keeps showing the duplicate as its own row even after the game record itself
 * is soft-deleted.
 */
async function mergeAchievementsIntoCanonical(
  canonicalKey: string,
  duplicateKey: string
): Promise<void> {
  const [canonical, duplicate] = await Promise.all([
    gameAchievementsSublevel.get(canonicalKey).catch(() => null),
    gameAchievementsSublevel.get(duplicateKey).catch(() => null),
  ]);

  // Nothing to fold in — just make sure the duplicate row is gone.
  if (!duplicate) return;

  const dupUnlocked = duplicate.unlockedAchievements ?? [];

  if (canonical) {
    // Union the unlocked achievements by name, keeping the earliest unlockTime.
    const byName = new Map<string, UnlockedAchievement>();
    for (const a of [
      ...(canonical.unlockedAchievements ?? []),
      ...dupUnlocked,
    ]) {
      const key = (a.name ?? "").toUpperCase();
      const prev = byName.get(key);
      if (!prev || (a.unlockTime ?? 0) < (prev.unlockTime ?? 0)) {
        byName.set(key, a);
      }
    }

    await gameAchievementsSublevel.put(canonicalKey, {
      ...canonical,
      unlockedAchievements: [...byName.values()],
      updatedAt: Date.now(),
    });
  }
  // If the canonical has no achievement record at all, we intentionally do NOT
  // copy the duplicate's definitions over (they belong to the duplicate's
  // shop/objectId and may not match). The breakdown will fall back to the
  // library record's achievementCount for the survivor.

  await gameAchievementsSublevel.del(duplicateKey).catch(() => {});
}

function canonicalScore(shop: Game["shop"]): number {
  switch (shop) {
    case "steam":
      return 20; // Catalogue, richest Hydra API assets
    case "epic":
      return 18; // Catalogue
    case "gog":
      return 18; // Catalogue
    case "xbox":
      return 18; // Catalogue
    case "battlenet":
      return 16; // Catalogue (partial)
    default:
      return 1; // custom — no catalogue match
  }
}

export async function deduplicateTitle(title: string): Promise<string | null> {
  const normalized = normalizeGameTitle(title);
  const matches: [string, Game][] = [];

  for await (const [key, game] of gamesSublevel.iterator()) {
    if (!game.isDeleted && normalizeGameTitle(game.title) === normalized) {
      matches.push([key, game]);
    }
  }

  if (matches.length <= 1) return matches[0]?.[0] ?? null;

  // Sort: highest score first, then earliest added
  matches.sort(([, a], [, b]) => {
    const scoreDiff = canonicalScore(b.shop) - canonicalScore(a.shop);
    if (scoreDiff !== 0) return scoreDiff;
    const aTime = a.addedToLibraryAt
      ? new Date(a.addedToLibraryAt).getTime()
      : 0;
    const bTime = b.addedToLibraryAt
      ? new Date(b.addedToLibraryAt).getTime()
      : 0;
    return aTime - bTime; // earlier = lower number = preferred
  });

  const [canonicalKey, canonicalGame] = matches[0];
  const duplicates = matches.slice(1);

  // Collect the best executablePath and launchOptions from all duplicates
  let bestExePath = canonicalGame.executablePath ?? null;
  let bestLaunchOptions = canonicalGame.launchOptions ?? null;
  for (const [, dup] of duplicates) {
    if (!bestExePath && dup.executablePath) bestExePath = dup.executablePath;
    if (!bestLaunchOptions && dup.launchOptions)
      bestLaunchOptions = dup.launchOptions;
  }

  // Update canonical with merged executable if it lacked one
  if (
    bestExePath !== canonicalGame.executablePath ||
    bestLaunchOptions !== canonicalGame.launchOptions
  ) {
    await gamesSublevel.put(canonicalKey, {
      ...canonicalGame,
      executablePath: bestExePath,
      launchOptions: bestLaunchOptions,
    });
  }

  // Collect alternativeShops from duplicates to merge into canonical
  const canonicalAlts = [...(canonicalGame.alternativeShops ?? [])];

  // Soft-delete all duplicates, folding their shop info into canonical's alternativeShops
  for (const [dupKey, dupGame] of duplicates) {
    // Add the duplicate's own shop as an alternativeShop on the canonical entry
    // (so "Download via GOG" / "Download via Epic" options are preserved)
    const alreadyLinked = canonicalAlts.some(
      (a) => a.shop === dupGame.shop && a.objectId === dupGame.objectId
    );
    if (!alreadyLinked && dupGame.shop !== "custom") {
      canonicalAlts.push({
        shop: dupGame.shop,
        objectId: dupGame.objectId,
        executablePath: dupGame.executablePath ?? null,
      });
    }
    // Also carry over any alternativeShops that the duplicate itself had
    for (const alt of dupGame.alternativeShops ?? []) {
      const altAlreadyLinked = canonicalAlts.some(
        (a) => a.shop === alt.shop && a.objectId === alt.objectId
      );
      if (!altAlreadyLinked) {
        canonicalAlts.push(alt);
      }
    }

    await gamesSublevel.put(dupKey, { ...dupGame, isDeleted: true });
    // Fold the duplicate's achievement progress into the survivor and remove
    // its standalone achievement record so it stops appearing in the profile
    // achievements breakdown.
    await mergeAchievementsIntoCanonical(canonicalKey, dupKey).catch((err) =>
      logger.warn(
        `deduplicateTitle: failed to merge achievements for [${dupKey}]`,
        err
      )
    );
    logger.log(
      `deduplicateTitle: soft-deleted duplicate "${dupGame.title}" [${dupKey}] → kept [${canonicalKey}]`
    );
  }

  // Persist merged alternativeShops back onto the canonical entry
  if (canonicalAlts.length !== (canonicalGame.alternativeShops?.length ?? 0)) {
    await gamesSublevel.put(canonicalKey, {
      ...canonicalGame,
      executablePath: bestExePath,
      launchOptions: bestLaunchOptions,
      alternativeShops: canonicalAlts,
    });
  }

  return canonicalKey;
}
