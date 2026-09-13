import type { UserPreferences } from "@types";

export const isDesktopSidebarVisible = (preferences: UserPreferences | null) =>
  preferences !== null && preferences.hideSidebar !== true;

export const getNextDesktopSidebarHidden = (preferences: UserPreferences) =>
  isDesktopSidebarVisible(preferences);
