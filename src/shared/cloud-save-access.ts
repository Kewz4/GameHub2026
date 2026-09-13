export type CloudSaveAccessAction = "sign-in" | "paywall" | "open";

export const getCloudSaveAccessAction = (
  isAuthenticated: boolean,
  _hasActiveSubscription: boolean
): CloudSaveAccessAction => (isAuthenticated ? "open" : "sign-in");
