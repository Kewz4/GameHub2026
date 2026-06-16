import { JSDOM } from "jsdom";
import { achievementsLogger } from "@main/services/logger";
import { exophasePsnProfileUrl } from "./constants";
import type { ExophaseFetcher } from "./exophase-web";

/** One PSN game discovered on the user's Exophase PSN profile. */
export interface PsnProfileGame {
  /** Display title as shown on the profile. */
  title: string;
  /** Absolute URL of the per-user game trophy page (shows earned trophies). */
  url: string;
}

const ensureAbsolute = (raw: string): string => {
  const url = (raw || "").trim();
  if (!url) return "";
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("/")) return `https://www.exophase.com${url}`;
  return url;
};

/**
 * Parses an Exophase PSN profile page into the list of games the user owns.
 *
 * Exophase renders each game as a card that links to the per-user game trophy
 * page (e.g. `/psn/user/{username}/game/{slug}/`). We don't rely on a single
 * fragile class name — instead we collect every anchor whose href points at a
 * per-user game page, then recover the title from the anchor text, its `title`
 * attribute, or a child image's `alt`.
 */
export function parsePsnProfileGames(
  html: string,
  username: string
): PsnProfileGame[] {
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const uname = username.toLowerCase();

  const out: PsnProfileGame[] = [];
  const seen = new Set<string>();

  const anchors = doc.querySelectorAll("a[href*='/game/']");
  anchors.forEach((a) => {
    const href = a.getAttribute("href") ?? "";
    const low = href.toLowerCase();
    // Per-user PSN game pages look like /psn/user/{username}/game/... or
    // /user/{username}/game/...
    if (!low.includes(`/user/${uname}/game/`)) return;

    const url = ensureAbsolute(href);
    if (!url || seen.has(url)) return;

    let title = (a.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!title) title = (a.getAttribute("title") ?? "").trim();
    if (!title) {
      const img = a.querySelector("img");
      title = (img?.getAttribute("alt") ?? "").trim();
    }
    if (!title) return;

    seen.add(url);
    out.push({ title, url });
  });

  return out;
}

/**
 * Walks the user's Exophase PSN profile (paginated) and returns every PSN game
 * with a trophy page. This is the SOURCE OF TRUTH for what the user actually
 * owns on PlayStation — independent of the local library.
 */
export async function fetchPsnProfileGames(
  fetcher: ExophaseFetcher,
  username: string,
  maxPages = 15
): Promise<PsnProfileGame[]> {
  const all: PsnProfileGame[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= maxPages; page++) {
    const url = exophasePsnProfileUrl(username, page);
    achievementsLogger.log(`[Exophase] PSN profile: fetching page ${page} (${url})`);

    let html: string;
    try {
      html = await fetcher.fetchHtml(url);
    } catch (err) {
      achievementsLogger.warn(`[Exophase] PSN profile page ${page} failed`, err);
      break;
    }

    const games = parsePsnProfileGames(html, username);
    achievementsLogger.log(
      `[Exophase] PSN profile page ${page}: parsed ${games.length} game(s)`
    );

    let added = 0;
    for (const g of games) {
      if (seen.has(g.url)) continue;
      seen.add(g.url);
      all.push(g);
      added++;
    }

    // Stop when a page yields no new games (end of list or non-paginated).
    if (added === 0) break;
  }

  achievementsLogger.log(
    `[Exophase] PSN profile: ${all.length} total PSN game(s) for "${username}"`
  );
  return all;
}
