import type { ShopAssets } from "@types";
import { getGameIdentityKey } from "../../helpers";

export const HOME_HERO_ADD_TO_LIBRARY_ID = "home-hero-add-to-library";
export const HOME_HERO_OPEN_GAME_PAGE_ID = "home-hero-open-game-page";
export const HOME_HERO_DOWNLOAD_ID = "home-hero-download";
export const HOME_HERO_ACTIONS_REGION_ID = "home-hero-actions";
export const HOME_PAGE_REGION_ID = "home-page";
export const HOME_HARD_PLATINUMS_GRID_REGION_ID = "home-hard-platinums-grid";
export const HOME_TRENDING_GAMES_CAROUSEL_REGION_ID =
  "home-trending-games-carousel";
export const HOME_WEEKLY_GAMES_CAROUSEL_REGION_ID =
  "home-weekly-games-carousel";
export const HOME_RECOMMENDED_GAMES_CAROUSEL_REGION_ID =
  "home-recommended-games-carousel";
export const HOME_CLASSICS_GAMES_CAROUSEL_REGION_ID =
  "home-classics-games-carousel";

export function getHomeBecauseCarouselRegionId(shelfIndex: number) {
  return `home-because-carousel-${shelfIndex}`;
}

export function getHomeRecommendedGameItemId(
  game: Pick<ShopAssets, "shop" | "objectId">
) {
  return `home-recommended-game-${getGameIdentityKey(game, { separator: "-" })}`;
}

export function getHomeClassicsGameItemId(
  game: Pick<ShopAssets, "shop" | "objectId">
) {
  return `home-classics-game-${getGameIdentityKey(game, { separator: "-" })}`;
}

export function getHomeBecauseGameItemId(
  shelfIndex: number,
  game: Pick<ShopAssets, "shop" | "objectId">
) {
  return `home-because-${shelfIndex}-game-${getGameIdentityKey(game, { separator: "-" })}`;
}

export function getHomeChallengeGameItemId(
  game: Pick<ShopAssets, "shop" | "objectId">
) {
  return `home-challenge-game-${getGameIdentityKey(game, { separator: "-" })}`;
}

export function getHomeTrendingGameItemId(
  game: Pick<ShopAssets, "shop" | "objectId">
) {
  return `home-trending-game-${getGameIdentityKey(game, { separator: "-" })}`;
}

export function getHomeWeeklyGameItemId(
  game: Pick<ShopAssets, "shop" | "objectId">
) {
  return `home-weekly-game-${getGameIdentityKey(game, { separator: "-" })}`;
}
