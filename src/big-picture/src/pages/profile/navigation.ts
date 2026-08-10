export const PROFILE_PAGE_REGION_ID = "profile-page";
export const PROFILE_PAGE_ACTIONS_REGION_ID = "profile-page-actions";
export const PROFILE_PAGE_TABS_REGION_ID = "profile-page-tabs";
export const PROFILE_PAGE_SORT_REGION_ID = "profile-page-sort";
export const PROFILE_PAGE_GAMES_REGION_ID = "profile-page-games";

export const PROFILE_FRIENDS_BUTTON_ID = "profile-friends-button";
export const PROFILE_RETRY_BUTTON_ID = "profile-retry-button";
export const PROFILE_GAMES_TAB_ID = "profile-tab-games";
export const PROFILE_ACHIEVEMENTS_TAB_ID = "profile-tab-achievements";

export function getProfileSortFocusId(sort: string) {
  return `profile-sort:${sort}`;
}

export function getProfileGameFocusId(shop: string, objectId: string) {
  return `profile-game:${shop}:${objectId}`;
}
