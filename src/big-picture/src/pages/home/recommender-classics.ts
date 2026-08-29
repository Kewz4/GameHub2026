import type { CatalogueSearchResult, LibraryGame, ShopAssets } from "@types";
import { systemForGame } from "@renderer/pages/library/console-filter";
import { getAllFeedback } from "./recommendation-feedback";

/**
 * "Recommended classics" — a separate recommender for EMULATED games. The PC
 * recommender can't cover these (the console catalogue has no Steam tags), so
 * this one is built on the two signals the local catalogue does have:
 *
 *  1. SERIES: if the user has played a console game for a while (they liked it
 *     enough to sink time in), the other entries of that series are the single
 *     strongest recommendation — "you spent 20h in Ocarina of Time, try
 *     Majora's Mask / A Link to the Past". Series siblings are found by
 *     searching the catalogue for the series stem of the played title (the part
 *     before a subtitle, minus trailing numerals).
 *
 *  2. PLAY PATTERN: which consoles the user actually plays, and which genres
 *     (from the hosted GameHub metadata on catalogue entries). A sampled pool
 *     of the console catalogue is scored by system + genre overlap with the
 *     played profile, surfacing classics in the user's lanes beyond the series
 *     they already know.
 *
 * Games the user owns or thumbed-down are excluded; every result carries a
 * "why" (Because you played …) for the card's info button.
 */

const HOUR_MS = 3_600_000;
/** "played a game from the series for C amount of time" — C, in hours. */
const SERIES_MIN_HOURS = 2;
/** How many top series anchors to expand. */
const MAX_SERIES_ANCHORS = 4;
const ROW_LIMIT = 24;

/** Words that end a series stem when trailing ("Ocarina of Time 3D" cases). */
const EDITION_WORDS = new Set([
  "3d",
  "hd",
  "dx",
  "ex",
  "remastered",
  "remake",
  "deluxe",
  "edition",
  "collection",
  "trilogy",
  "returns",
  "advance",
  "ds",
]);

const ROMAN = /^[ivxl]+$/i;

const normalize = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Local classics searches are relevance ordered, so their first result is not
 * necessarily the queried game. Resolve the anchor by identity or exact
 * normalized title before learning genres from it.
 */
export function selectClassicsCatalogueResultForGame(
  game: Pick<LibraryGame, "shop" | "objectId" | "title">,
  results: readonly CatalogueSearchResult[]
): CatalogueSearchResult | null {
  const identityMatch = results.find(
    (result) => result.shop === game.shop && result.objectId === game.objectId
  );
  if (identityMatch) return identityMatch;

  const wantedTitle = normalize(game.title);
  if (!wantedTitle) return null;

  return (
    results.find((result) => normalize(result.title) === wantedTitle) ?? null
  );
}

/**
 * Derive the series stem of a title: take the part before a subtitle separator
 * (colon/dash), then drop trailing numerals, roman numerals and edition words.
 * "The Legend of Zelda: Ocarina of Time 3D" → "the legend of zelda";
 * "Final Fantasy VII" → "final fantasy"; "Metroid Prime 2" → "metroid prime"
 * → "metroid" only if "prime" were numeric — it isn't, so "metroid prime".
 */
export function seriesStem(title: string): string {
  const head = title.split(/[:\-–—]/)[0];
  const words = normalize(head).split(" ").filter(Boolean);
  while (words.length > 1) {
    const last = words[words.length - 1];
    if (/^\d+$/.test(last) || ROMAN.test(last) || EDITION_WORDS.has(last)) {
      words.pop();
    } else {
      break;
    }
  }
  return words.join(" ");
}

/** System segment of a `minerva:<system>:<title>` objectId, else null. */
const systemOf = (objectId: string): string | null =>
  objectId.startsWith("minerva:") ? objectId.split(":")[1] : null;

const classicsToShopAssets = (
  result: CatalogueSearchResult,
  reason: string
): ShopAssets => ({
  objectId: result.objectId,
  shop: result.shop,
  title: result.title,
  iconUrl: null,
  libraryHeroImageUrl: null,
  libraryImageUrl: result.libraryImageUrl ?? null,
  logoImageUrl: null,
  logoPosition: null,
  coverImageUrl: null,
  downloadSources: result.downloadSources ?? [],
  recommendationReason: reason,
});

interface ClassicsCandidate {
  result: CatalogueSearchResult;
  score: number;
  reason: string;
}

export async function getRecommendedClassics(
  library: LibraryGame[]
): Promise<ShopAssets[]> {
  const played = library
    .filter((g) => g.shop === "launchbox")
    .map((g) => ({
      game: g,
      hours: (g.playTimeInMilliseconds ?? 0) / HOUR_MS,
    }))
    .sort((a, b) => b.hours - a.hours);
  if (!played.length) return [];

  const ownedNorms = new Set(
    library.filter((g) => g.shop === "launchbox").map((g) => normalize(g.title))
  );
  const feedback = await getAllFeedback();
  const excludedIds = new Set(
    feedback
      .filter((f) => f.feedback === "dislike")
      .map((f) => `${f.shop}:${f.objectId}`)
  );

  // Play-pattern profile: systems and genres of everything actually played.
  const systemWeight = new Map<string, number>();
  const genreWeight = new Map<string, number>();
  const anchorGenreLookups: Promise<void>[] = [];
  for (const { game, hours } of played) {
    const weight = Math.log2(1 + hours) + 0.2;
    const system = systemForGame(game);
    if (system) {
      systemWeight.set(system, (systemWeight.get(system) ?? 0) + weight);
    }
    // Genres live in the hosted meta; the cheapest lookup is the classics
    // search on the game's own title (only for the top-played handful).
    if (hours >= SERIES_MIN_HOURS && anchorGenreLookups.length < 6) {
      anchorGenreLookups.push(
        window.electron
          .searchClassicsCatalogue(game.title, 3)
          .then((results) => {
            const self = selectClassicsCatalogueResultForGame(game, results);
            for (const genre of self?.genres ?? []) {
              genreWeight.set(genre, (genreWeight.get(genre) ?? 0) + weight);
            }
          })
          .catch(() => undefined)
      );
    }
  }
  await Promise.all(anchorGenreLookups);

  const candidates = new Map<string, ClassicsCandidate>();
  const pushCandidate = (
    result: CatalogueSearchResult,
    score: number,
    reason: string
  ) => {
    const key = `${result.shop}:${result.objectId}`;
    if (excludedIds.has(key)) return;
    if (ownedNorms.has(normalize(result.title))) return;
    const existing = candidates.get(key);
    if (!existing || existing.score < score) {
      candidates.set(key, { result, score, reason });
    }
  };

  // 1) SERIES: expand the top played anchors into their series siblings.
  const anchors = played
    .filter(({ hours }) => hours >= SERIES_MIN_HOURS)
    .slice(0, MAX_SERIES_ANCHORS);
  await Promise.all(
    anchors.map(async ({ game, hours }) => {
      const stem = seriesStem(game.title);
      if (stem.length < 3) return;
      const siblings = await window.electron
        .searchClassicsCatalogue(stem, 30)
        .catch(() => [] as CatalogueSearchResult[]);
      const anchorWeight = Math.log2(1 + hours) + 1;
      for (const sibling of siblings) {
        if (seriesStem(sibling.title) !== stem) continue;
        // Same-series entries dominate; nudge same-console siblings up a bit.
        const sameSystem =
          systemOf(sibling.objectId) === systemForGame(game) ? 0.3 : 0;
        pushCandidate(
          sibling,
          3 * anchorWeight + sameSystem,
          `Because you played ${game.title}`
        );
      }
    })
  );

  // 2) PLAY PATTERN: score a sampled slice of the catalogue by system + genre
  // overlap with the played profile (random sample avoids alphabetical bias).
  const sample = await window.electron
    .getRandomClassics(80)
    .catch(() => [] as CatalogueSearchResult[]);
  for (const entry of sample) {
    const system = systemOf(entry.objectId);
    const sysScore = system ? (systemWeight.get(system) ?? 0) * 0.4 : 0;
    let genreScore = 0;
    for (const genre of entry.genres ?? []) {
      genreScore += (genreWeight.get(genre) ?? 0) * 0.3;
    }
    const score = sysScore + genreScore;
    if (score <= 0) continue;
    const topGenre = (entry.genres ?? []).find((g) => genreWeight.has(g));
    pushCandidate(
      entry,
      score,
      topGenre
        ? `${topGenre} classics match what you play`
        : "Popular on consoles you play"
    );
  }

  return [...candidates.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, ROW_LIMIT)
    .map(({ result, reason }) => classicsToShopAssets(result, reason));
}
