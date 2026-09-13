export interface BigPictureNavigationLocation {
  key: string;
  pathname: string;
}

export interface BigPicturePageTitleHistoryEntry {
  pathname: string;
  title: string;
}

export interface BigPictureRouteOwnedPageTitles {
  cloudSaves: string;
}

export function normalizeBigPicturePathname(pathname: string) {
  let end = pathname.length;
  while (end > 0 && pathname[end - 1] === "/") end--;
  const withoutTrailingSlash = end === 0 ? "/" : pathname.slice(0, end);

  if (withoutTrailingSlash === "/big-picture") return "/";

  if (withoutTrailingSlash.startsWith("/big-picture/")) {
    return withoutTrailingSlash.slice("/big-picture".length) || "/";
  }

  return withoutTrailingSlash;
}

export function matchesBigPictureRoute(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`);
}

export function isSameBigPictureNavigationLocation(
  left: BigPictureNavigationLocation,
  right: BigPictureNavigationLocation
) {
  return (
    left.key === right.key &&
    normalizeBigPicturePathname(left.pathname) ===
      normalizeBigPicturePathname(right.pathname)
  );
}

export function getBigPictureDefaultPageTitle(pathname: string): string {
  const normalizedPathname = normalizeBigPicturePathname(pathname);
  const segments = normalizedPathname.split("/").filter(Boolean);

  if (segments.length === 0) return "Home";

  if (segments[0] === "game") {
    return segments[3] === "achievements" ? "Achievements" : "Game Details";
  }

  const routeTitles: Readonly<Record<string, string>> = {
    catalogue: "Catalogue",
    library: "Library",
    "cloud-saves": "Cloud Saves",
    downloads: "Downloads",
    profile: "Profile",
    friends: "Friends",
    settings: "Settings",
    "component-lab": "Component Lab",
  };

  return (
    routeTitles[segments[0]] ??
    segments[0]
      .split(/[-_]+/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ")
  );
}

export function getBigPictureCurrentPageTitle(
  pathname: string,
  historyEntry: BigPicturePageTitleHistoryEntry | undefined,
  routeOwnedTitles: BigPictureRouteOwnedPageTitles
) {
  const normalizedPathname = normalizeBigPicturePathname(pathname);

  // Account-level Cloud Saves is a static route. Its title must not inherit a
  // game title left in the mutable navigation-history store by the game page.
  if (matchesBigPictureRoute(normalizedPathname, "/cloud-saves")) {
    return routeOwnedTitles.cloudSaves;
  }

  if (
    !historyEntry ||
    normalizeBigPicturePathname(historyEntry.pathname) !== normalizedPathname
  ) {
    return getBigPictureDefaultPageTitle(pathname);
  }

  return historyEntry.title;
}
