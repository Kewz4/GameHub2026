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

const normalizeTitle = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[™®©]/g, "")
    .replace(
      /\s*[-:]?\s*(game of the year|goty|definitive|complete|deluxe|ultimate|enhanced|remastered|standard)\s*(edition)?\s*$/i,
      ""
    )
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Picks the best Exophase result for a library game. Ported from the Playnite
 * extension's FindBestMatch: exact/prefix/substring title scoring plus a bonus
 * when the awards URL carries the right `-{platform}` marker.
 */
export function findBestMatch(
  gameName: string,
  games: ExophaseSearchGame[],
  platformSlug?: string
): ExophaseSearchGame | null {
  const target = normalizeTitle(gameName);
  let best: ExophaseSearchGame | null = null;
  let bestScore = 0;

  for (const g of games) {
    const title = normalizeTitle(g.title ?? "");
    if (!title) continue;

    let score: number;
    if (title === target) score = 100;
    else if (title.startsWith(target)) score = 80;
    else if (title.includes(target)) score = 60;
    else if (target.includes(title)) score = 50;
    else score = -100;

    const endpoint = (g.endpoint_awards ?? "").toLowerCase();
    if (platformSlug) {
      if (g.environment_slug === platformSlug) score += 20;
      else if (endpoint.includes(`-${platformSlug}`)) score += 20;
    }

    if (score > bestScore) {
      bestScore = score;
      best = g;
    }
  }

  return bestScore > 0 ? best : null;
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
