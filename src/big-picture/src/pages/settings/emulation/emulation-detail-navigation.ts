import {
  EMULATION_DETAIL_CLOUD_REFRESH_BUTTON_ID,
  EMULATION_DETAIL_MEMORY_CARDS_PICK_BUTTON_ID,
} from "../settings-navigation";

/**
 * Concrete focusable nodes at the boundary between memory cards and cloud
 * backups. Navigation overrides target items, not focus-region identifiers.
 */
export const EMULATION_DETAIL_SAVE_BOUNDARY_TARGETS = {
  memoryCardsDown: EMULATION_DETAIL_CLOUD_REFRESH_BUTTON_ID,
  cloudSavesUp: EMULATION_DETAIL_MEMORY_CARDS_PICK_BUTTON_ID,
} as const;
