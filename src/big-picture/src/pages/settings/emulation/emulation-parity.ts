import type { EmulatorConfig, EmulatorConfigMap, EmulatorSystem } from "@types";

/**
 * Every emulator platform exposed by the main-process emulator repository.
 * Keep this list exhaustive so Big Picture never silently drops a platform.
 */
export const BIG_PICTURE_EMULATOR_SYSTEMS = [
  "ps1",
  "ps2",
  "ps3",
  "psp",
  "n3ds",
  "nds",
  "dsi",
  "n64",
  "gb",
  "gbc",
  "gba",
  "wiiu",
  "wii",
  "gc",
  "switch",
] as const satisfies readonly EmulatorSystem[];

export const BIG_PICTURE_EMULATOR_SYSTEM_LABELS: Record<
  EmulatorSystem,
  string
> = {
  ps1: "PlayStation",
  ps2: "PlayStation 2",
  ps3: "PlayStation 3",
  psp: "PSP",
  n3ds: "Nintendo 3DS",
  nds: "Nintendo DS",
  dsi: "Nintendo DSi",
  n64: "Nintendo 64",
  gb: "Game Boy",
  gbc: "Game Boy Color",
  gba: "Game Boy Advance",
  wiiu: "Wii U",
  wii: "Wii",
  gc: "GameCube",
  switch: "Nintendo Switch",
};

export function isBigPictureEmulatorConfigured(
  config: EmulatorConfig | null | undefined
) {
  return Boolean(config?.executablePath && config.detectedAt !== null);
}

export function getBigPictureEmulatorRuntimeStatus(
  config: EmulatorConfig | null | undefined,
  executableExists: boolean | null | undefined
): "setup" | "checking" | "ready" | "missing" {
  if (!isBigPictureEmulatorConfigured(config)) return "setup";
  if (executableExists === false) return "missing";
  if (executableExists === true) return "ready";
  return "checking";
}

export function supportsBigPictureMemoryCards(system: EmulatorSystem) {
  return system === "ps1" || system === "ps2";
}

export function getBigPictureEmulatorCardAction(
  config: EmulatorConfig | null | undefined
): "manage" | "setup" {
  return isBigPictureEmulatorConfigured(config) ? "manage" : "setup";
}

/** A single emulator install can serve multiple systems (RALibretro/Dolphin). */
export function getBigPictureEmulatorInstallSystems(
  configs: EmulatorConfigMap,
  system: EmulatorSystem
): EmulatorSystem[] {
  const binary = configs[system].binary;
  return BIG_PICTURE_EMULATOR_SYSTEMS.filter(
    (candidate) => configs[candidate].binary === binary
  );
}
