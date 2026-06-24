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
  /** Exophase internal player ID for this account (data-playerid on the
   *  profile page). Must be appended as `#<playerId>` to awards URLs so
   *  Exophase returns the user's earned state instead of the generic view. */
  playerId: string;
  /** Direct awards URL scraped from the account game-list link
   *  (e.g. https://www.exophase.com/game/immortals-fenyx-rising-psn-2/trophies/).
   *  When present, skip the Exophase title-search step and go straight to this
   *  URL — avoids wrong-locale slug matching (e.g. Chinese slug vs English slug). */
  awardsUrl?: string;
}

/** A linked platform account discovered on the main Exophase profile. */
export interface ExophasePlatformAccount {
  platformSlug: string;
  accountName: string;
  /** Exophase internal numeric player ID (`data-playerid` on the <li>). */
  playerId: string;
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

  const tryAdd = (raw: string, playerId: string) => {
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
    out.push({ platformSlug, accountName, playerId });
  };

  // Primary: data-endpoint attributes (the real Exophase structure).
  // Each <li data-endpoint="/psn/user/Kewz999/" data-playerid="2434969"> gives
  // us both the account path and the player ID needed for earned-state URLs.
  doc.querySelectorAll("[data-endpoint]").forEach((el) => {
    const endpoint = el.getAttribute("data-endpoint") ?? "";
    const playerId = el.getAttribute("data-playerid") ?? "";
    tryAdd(endpoint, playerId);
  });

  // Fallback: scan all href attributes (catches any future restructuring)
  if (out.length === 0) {
    doc.querySelectorAll("a[href]").forEach((a) => {
      tryAdd(a.getAttribute("href") ?? "", "");
    });
  }

  return out;
}

/** Parsed entry from a platform games page — title plus the direct game URL. */
export interface PlatformGameEntry {
  title: string;
  /** Absolute URL to the Exophase game page (e.g. /game/immortals-fenyx-rising-psn-2/).
   *  Derived from the href on the account page — the slug here is always the
   *  correct locale variant the user actually owns, avoiding wrong-locale matches
   *  that a title-search would produce for localized (e.g. Chinese) PSN titles. */
  gamePageUrl: string;
}

/**
 * Parses one rendered platform games page into (title, gamePageUrl) pairs.
 * The href on each game link is the authoritative Exophase slug for the user's
 * specific copy — even when the displayed title is localized (e.g. Chinese),
 * the href uses the locale-specific slug we should go to directly.
 */
export function parsePlatformGamesPage(html: string): PlatformGameEntry[] {
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  const out: PlatformGameEntry[] = [];
  const seen = new Set<string>();

  doc.querySelectorAll('a[href*="/game/"]').forEach((a) => {
    const title = (a.getAttribute("title") || a.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!title || title.length < 2) return;

    const href = (a.getAttribute("href") || "").trim();
    if (!href) return;

    const key = href.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);

    const gamePageUrl = href.startsWith("http")
      ? href
      : `https://www.exophase.com${href.startsWith("/") ? "" : "/"}${href}`;
    out.push({ title, gamePageUrl });
  });

  return out;
}

/** Returns the awards-page suffix for a platform (trophies for PSN, achievements for PC). */
const awardsSegment = (platformSlug: string): string =>
  platformSlug === "psn" ? "trophies" : "achievements";

/** Builds the awards URL from a game-page URL: appends the awards segment. */
const gamePageToAwardsUrl = (
  gamePageUrl: string,
  platformSlug: string
): string => {
  const base = gamePageUrl.replace(/\/?$/, "/");
  return `${base}${awardsSegment(platformSlug)}/`;
};

/** Walks one platform account's paginated games list. */
async function fetchPlatformGames(
  fetcher: ExophaseFetcher,
  account: ExophasePlatformAccount
): Promise<ExophaseAccountGame[]> {
  // Key by gamePageUrl (not title) so localized duplicate titles don't collide.
  const byUrl = new Map<string, ExophaseAccountGame>();

  for (let page = 1; page <= MAX_GAMES_PAGES; page++) {
    const url = exophasePlatformGamesUrl(
      account.platformSlug,
      account.accountName,
      page
    );

    let entries: PlatformGameEntry[] = [];
    try {
      entries = parsePlatformGamesPage(await fetcher.fetchHtml(url));
    } catch (err) {
      achievementsLogger.warn(
        `[Exophase account] failed loading ${account.platformSlug} page ${page}`,
        err
      );
      break;
    }

    let added = 0;
    for (const { title, gamePageUrl } of entries) {
      const key = gamePageUrl.toLowerCase();
      if (byUrl.has(key)) continue;
      byUrl.set(key, {
        title,
        platformSlug: account.platformSlug,
        playerId: account.playerId,
        awardsUrl: gamePageToAwardsUrl(gamePageUrl, account.platformSlug),
      });
      added++;
    }

    achievementsLogger.log(
      `[Exophase account] ${account.platformSlug}/${account.accountName} page ${page}: ${entries.length} links, ${added} new`
    );

    if (added === 0) break;
  }

  return [...byUrl.values()];
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
  // Retry the profile read: right after the onboarding login the persist:exophase
  // session cookies may not yet be flushed, so the first render can come back
  // logged-out (0 linked accounts). Re-fetch a few times before giving up.
  const MAX_PROFILE_ATTEMPTS = 4;
  for (let attempt = 1; attempt <= MAX_PROFILE_ATTEMPTS; attempt++) {
    try {
      // 3 s settle so JS-rendered platform integration links are in the DOM.
      const html = await fetcher.fetchHtml(exophaseProfileUrl(username), 3_000);
      achievementsLogger.log(
        `[Exophase account] profile attempt ${attempt}: HTML length ${html.length}, has /user/ links: ${/\/user\//.test(html)}`
      );
      accounts = parsePlatformAccounts(html);
    } catch (err) {
      achievementsLogger.warn(
        `[Exophase account] failed loading main profile (attempt ${attempt})`,
        err
      );
    }

    if (accounts.length > 0) break;
    if (attempt < MAX_PROFILE_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 2_000 * attempt));
    }
  }

  if (accounts.length === 0) return [];

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
