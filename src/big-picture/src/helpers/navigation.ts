import type { FocusOverrideTarget } from "../services";
import { IS_DESKTOP } from "../constants";

export function getBigPictureRoutePath(
  route: `/${string}`,
  isDesktop = IS_DESKTOP
) {
  return `${isDesktop ? "/big-picture" : ""}${route}`;
}

export function getItemFocusTarget(itemId: string): FocusOverrideTarget {
  return {
    type: "item",
    itemId,
  };
}

export function getOptionalItemFocusTarget(itemId?: string) {
  if (!itemId) return undefined;

  return getItemFocusTarget(itemId);
}
