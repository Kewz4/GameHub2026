import { db } from "../level";
import type { EmulatorSystem } from "@types";

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

/** Same normalization the minerva catalogue and generator use. */
export function normalizeMetaTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Look up metadata for a single game by system + (raw) title. */
export async function getGameHubMeta(
  system: EmulatorSystem,
  title: string
): Promise<GameHubMetaEntry | null> {
  const key = gamehubMetaKey(system, normalizeMetaTitle(title));
  const entry = await gamehubMetaSublevel.get(key).catch(() => null);
  return entry ?? null;
}
