export const FRIENDS_PAGE_REGION_ID = "friends-page";
export const FRIENDS_REQUESTS_REGION_ID = "friends-page-requests";
export const FRIENDS_LIST_REGION_ID = "friends-page-list";

export function getFriendRequestAcceptFocusId(id: string) {
  return `friend-request-accept:${id}`;
}

export function getFriendRequestRefuseFocusId(id: string) {
  return `friend-request-refuse:${id}`;
}

export function getFriendRequestCancelFocusId(id: string) {
  return `friend-request-cancel:${id}`;
}

export function getFriendFocusId(id: string) {
  return `friend:${id}`;
}
