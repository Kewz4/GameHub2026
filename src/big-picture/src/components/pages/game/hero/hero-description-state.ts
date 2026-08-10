import { sanitizeHtml, stripHtml } from "@shared";

import { GAME_HERO_DESCRIPTION_TOGGLE_ID } from "../navigation";

export interface HeroDescriptionState {
  canExpand: boolean;
  isExpanded: boolean;
}

export interface HeroDescriptionPresentation {
  canExpand: boolean;
  isExpanded: boolean;
  toggleLabel: "Read more" | "Show less";
  toggleFocusId: typeof GAME_HERO_DESCRIPTION_TOGGLE_ID;
}

export const createHeroDescriptionState = (): HeroDescriptionState => ({
  canExpand: false,
  isExpanded: false,
});

export function sanitizeHeroDescriptionText(html: string) {
  return stripHtml(sanitizeHtml(html)).replaceAll(/\s+/g, " ").trim();
}

export function resetHeroDescriptionState(): HeroDescriptionState {
  return createHeroDescriptionState();
}

export function recordHeroDescriptionOverflow(
  state: HeroDescriptionState,
  isOverflowing: boolean
): HeroDescriptionState {
  if (!isOverflowing || state.canExpand) return state;

  return { ...state, canExpand: true };
}

export function toggleHeroDescription(state: HeroDescriptionState) {
  if (!state.canExpand) {
    return { state, restoreFocusId: null };
  }

  return {
    state: { ...state, isExpanded: !state.isExpanded },
    restoreFocusId: GAME_HERO_DESCRIPTION_TOGGLE_ID,
  };
}

export function getHeroDescriptionPresentation(
  state: HeroDescriptionState
): HeroDescriptionPresentation {
  return {
    canExpand: state.canExpand,
    isExpanded: state.isExpanded,
    toggleLabel: state.isExpanded ? "Show less" : "Read more",
    toggleFocusId: GAME_HERO_DESCRIPTION_TOGGLE_ID,
  };
}

export function getHeroActionUpFocusId(canExpand: boolean) {
  return canExpand ? GAME_HERO_DESCRIPTION_TOGGLE_ID : null;
}
