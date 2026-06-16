import type { GameShop } from "@types";

/** Dedicated persistent session for Exophase so its cookies live independently
 *  from the rest of the app and survive restarts. */
export const EXOPHASE_PARTITION = "persist:exophase";

export const EXOPHASE_LOGIN_URL = "https://www.exophase.com/login";
export const EXOPHASE_ACCOUNT_URL = "https://www.exophase.com/account";
export const EXOPHASE_SEARCH_URL =
  "https://api.exophase.com/public/archive/games";

/** Per-user PlayStation trophy profile, e.g.
 *  https://www.exophase.com/psn/user/{username}/ — lists every PSN game the
 *  user has trophies for, each linking to a per-user game trophy page. */
export const exophasePsnProfileUrl = (username: string, page = 1): string => {
  const base = `https://www.exophase.com/psn/user/${encodeURIComponent(username)}/`;
  return page > 1 ? `${base}?page=${page}` : base;
};

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
