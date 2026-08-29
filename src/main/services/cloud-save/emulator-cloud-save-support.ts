import type { CloudSaveMappingIssue, GameShop } from "@types";
import { Ludusavi } from "@main/services/ludusavi";
import {
  resolveEmulatorBackupFolders,
  resolveEmulatorRestorePatterns,
  resolveEmulatorSaveLocation,
  systemForGame,
} from "@main/services/emulators/emulator-save-dirs";
import {
  getEmulatorCloudSaveStrategy,
  type EmulatorCloudSaveStrategy,
} from "@main/services/emulators/emulator-cloud-save-strategy";

export const classifyEmulatorCloudSaveMappingIssue = (
  strategy: EmulatorCloudSaveStrategy,
  system: string
): CloudSaveMappingIssue => {
  if (strategy === "dedicated-memory-card-manager") {
    return "shared-memory-card";
  }
  if (system === "gc") return "gamecube-gci-unavailable";
  return "title-identity-unavailable";
};

/**
 * Explain why automatic V2 has no safe rule for an emulated title. This is
 * deliberately independent of whether a save exists: a prospective restore
 * rule proves the mapping is supported even on a clean machine.
 */
export const getEmulatorCloudSaveMappingIssue = async (
  objectId: string,
  shop: GameShop
): Promise<CloudSaveMappingIssue | null> => {
  const manual = await Ludusavi.getManualCustomGame(shop, objectId);
  if (manual?.files.length) return null;

  const system = await systemForGame(shop, objectId);
  if (!system) return null;

  const location = await resolveEmulatorSaveLocation(shop, objectId);
  if (!location) return "emulator-unavailable";

  const [backupPaths, restorePatterns] = await Promise.all([
    resolveEmulatorBackupFolders(shop, objectId),
    resolveEmulatorRestorePatterns(shop, objectId),
  ]);
  if (backupPaths.length > 0 || restorePatterns.length > 0) return null;

  return classifyEmulatorCloudSaveMappingIssue(
    getEmulatorCloudSaveStrategy(location.system, location.binary),
    location.system
  );
};
