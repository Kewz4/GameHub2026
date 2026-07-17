import type { ConsoleGameMetadata, EmulatorSystem } from "@types";
import {
  gamehubMetaSublevel,
  gamehubMetaKey,
  normalizeMetaTitle,
} from "@main/level/sublevels/gamehub-meta";
import { igdb, IGDB_PLATFORM_IDS, extractConsoleMetadata } from "./igdb";
import { logger } from "./logger";

/**
 * Same title normalization the IGDB metadata fetch uses in
 * get-game-shop-details: drop articles, collapse " - subtitle", strip
 * parenthetical/region noise, so display titles resolve on IGDB.
 */
const igdbQueryTitle = (title: string): string =>
  title
    .replace(/,\s*(the|a|an)\b/gi, "")
    .replace(/^(the|a|an)\s+/i, "")
    .replace(/\s+-\s+/g, " ")
    .replace(/\([^)]*\)|\[[^\]]*\]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

const inMemory = new Map<string, ConsoleGameMetadata | null>();

/**
 * Resolve the extended console metadata (scores, players, languages, series,
 * box art) for a title, IGDB-backed and cached. Returns null when IGDB has no
 * match or the lookup fails — the UI simply omits the sections, exactly like a
 * game with no data. Cached both in-memory and in the gamehub-meta sublevel so
 * repeat visits are instant and survive restarts.
 */
export async function getConsoleGameMetadata(
  title: string,
  system: EmulatorSystem | ""
): Promise<ConsoleGameMetadata | null> {
  if (!title) return null;

  const key = `${system}:${normalizeMetaTitle(title)}`;
  if (inMemory.has(key)) return inMemory.get(key) ?? null;

  // Persistent cache: a stored `extraMetadata` (even with empty fields) means
  // we already looked this up and shouldn't hit IGDB again.
  const metaKey = system
    ? gamehubMetaKey(system as EmulatorSystem, normalizeMetaTitle(title))
    : null;
  if (metaKey) {
    const existing = await gamehubMetaSublevel.get(metaKey).catch(() => null);
    if (existing?.extraMetadata) {
      inMemory.set(key, existing.extraMetadata);
      return existing.extraMetadata;
    }
  }

  try {
    const platformId = system ? IGDB_PLATFORM_IDS[system as string] : undefined;
    const game = await igdb.searchGame(igdbQueryTitle(title), platformId);
    const metadata = game ? extractConsoleMetadata(game) : null;

    inMemory.set(key, metadata);

    // Persist a successful lookup back into gamehub-meta (best-effort).
    if (metadata && metaKey) {
      const existing = await gamehubMetaSublevel.get(metaKey).catch(() => null);
      await gamehubMetaSublevel
        .put(metaKey, {
          title,
          description: null,
          genres: [],
          releaseYear: null,
          coverImageUrl: null,
          libraryImageUrl: null,
          libraryHeroImageUrl: null,
          logoImageUrl: null,
          ...existing,
          extraMetadata: metadata,
        })
        .catch(() => {});
    }

    return metadata;
  } catch (err) {
    logger.log(`console-metadata: lookup failed: ${(err as Error).message}`);
    return null;
  }
}
