import { JSDOM } from "jsdom";
import { achievementsLogger } from "@main/services/logger";
import { exophasePlatformGamesUrl, exophaseProfileUrl } from "./constants";
import type { ExophaseFetcher } from "./exophase-web";

/** One game read off the authenticated user's Exophase profile. */
export interface ExophaseAccountGame {
  title: string;
  /** Exophase `environment_slug` (steam/psn/xbox/…) — known because we read it
   *  off that platform's profile page. */
  platformSlug: string;
}

/** A linked platform account discovered on the main Exophase profile. */
export interface ExophasePlatformAccount {
  platformSlug: string;
  accountName: string;
}

/** How many "?page=N" pages of a platform's games list to walk before giving
 *  up. The loop stops early as soon as a page yields no new titles. */
const MAX_GAMES_PAGES = 30;

/** Matches `/<platform>/user/<account>` in data-endpoint attributes on the profile page. */
const PLATFORM_ACCOUNT_RE =
  /\/(steam|psn|xbox|origin|gog|epic|ubisoft|uplay|blizzard|battlenet|android)\/user\/([^/?#"']+)/i;

/** Normalises Exophase URL platform tokens onto the `environment_slug` values
 *  our search/award pipeline understands. */
const normalizePlatform = (p: string): string => {
  const s = p.toLowerCase();
  if (s === "uplay") return "ubisoft";
  if (s === "battlenet") return "blizzard";
  return s;
};

/**
 * Parses the main profile page into the user's linked platform accounts.
 * Exophase renders each platform integration as:
 *   <li data-endpoint="/<platform>/user/<account>/" data-environment="<platform>" ...>
 * We read `data-endpoint` (preferred) and fall back to scanning all attributes.
 */
export function parsePlatformAccounts(html: string): ExophasePlatformAccount[] {
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  const out: ExophasePlatformAccount[] = [];
  const seen = new Set<string>();

  const tryAdd = (raw: string) => {
    const m = raw.match(PLATFORM_ACCOUNT_RE);
    if (!m) return;

    // Skip template placeholders like {{endpoint}}
    if (raw.includes("{{")) return;

    const platformSlug = normalizePlatform(m[1]);
    // Android has no achievement support — skip it
    if (platformSlug === "android") return;

    let accountName: string;
    try {
      accountName = decodeURIComponent(m[2]);
    } catch {
      accountName = m[2];
    }

    const key = `${platformSlug}:${accountName.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ platformSlug, accountName });
  };

  // Primary: data-endpoint attributes (the real Exophase structure)
  doc.querySelectorAll("[data-endpoint]").forEach((el) => {
    tryAdd(el.getAttribute("data-endpoint") ?? "");
  });

  // Fallback: scan all href attributes (catches any future restructuring)
  if (out.length === 0) {
    doc.querySelectorAll("a[href]").forEach((a) => {
      tryAdd(a.getAttribute("href") ?? "");
    });
  }

  return out;
}

/**
 * Parses one rendered platform games page into game titles. Deliberately LOOSE:
 * it over-collects every game-link title on the page. False positives are cheap
 * — the downstream Exophase search + Hydra-catalogue match discard anything that
 * doesn't resolve — whereas a missed game means lost achievements.
 */
export function parsePlatformGamesPage(html: string): string[] {
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  const out: string[] = [];
  const seen = new Set<string>();

  doc.querySelectorAll('a[href*="/game/"]').forEach((a) => {
    const title = (a.getAttribute("title") || a.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!title || title.length < 2) return;

    const key = title.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(title);
  });

  return out;
}

/** Walks one platform account's paginated games list. */
async function fetchPlatformGames(
  fetcher: ExophaseFetcher,
  account: ExophasePlatformAccount
): Promise<ExophaseAccountGame[]> {
  const byTitle = new Map<string, ExophaseAccountGame>();

  for (let page = 1; page <= MAX_GAMES_PAGES; page++) {
    const url = exophasePlatformGamesUrl(
      account.platformSlug,
      account.accountName,
      page
    );

    let titles: string[] = [];
    try {
      titles = parsePlatformGamesPage(await fetcher.fetchHtml(url));
    } catch (err) {
      achievementsLogger.warn(
        `[Exophase account] failed loading ${account.platformSlug} page ${page}`,
        err
      );
      break;
    }

    let added = 0;
    for (const title of titles) {
      const key = title.toLowerCase();
      if (byTitle.has(key)) continue;
      byTitle.set(key, { title, platformSlug: account.platformSlug });
      added++;
    }

    achievementsLogger.log(
      `[Exophase account] ${account.platformSlug}/${account.accountName} page ${page}: ${titles.length} links, ${added} new`
    );

    if (added === 0) break;
  }

  return [...byTitle.values()];
}

/**
 * Enumerates every game on the authenticated user's Exophase account.
 *
 * Reads the main profile to discover each LINKED platform account, then walks
 * every platform's games list. Each game carries its real `platformSlug` (the
 * page it came from), so PSN/Xbox/EA titles resolve against the correct award
 * pages downstream. Returns one entry per (title, platform).
 */
export async function fetchExophaseAccountGames(
  fetcher: ExophaseFetcher,
  username: string
): Promise<ExophaseAccountGame[]> {
  let accounts: ExophasePlatformAccount[] = [];
  try {
    // 3 s settle so JS-rendered platform integration links are in the DOM.
    const html = await fetcher.fetchHtml(exophaseProfileUrl(username), 3_000);
    achievementsLogger.log(
      `[Exophase account] profile HTML length: ${html.length}, has /user/ links: ${/\/user\//.test(html)}`
    );
    accounts = parsePlatformAccounts(html);
  } catch (err) {
    achievementsLogger.warn(
      "[Exophase account] failed loading main profile",
      err
    );
    return [];
  }

  achievementsLogger.log(
    `[Exophase account] profile "${username}" → ${accounts.length} linked accounts: ${accounts
      .map((a) => `${a.platformSlug}/${a.accountName}`)
      .join(", ")}`
  );

  const games: ExophaseAccountGame[] = [];
  for (const account of accounts) {
    const platformGames = await fetchPlatformGames(fetcher, account);
    achievementsLogger.log(
      `[Exophase account] ${account.platformSlug}/${account.accountName}: ${platformGames.length} games`
    );
    games.push(...platformGames);
  }

  return games;
}
