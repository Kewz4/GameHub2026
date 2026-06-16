import { JSDOM } from "jsdom";
import { achievementsLogger } from "@main/services/logger";
import { exophaseUserGamesUrl } from "./constants";
import type { ExophaseFetcher } from "./exophase-web";

/** One game read off the authenticated user's Exophase "Games" page. */
export interface ExophaseAccountGame {
  title: string;
  /** Best-effort Exophase `environment_slug` (steam/psn/xbox/…) inferred from
   *  the link, when the profile markup exposes it. May be undefined — the
   *  resolver then searches across platforms. */
  platformSlug?: string;
}

/** How many "?page=N" pages of the games list to walk before giving up. The
 *  loop stops early as soon as a page yields no new titles. */
const MAX_GAMES_PAGES = 20;

/** Maps platform tokens that can appear in an Exophase game href onto the
 *  `environment_slug` values our search/award pipeline understands. */
const HREF_SLUG_TOKENS: Array<[RegExp, string]> = [
  [/\bsteam\b/, "steam"],
  [/\bepic\b/, "epic"],
  [/\bgog\b/, "gog"],
  [/\b(origin|ea)\b/, "origin"],
  [/\b(ubisoft|uplay)\b/, "ubisoft"],
  [/\b(blizzard|battlenet|battle-net)\b/, "blizzard"],
  [/\bxbox\b/, "xbox"],
  [/\b(psn|playstation)\b/, "psn"],
];

const detectSlugFromHref = (href: string): string | undefined => {
  const h = (href || "").toLowerCase();
  for (const [re, slug] of HREF_SLUG_TOKENS) {
    if (re.test(h)) return slug;
  }
  return undefined;
};

/**
 * Parses one rendered "Games" page into account games. Deliberately LOOSE: it
 * over-collects every game-link title on the page. False positives are cheap —
 * the downstream Exophase search + Hydra-catalogue match discard anything that
 * doesn't resolve — whereas a missed game means lost achievements. Exact profile
 * markup is therefore not load-bearing here.
 */
export function parseAccountGamesPage(html: string): ExophaseAccountGame[] {
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  const out: ExophaseAccountGame[] = [];
  const seen = new Set<string>();

  doc.querySelectorAll('a[href*="/game/"]').forEach((a) => {
    const href = a.getAttribute("href") ?? "";
    const title = (a.getAttribute("title") || a.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!title || title.length < 2) return;

    const key = title.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);

    out.push({ title, platformSlug: detectSlugFromHref(href) });
  });

  return out;
}

/**
 * Enumerates every game on the authenticated user's Exophase account by walking
 * their public "Games" list (which the WebView fetcher can reach through
 * Cloudflare with the logged-in cookies). Pages are walked until one returns no
 * new titles. Returns a de-duplicated list across all pages.
 */
export async function fetchExophaseAccountGames(
  fetcher: ExophaseFetcher,
  username: string
): Promise<ExophaseAccountGame[]> {
  const byTitle = new Map<string, ExophaseAccountGame>();

  for (let page = 1; page <= MAX_GAMES_PAGES; page++) {
    const url = exophaseUserGamesUrl(username, page);
    let games: ExophaseAccountGame[] = [];
    try {
      const html = await fetcher.fetchHtml(url);
      games = parseAccountGamesPage(html);
    } catch (err) {
      achievementsLogger.warn(
        `[Exophase account] failed loading games page ${page}`,
        err
      );
      break;
    }

    let added = 0;
    for (const g of games) {
      const key = g.title.toLowerCase();
      if (byTitle.has(key)) continue;
      byTitle.set(key, g);
      added++;
    }

    achievementsLogger.log(
      `[Exophase account] page ${page}: ${games.length} links, ${added} new (total ${byTitle.size})`
    );

    // No new games on this page → we've reached the end (or there's no
    // pagination and every page is identical).
    if (added === 0) break;
  }

  return [...byTitle.values()];
}
