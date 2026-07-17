export const PROFILE_PAGE_REGION_ID = "profile-page";
export const PROFILE_PAGE_ACTIONS_REGION_ID = "profile-page-actions";
export const PROFILE_PAGE_GAMES_REGION_ID = "profile-page-games";

export const PROFILE_FRIENDS_BUTTON_ID = "profile-friends-button";

export function getProfileGameFocusId(shop: string, objectId: string) {
  return `profile-game:${shop}:${objectId}`;
}
