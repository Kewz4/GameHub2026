import { emulatorsSublevel } from "@main/level";
import type { EmulatorConfig, EmulatorConfigMap, EmulatorSystem } from "@types";
import { ALL_SYSTEMS, KNOWN_BINARIES } from "./known-binaries";

const SYSTEMS: EmulatorSystem[] = ALL_SYSTEMS;

const emptyConfig = (system: EmulatorSystem): EmulatorConfig => ({
  system,
  binary: KNOWN_BINARIES[system].binary,
  executablePath: null,
  detectedVersion: null,
  detectedAt: null,
  romFolders: [],
  lastScanAt: null,
  totalFiles: 0,
  totalSizeBytes: 0,
});

export const getEmulatorConfig = async (
  system: EmulatorSystem
): Promise<EmulatorConfig> => {
  const existing = await emulatorsSublevel.get(system);
  if (!existing) return emptyConfig(system);

  // A system's target binary can change between app versions (e.g. N64 moved
  // from a standalone RAProject64 install to the shared RALibretro build).
  // A config saved under the old mapping still carries the old `binary` and
  // executablePath; if we returned it as-is, the UI would show the old
  // emulator's name and any re-install/launch would target a binary the
  // registry no longer recognizes. Detect the mismatch and migrate: adopt the
  // current binary, drop the now-irrelevant executablePath/version (they
  // belong to a different program), but keep romFolders — the ROMs themselves
  // don't care which emulator plays them.
  const currentBinary = KNOWN_BINARIES[system].binary;
  if (existing.binary !== currentBinary) {
    const migrated: EmulatorConfig = {
      ...existing,
      binary: currentBinary,
      executablePath: null,
      detectedVersion: null,
      detectedAt: null,
    };
    await emulatorsSublevel.put(system, migrated);
    return migrated;
  }

  return existing;
};

export const getAllEmulatorConfigs = async (): Promise<EmulatorConfigMap> => {
  const entries = await Promise.all(
    SYSTEMS.map(async (s) => [s, await getEmulatorConfig(s)] as const)
  );
  return Object.fromEntries(entries) as EmulatorConfigMap;
};

export const setEmulatorConfig = async (
  config: EmulatorConfig
): Promise<EmulatorConfig> => {
  await emulatorsSublevel.put(config.system, config);
  return config;
};

export const updateEmulatorConfig = async (
  system: EmulatorSystem,
  patch: (current: EmulatorConfig) => EmulatorConfig
): Promise<EmulatorConfig> => {
  const current = await getEmulatorConfig(system);
  const next = patch(current);
  await emulatorsSublevel.put(system, next);
  return next;
};

export const recomputeTotals = (config: EmulatorConfig): EmulatorConfig => {
  const totalFiles = config.romFolders.reduce((s, f) => s + f.fileCount, 0);
  const totalSizeBytes = config.romFolders.reduce((s, f) => s + f.sizeBytes, 0);
  const lastScanAt = config.romFolders.reduce<number | null>((acc, f) => {
    if (f.lastScanAt === null) return acc;
    return acc === null || f.lastScanAt > acc ? f.lastScanAt : acc;
  }, null);
  return { ...config, totalFiles, totalSizeBytes, lastScanAt };
};

export const resetEmulatorScanData = async (): Promise<void> => {
  for (const system of SYSTEMS) {
    const existing = await emulatorsSublevel.get(system);
    if (!existing) continue;
    await emulatorsSublevel.put(system, {
      ...existing,
      romFolders: existing.romFolders.map((folder) => ({
        ...folder,
        fileCount: 0,
        sizeBytes: 0,
        lastScanAt: null,
      })),
      totalFiles: 0,
      totalSizeBytes: 0,
      lastScanAt: null,
    });
  }
};
