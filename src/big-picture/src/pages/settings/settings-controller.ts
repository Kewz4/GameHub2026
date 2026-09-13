import { BIG_PICTURE_APP_LAYER_ID } from "../../layout/navigation";
import {
  INTEGRATIONS_STEAM_PRIMARY_BTN_ID,
  INTEGRATIONS_STEAM_SYNC_BTN_ID,
} from "./settings-navigation";

export function canHandleSettingsBumperInput(
  activeLayerId: string | null,
  virtualKeyboardOpen: boolean
) {
  return activeLayerId === BIG_PICTURE_APP_LAYER_ID && !virtualKeyboardOpen;
}

export function getSettingsSearchForTab(search: string, tab: string) {
  const params = new URLSearchParams(search);
  params.set("tab", tab);
  params.delete("section");
  const query = params.toString();

  return query ? `?${query}` : "";
}

/**
 * Integrations is ordered from platform accounts into achievement imports and
 * download providers. Enter at Steam's first available action so controller
 * focus cannot auto-scroll those platform sections behind the sticky rail.
 */
export function getIntegrationsInitialFocusId(
  steamId: string | null | undefined
) {
  return steamId
    ? INTEGRATIONS_STEAM_SYNC_BTN_ID
    : INTEGRATIONS_STEAM_PRIMARY_BTN_ID;
}

export function resolveSettingsContentTopClearance(
  railHeight: number,
  stickyDisplacement = 0
) {
  if (!Number.isFinite(railHeight) || !Number.isFinite(stickyDisplacement)) {
    return 0;
  }

  const SETTINGS_CONTENT_SAFETY_GAP_PX = 12;

  return (
    Math.max(0, Math.ceil(stickyDisplacement)) + SETTINGS_CONTENT_SAFETY_GAP_PX
  );
}
