export type GameHubSavePlanLookup = "manual" | "emulator" | null;

/**
 * V2 resolves native PC save rules through the pinned native manifest. The
 * legacy Ludusavi plan is only an adapter for an explicit manual mapping or an
 * emulator title, so a normal PC overview must never enter its subprocess-
 * backed manifest lookup.
 */
export const selectGameHubSavePlanLookup = (
  hasManualPaths: boolean,
  emulatorSystem: string | null
): GameHubSavePlanLookup => {
  if (hasManualPaths) return "manual";
  if (emulatorSystem) return "emulator";
  return null;
};
