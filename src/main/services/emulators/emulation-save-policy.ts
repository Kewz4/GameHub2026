import path from "node:path";

import type { EmulationSaveEmulator, EmulationSavePlatform } from "@types";

const PLATFORM_EMULATOR: Record<EmulationSavePlatform, EmulationSaveEmulator> =
  {
    ps1: "duckstation",
    ps2: "pcsx2",
  };

const MEMORY_CARD_EXTENSIONS: Record<
  EmulationSavePlatform,
  ReadonlySet<string>
> = {
  ps1: new Set([".mcd", ".mcr", ".mc", ".gme", ".vgs", ".vmp"]),
  ps2: new Set([".ps2", ".mcd", ".mc2"]),
};

export const isEmulationSavePlatform = (
  value: unknown
): value is EmulationSavePlatform => value === "ps1" || value === "ps2";

export const assertEmulationSavePlatform = (value: unknown): void => {
  if (!isEmulationSavePlatform(value)) {
    throw new Error("Invalid emulation save platform");
  }
};

export const emulatorForEmulationSavePlatform = (
  platform: EmulationSavePlatform
): EmulationSaveEmulator => PLATFORM_EMULATOR[platform];

export const isMemoryCardPathForPlatform = (
  platform: EmulationSavePlatform,
  cardFilePath: string
) =>
  MEMORY_CARD_EXTENSIONS[platform].has(
    path.extname(cardFilePath).toLowerCase()
  );

/** The platform is an unencoded, fixed segment in every emulation-save key. */
export const isEmulationSaveKeyForPlatform = (
  saveId: string,
  platform: EmulationSavePlatform
) => {
  const segments = saveId.split("/");
  return segments.length === 6 && segments[2] === "emulation-saves"
    ? segments[3] === platform
    : false;
};

export const sanitizeEmulationSaveExportStem = (value: string) =>
  value.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "") || "save";
