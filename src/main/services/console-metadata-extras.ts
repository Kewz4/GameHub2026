import type { GameHubMetaEntry } from "@main/level/sublevels/gamehub-meta";

type HostedConsoleMetadataEntry = Pick<
  GameHubMetaEntry,
  "ageRating" | "boxImageUrl" | "hltb" | "ratingScore"
>;

function mergeHltb(
  stored: GameHubMetaEntry["hltb"],
  bundled: GameHubMetaEntry["hltb"]
) {
  if (!stored && !bundled) return null;

  const merged = {
    main: stored?.main ?? bundled?.main ?? null,
    mainExtra: stored?.mainExtra ?? bundled?.mainExtra ?? null,
    completionist: stored?.completionist ?? bundled?.completionist ?? null,
  };

  return Object.values(merged).some((value) => value !== null) ? merged : null;
}

function mergeAgeRating(
  stored: GameHubMetaEntry["ageRating"],
  bundled: GameHubMetaEntry["ageRating"]
) {
  if (!stored && !bundled) return null;

  const name = stored?.name?.trim() || bundled?.name?.trim() || "";
  if (!name) return null;

  return {
    name,
    system: stored?.system ?? bundled?.system ?? null,
  };
}

/**
 * Merge hosted fields one by one. Persisted metadata can come from an older
 * dataset or a partial IGDB write, so selecting the cached object wholesale
 * must never hide richer values shipped in the current bundled dataset.
 */
export function mergeHostedConsoleMetadataExtras(
  stored: HostedConsoleMetadataEntry | null | undefined,
  bundled: HostedConsoleMetadataEntry | null | undefined
) {
  return {
    ratingScore: stored?.ratingScore ?? bundled?.ratingScore ?? null,
    hltb: mergeHltb(stored?.hltb, bundled?.hltb),
    ageRating: mergeAgeRating(stored?.ageRating, bundled?.ageRating),
    boxImageUrl: stored?.boxImageUrl ?? bundled?.boxImageUrl ?? null,
  };
}

/**
 * Hosted console metadata is sufficient to render the game page immediately.
 * IGDB may still enrich it in the background, but a slow network lookup must
 * never hold a locally imported emulator game's hero behind a loading shell.
 */
export function hasHostedConsoleMetadataExtras(
  extras: ReturnType<typeof mergeHostedConsoleMetadataExtras>
) {
  return (
    extras.ratingScore !== null ||
    extras.hltb !== null ||
    extras.ageRating !== null ||
    extras.boxImageUrl !== null
  );
}

/**
 * The generated GameHub metadata score is console-specific. Prefer it over
 * IGDB's cross-platform aggregate, falling back to IGDB only when the hosted
 * dataset has no review score for this title.
 */
export function resolveConsoleMetadataCriticScore(
  hostedScore: number | null | undefined,
  igdbScore: number | null | undefined
) {
  return hostedScore ?? igdbScore ?? null;
}
