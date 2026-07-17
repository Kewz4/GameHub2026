import { db } from "../level";
import { normalizeRomTitle } from "@main/services/emulators/parse-rom-filename";
import type { ConsoleGameMetadata, EmulatorSystem } from "@types";

/**
 * Pre-generated metadata for a console/emulated game, sourced from the hosted
 * `sources/gamehub-meta/<system>.json` dataset (SteamGridDB art + IGDB info).
 * Stored locally so console games render rich cards without live API calls.
 */
export interface GameHubMetaEntry {
  title: string;
  description: string | null;
  genres: string[];
  releaseYear: number | null;
  coverImageUrl: string | null;
  libraryImageUrl: string | null;
  libraryHeroImageUrl: string | null;
  logoImageUrl: string | null;
  /** Square game icon (SteamGridDB). Optional: absent in pre-icon datasets. */
  iconUrl?: string | null;
  /** Screenshots for the game gallery (RAWG). */
  screenshots?: string[];
  /** Trailer/video URLs (RAWG). */
  videos?: string[];
  /** Developer names (RAWG / IGDB). */
  developers?: string[];
  /** Publisher names (RAWG / IGDB). */
  publishers?: string[];
  /**
   * Extended IGDB metadata (scores, players, languages, series, box art) for
   * the details page. Cached here after the first live lookup. `undefined`
   * means "never fetched"; a value (even with empty fields) means "fetched".
   */
  extraMetadata?: ConsoleGameMetadata;
  /**
   * Schema version of `extraMetadata`. Bumped when the IGDB query/normalization
   * changes so stale caches (e.g. fetched before series/collections support)
   * are transparently re-fetched instead of served forever.
   */
  extraMetadataVersion?: number;
}

export const gamehubMetaSublevel = db.sublevel<string, GameHubMetaEntry>(
  "gamehubMeta",
  { valueEncoding: "json" }
);

/** Key under which a game's metadata is stored: `${system}:${normalizedTitle}`. */
export function gamehubMetaKey(
  system: EmulatorSystem,
  normalizedTitle: string
): string {
  return `${system}:${normalizedTitle}`;
}

/** Same article-insensitive normalization the minerva catalogue uses. */
export const normalizeMetaTitle = normalizeRomTitle;

/** Look up metadata for a single game by system + (raw) title. */
export async function getGameHubMeta(
  system: EmulatorSystem,
  title: string
): Promise<GameHubMetaEntry | null> {
  const key = gamehubMetaKey(system, normalizeMetaTitle(title));
  const entry = await gamehubMetaSublevel.get(key).catch(() => null);
  return entry ?? null;
}
