import type { FocusOverrideTarget } from "../services";
import { DOWNLOADS_PAGE_REGION_ID } from "../components/pages/downloads/navigation";
import { GAME_PAGE_REGION_ID } from "../components/pages/game/navigation";
import { GAME_ACHIEVEMENTS_PAGE_REGION_ID } from "../components/pages/game-achievements/navigation";
import { CATALOGUE_GRID_REGION_ID } from "../pages/catalogue/navigation";
import { HOME_PAGE_REGION_ID } from "../pages/home/navigation";
import { SETTINGS_PAGE_REGION_ID } from "../pages/settings/navigation";
import { LIBRARY_PAGE_REGION_ID } from "../components/pages/library/navigation";
import { CLOUD_SAVES_PAGE_REGION_ID } from "../pages/cloud-saves/navigation";
import { PROFILE_PAGE_REGION_ID } from "../pages/profile/navigation";
import { FRIENDS_PAGE_REGION_ID } from "../pages/friends/navigation";
import {
  matchesBigPictureRoute,
  normalizeBigPicturePathname,
} from "./route-presentation";

export {
  getBigPictureCurrentPageTitle,
  getBigPictureDefaultPageTitle,
  isSameBigPictureNavigationLocation,
  normalizeBigPicturePathname,
} from "./route-presentation";

export const BIG_PICTURE_APP_LAYER_ID = "big-picture-app-layer";
export const BIG_PICTURE_SHELL_REGION_ID = "big-picture-shell";
export const BIG_PICTURE_SIDEBAR_REGION_ID = "big-picture-sidebar";
export const BIG_PICTURE_CONTENT_REGION_ID = "big-picture-content";
export const BIG_PICTURE_HEADER_REGION_ID = "header";

export const BIG_PICTURE_SIDEBAR_ITEM_IDS = {
  home: "big-picture-sidebar-home",
  catalogue: "big-picture-sidebar-catalogue",
  library: "big-picture-sidebar-library",
  cloudSaves: "big-picture-sidebar-cloud-saves",
  downloads: "big-picture-sidebar-downloads",
  profile: "big-picture-sidebar-profile",
  friends: "big-picture-sidebar-friends",
  settings: "big-picture-sidebar-settings",
  componentLab: "big-picture-sidebar-component-lab",
} as const;

export const BIG_PICTURE_SIDEBAR_EXIT_ID = "big-picture-sidebar-exit";

export type BigPictureSidebarRouteKey =
  keyof typeof BIG_PICTURE_SIDEBAR_ITEM_IDS;

export interface BigPictureGameRouteMatch {
  shop: string;
  objectId: string;
  section?: "achievements";
}

export function getBigPictureSidebarLibraryGameFocusId(
  game: BigPictureGameRouteMatch
) {
  return `big-picture-sidebar-library-game:${game.shop}:${game.objectId}`;
}

export function getBigPictureGameRouteMatch(
  pathname: string
): BigPictureGameRouteMatch | null {
  const normalizedPathname = normalizeBigPicturePathname(pathname);
  const match = normalizedPathname.match(
    /^\/game\/([^/]+)\/([^/]+)(?:\/(achievements))?$/
  );

  if (!match) return null;

  return {
    shop: decodeURIComponent(match[1]),
    objectId: decodeURIComponent(match[2]),
    ...(match[3] === "achievements"
      ? { section: "achievements" as const }
      : {}),
  };
}

export function getBigPictureSidebarItemIdFromPathname(pathname: string) {
  const normalizedPathname = normalizeBigPicturePathname(pathname);
  const isDev = import.meta.env?.DEV ?? false;

  if (getBigPictureGameRouteMatch(normalizedPathname)) {
    return null;
  }

  if (matchesBigPictureRoute(normalizedPathname, "/component-lab")) {
    return isDev
      ? BIG_PICTURE_SIDEBAR_ITEM_IDS.componentLab
      : BIG_PICTURE_SIDEBAR_ITEM_IDS.home;
  }

  if (matchesBigPictureRoute(normalizedPathname, "/catalogue")) {
    return BIG_PICTURE_SIDEBAR_ITEM_IDS.catalogue;
  }

  if (matchesBigPictureRoute(normalizedPathname, "/cloud-saves")) {
    return BIG_PICTURE_SIDEBAR_ITEM_IDS.cloudSaves;
  }

  if (matchesBigPictureRoute(normalizedPathname, "/downloads")) {
    return BIG_PICTURE_SIDEBAR_ITEM_IDS.downloads;
  }

  if (matchesBigPictureRoute(normalizedPathname, "/profile")) {
    return BIG_PICTURE_SIDEBAR_ITEM_IDS.profile;
  }

  if (matchesBigPictureRoute(normalizedPathname, "/friends")) {
    return BIG_PICTURE_SIDEBAR_ITEM_IDS.friends;
  }

  if (matchesBigPictureRoute(normalizedPathname, "/settings")) {
    return BIG_PICTURE_SIDEBAR_ITEM_IDS.settings;
  }

  if (matchesBigPictureRoute(normalizedPathname, "/library")) {
    return BIG_PICTURE_SIDEBAR_ITEM_IDS.library;
  }

  return BIG_PICTURE_SIDEBAR_ITEM_IDS.home;
}

export function getBigPictureContentEntryRegionIdFromPathname(
  pathname: string
) {
  const normalizedPathname = normalizeBigPicturePathname(pathname);

  if (normalizedPathname === "/") {
    return HOME_PAGE_REGION_ID;
  }

  if (matchesBigPictureRoute(normalizedPathname, "/catalogue")) {
    return CATALOGUE_GRID_REGION_ID;
  }

  if (matchesBigPictureRoute(normalizedPathname, "/library")) {
    return LIBRARY_PAGE_REGION_ID;
  }

  if (matchesBigPictureRoute(normalizedPathname, "/cloud-saves")) {
    return CLOUD_SAVES_PAGE_REGION_ID;
  }

  if (matchesBigPictureRoute(normalizedPathname, "/downloads")) {
    return DOWNLOADS_PAGE_REGION_ID;
  }

  if (matchesBigPictureRoute(normalizedPathname, "/profile")) {
    return PROFILE_PAGE_REGION_ID;
  }

  if (matchesBigPictureRoute(normalizedPathname, "/friends")) {
    return FRIENDS_PAGE_REGION_ID;
  }

  if (matchesBigPictureRoute(normalizedPathname, "/settings")) {
    return SETTINGS_PAGE_REGION_ID;
  }

  const gameRoute = getBigPictureGameRouteMatch(normalizedPathname);

  if (gameRoute?.section === "achievements") {
    return GAME_ACHIEVEMENTS_PAGE_REGION_ID;
  }

  if (gameRoute) {
    return GAME_PAGE_REGION_ID;
  }

  return null;
}

export function getBigPictureContentRouteEntryTargetFromPathname(
  pathname: string
): FocusOverrideTarget {
  const regionId = getBigPictureContentEntryRegionIdFromPathname(pathname);

  if (!regionId) {
    return {
      type: "region",
      regionId: BIG_PICTURE_CONTENT_REGION_ID,
      entryDirection: "right",
    };
  }

  return {
    type: "region",
    regionId,
    entryDirection: "right",
    preferRememberedFocus: false,
  };
}

export function getBigPictureContentSidebarReturnTargetFromPathname(
  pathname: string
): FocusOverrideTarget {
  const regionId = getBigPictureContentEntryRegionIdFromPathname(pathname);

  if (!regionId) {
    return {
      type: "region",
      regionId: BIG_PICTURE_CONTENT_REGION_ID,
      entryDirection: "right",
    };
  }

  return {
    type: "region",
    regionId,
    entryDirection: "right",
  };
}
