import type { ConsoleGameMetadata, EmulatorSystem } from "@types";
import {
  gamehubMetaSublevel,
  gamehubMetaKey,
  normalizeMetaTitle,
} from "@main/level/sublevels/gamehub-meta";
import { igdb, IGDB_PLATFORM_IDS, extractConsoleMetadata } from "./igdb";
import { logger } from "./logger";
import { getBundledGameHubMeta } from "./rom-sources/gamehub-meta-sources";
import {
  hasHostedConsoleMetadataExtras,
  mergeHostedConsoleMetadataExtras,
  resolveConsoleMetadataCriticScore,
} from "./console-metadata-extras";

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

// Bump when the IGDB query or `extractConsoleMetadata` changes so persisted
// caches from an older schema are re-fetched. v2: added collections/franchise
// fallbacks for the "more from series" section.
const METADATA_SCHEMA_VERSION = 2;

/** All-empty metadata, used to carry HLTB playtimes for a game that has no IGDB
 *  match (so the "How long to beat" panel still renders). */
const EMPTY_CONSOLE_METADATA: ConsoleGameMetadata = {
  criticScore: null,
  userScore: null,
  ratingCount: null,
  gameModes: [],
  maxLocalPlayers: null,
  languages: [],
  series: null,
  boxArtUrls: [],
};

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
  const storedEntry = metaKey
    ? await gamehubMetaSublevel.get(metaKey).catch(() => null)
    : null;
  const bundledEntry = system
    ? getBundledGameHubMeta(system as EmulatorSystem, title)
    : null;
  const entry = storedEntry ?? bundledEntry;
  const hostedExtras = mergeHostedConsoleMetadataExtras(
    storedEntry,
    bundledEntry
  );

  // HLTB playtimes, the age rating and the LaunchBox box render come from the
  // hosted dataset (populated independently of the IGDB `extraMetadata` cache),
  // so they're merged onto the result at read-time rather than baked into the
  // cached IGDB blob — that way fields added to a later dataset show up without
  // invalidating a good cache.
  const { hltb, ageRating, boxImageUrl } = hostedExtras;
  const withExtras = (
    m: ConsoleGameMetadata | null
  ): ConsoleGameMetadata | null => {
    const hostedCriticScore = hostedExtras.ratingScore;
    if (m)
      return {
        ...m,
        criticScore: resolveConsoleMetadataCriticScore(
          hostedCriticScore,
          m.criticScore
        ),
        hltb,
        ageRating,
        boxImageUrl,
      };
    return hltb || ageRating || boxImageUrl || hostedCriticScore != null
      ? {
          ...EMPTY_CONSOLE_METADATA,
          criticScore: hostedCriticScore,
          hltb,
          ageRating,
          boxImageUrl,
        }
      : null;
  };

  if (
    entry?.extraMetadata &&
    entry.extraMetadataVersion === METADATA_SCHEMA_VERSION
  ) {
    const result = withExtras(entry.extraMetadata);
    inMemory.set(key, result);
    return result;
  }

  const loadIgdbMetadata = async () => {
    try {
      const platformId = system
        ? IGDB_PLATFORM_IDS[system as string]
        : undefined;
      const game = await igdb.searchGame(igdbQueryTitle(title), platformId);
      const metadata = game ? extractConsoleMetadata(game) : null;

      const result = withExtras(metadata);
      inMemory.set(key, result);

      // Persist a successful lookup back into gamehub-meta (best-effort).
      if (metadata && metaKey) {
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
            ...bundledEntry,
            ...storedEntry,
            ratingScore: hostedExtras.ratingScore ?? undefined,
            hltb: hostedExtras.hltb ?? undefined,
            ageRating: hostedExtras.ageRating ?? undefined,
            boxImageUrl: hostedExtras.boxImageUrl,
            extraMetadata: metadata,
            extraMetadataVersion: METADATA_SCHEMA_VERSION,
          })
          .catch(() => {});
      }

      return result;
    } catch (err) {
      logger.log(`console-metadata: lookup failed: ${(err as Error).message}`);
      return null;
    }
  };

  if (hasHostedConsoleMetadataExtras(hostedExtras)) {
    const hostedResult = withExtras(null);
    inMemory.set(key, hostedResult);
    void loadIgdbMetadata();
    return hostedResult;
  }

  return loadIgdbMetadata();
}
