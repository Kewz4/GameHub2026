import type { CloudSaveAutomaticSyncMode, GameShop } from "@types";

export type { CloudSaveAutomaticSyncMode } from "@types";

/** Legacy fields are decoded only while migrating old local settings. */
export interface CloudSaveAutomaticSyncState {
  legacyEnabled: boolean;
  v2Enabled: boolean;
}

/** Decode the historical two-flag shape; this does not select a live backend. */
export const resolveCloudSaveAutomaticSyncMode = ({
  legacyEnabled,
  v2Enabled,
}: CloudSaveAutomaticSyncState): CloudSaveAutomaticSyncMode => {
  if (v2Enabled) return "v2";
  if (legacyEnabled) return "legacy";
  return "disabled";
};

export const resolveStoredCloudSaveAutomaticSyncMode = (
  _legacyEnabled: boolean,
  storedV2Enabled: boolean | undefined
): CloudSaveAutomaticSyncMode =>
  storedV2Enabled === false ? "disabled" : "v2";

export const resolveStoredCloudSaveAutomaticSyncModeForShop = (
  _shop: GameShop,
  legacyEnabled: boolean,
  storedV2Enabled: boolean | undefined
): CloudSaveAutomaticSyncMode =>
  resolveStoredCloudSaveAutomaticSyncMode(legacyEnabled, storedV2Enabled);

export const getCloudSaveAutomaticSyncStateForMode = (
  mode: CloudSaveAutomaticSyncMode
): CloudSaveAutomaticSyncState => ({
  legacyEnabled: mode === "legacy",
  v2Enabled: mode === "v2",
});

export const getNextCloudSaveAutomaticSyncMode = (
  currentMode: CloudSaveAutomaticSyncMode,
  targetMode: "v2",
  enabled: boolean
): CloudSaveAutomaticSyncMode => {
  if (enabled) return targetMode;
  return currentMode === targetMode ? "disabled" : currentMode;
};

export const shouldRunV2AutomaticCloudSave = (
  mode: CloudSaveAutomaticSyncMode
) => mode === "v2";
