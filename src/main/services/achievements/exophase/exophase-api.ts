import { JSDOM } from "jsdom";
import { EXOPHASE_SEARCH_URL } from "./constants";
import type { ExophaseFetcher } from "./exophase-web";

/** A single game row from the Exophase search API. */
export interface ExophaseSearchGame {
  master_id?: number;
  title?: string;
  environment_slug?: string;
  endpoint_awards?: string;
  platforms?: Array<{ name?: string; slug?: string }>;
}

interface ExophaseSearchResponse {
  success?: boolean;
  games?: { list?: ExophaseSearchGame[] };
}

/** A parsed achievement from an Exophase awards page. */
export interface ExophaseAchievement {
  apiName: string;
  displayName: string;
  description: string;
  iconUrl: string;
  unlocked: boolean;
  unlockTime: number | null;
  globalPercent: number | null;
  points: number | null;
}

/** Searches Exophase, optionally constrained to one `environment_slug`. */
export async function searchExophaseGames(
  fetcher: ExophaseFetcher,
  query: string,
  platformSlug?: string
): Promise<ExophaseSearchGame[]> {
  let url = `${EXOPHASE_SEARCH_URL}?q=${encodeURIComponent(query)}&sort=added`;
  if (platformSlug) url += `&platform=${encodeURIComponent(platformSlug)}`;
  const data = await fetcher.fetchJson<ExophaseSearchResponse>(url);
  const list = data?.games?.list ?? [];
  return list.filter((g) => Boolean(g && g.endpoint_awards));
}

/** Normalises a game title for matching/cache-keying: lowercased, edition
 *  suffixes and trademark glyphs stripped, punctuation collapsed to spaces. */
export const normalizeExophaseTitle = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[™®©]/g, "")
    .replace(
      /\s*[-:]?\s*(game of the year|goty|definitive|complete|deluxe|ultimate|enhanced|remastered|standard)\s*(edition)?\s*$/i,
      ""
    )
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const normalizeTitle = normalizeExophaseTitle;

/** Returns true if a search result belongs to the given platform slug. */
const matchesPlatform = (g: ExophaseSearchGame, slug: string): boolean => {
  const env = (g.environment_slug ?? "").toLowerCase();
  const endpoint = (g.endpoint_awards ?? "").toLowerCase();
  return (
    env === slug ||
    endpoint.includes(`-${slug}`) ||
    endpoint.includes(`/${slug}/`)
  );
};

const titleScore = (title: string, target: string): number => {
  if (title === target) return 100;
  if (title.startsWith(target)) return 80;
  if (title.includes(target)) return 60;
  if (target.includes(title) && title.length > 4) return 50;
  return -100;
};

/**
 * Picks the best Exophase result for a library game.
 *
 * When platformSlug is provided, we FIRST try to find a match among candidates
 * that actually belong to that platform. Only if there are zero platform-
 * specific positive-score candidates do we fall back to cross-platform results.
 * This prevents Epic games from resolving to PSN/Xbox/Android entries, which
 * was causing wrong awards URLs in the cache.
 */
export function findBestMatch(
  gameName: string,
  games: ExophaseSearchGame[],
  platformSlug?: string
): ExophaseSearchGame | null {
  const target = normalizeTitle(gameName);

  type Scored = { g: ExophaseSearchGame; score: number };
  const scored: Scored[] = games
    .map((g) => {
      const t = normalizeTitle(g.title ?? "");
      return { g, score: t ? titleScore(t, target) : -Infinity };
    })
    .filter((s) => s.score > 0);

  if (scored.length === 0) return null;

  // Prefer platform-specific results when a slug is given.
  if (platformSlug) {
    const platformPool = scored.filter((s) => matchesPlatform(s.g, platformSlug));
    if (platformPool.length > 0) {
      platformPool.sort((a, b) => b.score - a.score);
      return platformPool[0].g;
    }
    // No platform-specific match found — fall through to cross-platform.
  }

  scored.sort((a, b) => b.score - a.score);
  return scored[0].g;
}

const ensureAbsoluteUrl = (raw: string): string => {
  const url = (raw || "").trim();
  if (!url) return "";
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("/")) return `https://www.exophase.com${url}`;
  return url;
};

const stableApiName = (node: Element, displayName: string): string => {
  const master =
    node.getAttribute("data-master") ||
    node.getAttribute("data-award-id") ||
    node.getAttribute("id");
  if (master) return `exophase_${master}`;
  const slug = displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `exophase_${slug}`;
};

/** Best-effort parse of an Exophase "earned" date string into epoch ms. */
const parseEarnedTime = (text: string): number | null => {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  const parsed = Date.parse(clean);
  return Number.isNaN(parsed) ? null : parsed;
};

/**
 * Parses an Exophase awards page into achievements. Selectors verified against
 * the live markup:
 *   ul.achievement|trophy|challenge > li.award[data-earned][data-average]
 *     .award-title a            → name
 *     .award-description         → description
 *     img.award-image[src]       → icon
 *     .award-earned              → unlock date (when earned)
 */
export function parseAchievements(html: string): ExophaseAchievement[] {
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  const lists = doc.querySelectorAll(
    "ul[class*='achievement'], ul[class*='trophy'], ul[class*='challenge']"
  );

  const out: ExophaseAchievement[] = [];
  const seen = new Set<string>();

  lists.forEach((ul) => {
    ul.querySelectorAll(":scope > li").forEach((li) => {
      const titleNode =
        li.querySelector(".award-title a") ??
        li.querySelector(".award-title") ??
        li.querySelector("a") ??
        li.querySelector("h3") ??
        li.querySelector("strong");
      const displayName = (titleNode?.textContent ?? "").trim();
      if (!displayName) return;

      const apiName = stableApiName(li, displayName);
      if (seen.has(apiName)) return;
      seen.add(apiName);

      const descNode = li.querySelector(".award-description");
      const description = (descNode?.textContent ?? "").trim();

      const img =
        li.querySelector("img.award-image") ?? li.querySelector("img");
      const iconUrl = ensureAbsoluteUrl(
        img?.getAttribute("data-normal") || img?.getAttribute("src") || ""
      );

      const dataEarned = li.getAttribute("data-earned") ?? "0";
      const unlocked = dataEarned !== "0" && dataEarned.trim() !== "";

      const earnedNode = li.querySelector(".award-earned");
      const unlockTime = unlocked
        ? (parseEarnedTime(earnedNode?.textContent ?? "") ??
          (/^\d{9,}$/.test(dataEarned) ? Number(dataEarned) * 1000 : null))
        : null;

      const dataAverage = li.getAttribute("data-average") ?? "";
      const avg = dataAverage ? parseFloat(dataAverage) : NaN;
      const globalPercent = Number.isFinite(avg) ? avg : null;

      const dataPoints = li.getAttribute("data-points") ?? "";
      const pts = dataPoints ? parseInt(dataPoints, 10) : NaN;
      const points = Number.isFinite(pts) ? pts : null;

      out.push({
        apiName,
        displayName,
        description,
        iconUrl,
        unlocked,
        unlockTime,
        globalPercent,
        points,
      });
    });
  });

  return out;
}

/** Resolves the awards-page URL for a matched game. The API already returns a
 *  fully-qualified `endpoint_awards`, so we just normalise it. */
export function awardsUrlFor(game: ExophaseSearchGame): string {
  return ensureAbsoluteUrl(game.endpoint_awards ?? "");
}

/** Normalises an achievement/trophy display name for cross-platform matching
 *  (a PSN trophy ↔ the equivalent PC achievement). Lowercases and strips every
 *  non-alphanumeric character so "The Journey Begins!" === "the journey begins". */
export function normalizeAchievementName(name: string): string {
  return (name || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}
