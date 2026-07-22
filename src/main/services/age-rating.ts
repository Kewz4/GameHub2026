import { db } from "@main/level";
import { getGameHubMeta } from "@main/level/sublevels/gamehub-meta";
import { getSteamAppDetails } from "./steam";
import type { EmulatorSystem, GameShop } from "@types";

interface MaturityVerdict {
  mature: boolean;
  at: number;
}

/**
 * Persistent per-game maturity verdict cache (`${shop}:${objectId}` → verdict).
 * Verdicts are tiny booleans, so once a Steam game's rating has been fetched it
 * is never fetched again — the "hide mature" filter is instant on later loads.
 */
const maturityCacheSublevel = db.sublevel<string, MaturityVerdict>(
  "ageRatingMaturity",
  { valueEncoding: "json" }
);

export interface MaturityQuery {
  shop: GameShop;
  objectId: string;
  title: string;
}

/** How many Steam appdetails lookups to run at once when resolving. */
const RESOLVE_CONCURRENCY = 8;

/** ESRB M/AO, PEGI/USK 18, a 17+ age gate, or an "adult/mature" label → mature. */
function isMatureRating(name?: string | null, system?: string | null): boolean {
  if (!name) return false;
  const n = String(name).toUpperCase().trim();
  const s = String(system ?? "").toUpperCase();
  if (s.includes("ESRB")) return n === "M" || n === "AO";
  if (s.includes("PEGI")) return parseInt(n, 10) >= 18;
  if (s.includes("USK")) return parseInt(n, 10) >= 18;
  // Unknown agency: fall back to a conservative heuristic on the label itself.
  return (
    n === "M" ||
    n === "AO" ||
    /(^|\D)(17|18)(\+|\b)/.test(n) ||
    n.includes("ADULT") ||
    n.includes("MATURE")
  );
}

/** Read a Steam appdetails blob's per-agency ratings for a maturity verdict. */
function steamDetailsMature(details: {
  required_age?: number | string;
  ratings?: Record<string, { rating?: string }>;
  content_descriptors?: { ids?: number[] };
}): boolean {
  const ratings = details.ratings ?? {};
  const esrb = ratings.esrb?.rating?.toLowerCase();
  if (esrb === "m" || esrb === "ao") return true;
  const pegi = parseInt(ratings.pegi?.rating ?? "", 10);
  if (Number.isFinite(pegi) && pegi >= 18) return true;
  const usk = parseInt(ratings.usk?.rating ?? "", 10);
  if (Number.isFinite(usk) && usk >= 18) return true;
  const age = Number(details.required_age);
  if (Number.isFinite(age) && age >= 17) return true;
  // Steam content-descriptor ids 3/4 flag adult sexual content.
  const ids = details.content_descriptors?.ids ?? [];
  return ids.includes(3) || ids.includes(4);
}

/** Parse the EmulatorSystem out of a `minerva:<system>:<title>` objectId. */
function minervaSystem(objectId: string): EmulatorSystem | null {
  if (!objectId.startsWith("minerva:")) return null;
  return (objectId.split(":")[1] as EmulatorSystem) || null;
}

/**
 * Decide which games should be HIDDEN under the "hide mature" filter.
 *
 * - Console/launchbox: classified from the local dataset's age rating. An
 *   explicit mature rating hides it; an absent/unknown rating SHOWS it (dataset
 *   coverage is partial, so hiding every unrated console game would gut the
 *   classics rows).
 * - Steam: fail-closed. A cached verdict decides immediately; an uncached game
 *   is HIDDEN until `resolve` fetches (and caches) its rating from Steam, so a
 *   mature game never flashes on screen before it has been classified.
 * - Other shops don't appear on the home catalogue rows, so they're shown.
 *
 * Returns the set of `${shop}:${objectId}` keys to hide.
 */
export async function resolveHiddenMatureGames(
  games: MaturityQuery[],
  resolve: boolean
): Promise<string[]> {
  const hidden: string[] = [];

  const decide = async (game: MaturityQuery): Promise<void> => {
    const key = `${game.shop}:${game.objectId}`;

    if (game.shop === "launchbox") {
      const system = minervaSystem(game.objectId);
      if (!system) return; // can't classify → show
      const meta = await getGameHubMeta(system, game.title).catch(() => null);
      if (
        meta?.ageRating &&
        isMatureRating(meta.ageRating.name, meta.ageRating.system)
      ) {
        hidden.push(key);
      }
      return;
    }

    if (game.shop === "steam") {
      const cached = await maturityCacheSublevel.get(key).catch(() => null);
      if (cached) {
        if (cached.mature) hidden.push(key);
        return;
      }
      if (!resolve) {
        hidden.push(key); // fail-closed: hide until classified
        return;
      }
      const details = await getSteamAppDetails(game.objectId, "en").catch(
        () => null
      );
      if (!details) {
        // Couldn't determine — keep it hidden (fail-closed) but DON'T cache a
        // guess, so a later resolve can retry.
        hidden.push(key);
        return;
      }
      const mature = steamDetailsMature(details);
      await maturityCacheSublevel
        .put(key, { mature, at: Date.now() })
        .catch(() => {});
      if (mature) hidden.push(key);
      return;
    }
  };

  // Bounded-concurrency pool — Steam fetches dominate the cost when resolving.
  let cursor = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(RESOLVE_CONCURRENCY, games.length) },
      async () => {
        while (cursor < games.length) await decide(games[cursor++]);
      }
    )
  );
  return hidden;
}
