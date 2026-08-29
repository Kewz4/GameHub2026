import type { EmulatorBinary, EmulatorSystem } from "@types";

export type EmulatorCloudSaveStrategy =
  | "per-rom-files"
  | "per-title-files"
  | "per-title-directory"
  | "dedicated-memory-card-manager";

/**
 * Shared card images cannot safely be restored as if they belonged to one
 * game: an older per-game snapshot could erase newer saves for every sibling
 * title on that card. Those formats stay in the dedicated card manager; all
 * other strategies provide an isolated V2 source and destination.
 */
export const getEmulatorCloudSaveStrategy = (
  system: EmulatorSystem,
  binary: EmulatorBinary
): EmulatorCloudSaveStrategy => {
  if (binary === "ralibretro") return "per-rom-files";
  if (binary === "pcsx2" || binary === "duckstation") {
    return "dedicated-memory-card-manager";
  }
  if (binary === "dolphin" && system === "gc") return "per-title-files";
  return "per-title-directory";
};
