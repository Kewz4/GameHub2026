import type { GameShop } from "@types";

/** Dedicated persistent session for Exophase so its cookies live independently
 *  from the rest of the app and survive restarts. */
export const EXOPHASE_PARTITION = "persist:exophase";

export const EXOPHASE_LOGIN_URL = "https://www.exophase.com/login";
export const EXOPHASE_ACCOUNT_URL = "https://www.exophase.com/account";
export const EXOPHASE_SEARCH_URL =
  "https://api.exophase.com/public/archive/games";

/** The user's main Exophase profile. Lists every LINKED platform account
 *  (e.g. `/psn/user/Kewz999/`, `/xbox/user/Kewz8504/`, …) which we then walk to
 *  enumerate that platform's games. */
export const exophaseProfileUrl = (username: string): string =>
  `https://www.exophase.com/user/${encodeURIComponent(username)}/`;

/** A single linked platform account's games page. Exophase paths put the
 *  platform slug first: `https://www.exophase.com/<platform>/user/<account>/`.
 *  This is the SOURCE OF TRUTH for the account-driven sync — every game the
 *  user owns/played on that platform appears here. */
export const exophasePlatformGamesUrl = (
  platform: string,
  account: string,
  page = 1
): string =>
  `https://www.exophase.com/${platform}/user/${encodeURIComponent(account)}/${
    page > 1 ? `?page=${page}` : ""
  }`;

/**
 * Maps a GameHub store (our `GameShop`) to Exophase's `environment_slug`.
 * Only stores Exophase actually tracks are listed; the rest are skipped.
 */
export const SHOP_TO_EXOPHASE_SLUG: Partial<Record<GameShop, string>> = {
  steam: "steam",
  epic: "epic",
  gog: "gog",
  battlenet: "blizzard",
  xbox: "xbox",
  ea: "origin",
  ubisoft: "ubisoft",
};

/** Every Exophase `environment_slug` we know how to resolve, in priority order.
 *  PC platforms come first (the launcher is PC-only, so a PC page is preferred
 *  when a profile entry's platform is ambiguous); console trophy sources follow.
 *  Used when an account game's platform can't be read off the profile page. */
export const EXOPHASE_ALL_SLUGS = [
  "steam",
  "epic",
  "gog",
  "origin",
  "ubisoft",
  "blizzard",
  "xbox",
  "psn",
] as const;

/** The platforms surfaced in the "Managed Platforms" settings list. Each maps
 *  1:1 to one of our library shops so the toggle is always meaningful. */
export const EXOPHASE_MANAGED_PLATFORMS: Array<{
  shop: GameShop;
  label: string;
}> = [
  { shop: "steam", label: "Steam" },
  { shop: "xbox", label: "Xbox" },
  { shop: "gog", label: "GOG" },
  { shop: "epic", label: "Epic Games" },
  { shop: "battlenet", label: "Battle.net" },
  { shop: "ea", label: "EA app" },
  { shop: "ubisoft", label: "Ubisoft Connect" },
];

/** When the user hasn't customised the managed set yet, manage every shop we
 *  can map. Achievements then "just work" the moment they log in. */
export const DEFAULT_MANAGED_SHOPS: GameShop[] = EXOPHASE_MANAGED_PLATFORMS.map(
  (p) => p.shop
);
