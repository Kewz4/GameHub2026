import fs from "node:fs";
import path from "node:path";
import type { ControllerProfile, EmulatorBinary, EmulatorSystem } from "@types";
import { KNOWN_BINARIES } from "./known-binaries";
import { getEmulatorConfig } from "./emulators-repository";
import { logger } from "../logger";
import { writeRalibretro } from "./controller-writers";
export * from "./controller-writers";

// ─── Apply ────────────────────────────────────────────────────────────────────

/** Write the profile into a specific binary's config. Returns true on success. */
function writeForBinary(
  binary: EmulatorBinary,
  installDir: string,
  profile: ControllerProfile
): boolean {
  try {
    switch (binary) {
      case "ralibretro":
        return writeRalibretro(installDir, profile);
      // The standalone emulators live in their own user-data dirs on Windows,
      // which we can only resolve at runtime on the user's machine — the writer
      // functions above generate the exact section text; wiring the file paths
      // is handled per-emulator in a follow-up. RALibretro (6 systems) is the
      // primary target and fully wired here.
      default:
        return false;
    }
  } catch (err) {
    logger.error(`[controller] write failed for ${binary}`, err);
    return false;
  }
}

/**
 * Apply the profile to every INSTALLED emulator. Because RALibretro backs six
 * systems from one install, mapping it once covers PS1/PSP/GBA/N64/DS/DSi.
 */
export async function applyControllerProfileToAll(
  profile: ControllerProfile
): Promise<{ binary: EmulatorBinary; ok: boolean }[]> {
  const results: { binary: EmulatorBinary; ok: boolean }[] = [];
  const seen = new Set<EmulatorBinary>();

  for (const system of Object.keys(KNOWN_BINARIES) as EmulatorSystem[]) {
    const known = KNOWN_BINARIES[system];
    if (seen.has(known.binary)) continue;

    const config = await getEmulatorConfig(system);
    if (!config.executablePath || !fs.existsSync(config.executablePath))
      continue;

    seen.add(known.binary);
    const ok = writeForBinary(
      known.binary,
      path.dirname(config.executablePath),
      profile
    );
    results.push({ binary: known.binary, ok });
  }

  return results;
}
