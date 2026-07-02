import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { db, gamesSublevel, levelKeys } from "@main/level";
import { emulators, logger } from "@main/services";
import type {
  EmulatorBinary,
  EmulatorSystem,
  GameShop,
  UserPreferences,
} from "@types";
import { isGamemodeAvailable } from "./is-gamemode-available";
import { isMangohudAvailable } from "./is-mangohud-available";
import { resolveLaunchCommand } from "./resolve-launch-command";

export class EmulatorNotConfiguredError extends Error {
  code = "EMULATOR_NOT_CONFIGURED" as const;
  system: EmulatorSystem;
  constructor(system: EmulatorSystem) {
    super(`Emulator not configured for system ${system}`);
    this.system = system;
  }
}

export class BiosNotConfiguredError extends Error {
  code = "BIOS_NOT_CONFIGURED" as const;
  system: EmulatorSystem;
  constructor(system: EmulatorSystem) {
    super(`BIOS not configured for system ${system}`);
    this.system = system;
  }
}

export interface LaunchClassicsGameOptions {
  shop: GameShop;
  objectId: string;
  discPath: string;
  system: EmulatorSystem;
}

/**
 * RALibretro launches straight into a game when given the core, the
 * RetroAchievements system id and the ROM:
 *   RALibretro -c <coreFilenameBase> -s <systemId> -g <rom>
 * (-c is the Cores\<name>.dll basename, verified against RALibretro's
 * handleArgs/loadCore). Without these it just opens the GUI and the user has to
 * pick the core and load the ROM by hand. Core basenames match the DLLs we
 * bundle; system ids are the RetroAchievements console ids.
 */
const RALIBRETRO_LAUNCH: Partial<
  Record<EmulatorSystem, { core: string; systemId: number }>
> = {
  ps1: { core: "mednafen_psx_libretro", systemId: 12 },
  psp: { core: "ppsspp_libretro", systemId: 41 },
  gba: { core: "mgba_libretro", systemId: 5 },
  gb: { core: "mgba_libretro", systemId: 4 },
  gbc: { core: "mgba_libretro", systemId: 6 },
  n64: { core: "mupen64plus_next_libretro", systemId: 2 },
  nds: { core: "melondsds_libretro", systemId: 18 },
  dsi: { core: "melondsds_libretro", systemId: 78 },
};

const buildEmulatorArgs = (
  binary: EmulatorBinary,
  discPath: string,
  system: EmulatorSystem
): string[] => {
  switch (binary) {
    case "duckstation":
      return ["-batch", "-fullscreen", "--", discPath];
    case "pcsx2":
      return ["-batch", "-fullscreen", "--", discPath];
    case "rpcs3":
      return ["--no-gui", discPath];
    case "ppsspp":
      return ["--fullscreen", discPath];
    case "azahar":
      return ["--fullscreen", discPath];
    case "dolphin":
      return ["-b", "-e", discPath];
    case "cemu":
      return ["-f", "-g", discPath];
    case "raproject64":
      // RAProject64 takes the ROM path positionally.
      return [discPath];
    case "ravba":
      return [discPath];
    case "ralibretro": {
      const launch = RALIBRETRO_LAUNCH[system];
      // Boot directly into the game with the right core; fall back to just the
      // ROM (GUI picks the core) only if the system isn't mapped.
      return launch
        ? ["-c", launch.core, "-s", String(launch.systemId), "-g", discPath]
        : [discPath];
    }
  }
};

export const launchClassicsGame = async (
  options: LaunchClassicsGameOptions
): Promise<void> => {
  const { shop, objectId, discPath, system } = options;

  const config = await emulators.getEmulatorConfig(system);
  if (!config.executablePath || !existsSync(config.executablePath)) {
    throw new EmulatorNotConfiguredError(system);
  }

  // DuckStation/PCSX2 silently crash on launch when no BIOS is present, and the
  // emulator is spawned detached with stdio "ignore" so its own error never
  // reaches us. Detect the missing BIOS up front and block the launch instead.
  if (system === "ps1" || system === "ps2") {
    const biosInstalled = await emulators.isEmulatorBiosInstalled(
      system,
      config.executablePath
    );
    if (!biosInstalled) {
      throw new BiosNotConfiguredError(system);
    }
  }

  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey);

  const userPreferences = await db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);

  const useMangohud =
    (userPreferences?.autoRunMangohud === true ||
      game?.autoRunMangohud === true) &&
    isMangohudAvailable();

  const useGamemode =
    (userPreferences?.autoRunGamemode === true ||
      game?.autoRunGamemode === true) &&
    isGamemodeAvailable();

  const selectedDisc = game?.discs?.find((d) => d.path === discPath) ?? null;

  if (game) {
    await gamesSublevel.put(gameKey, {
      ...game,
      selectedDiscPath: discPath,
      lastTimePlayed: new Date(),
    });
  }

  const baseArgs = buildEmulatorArgs(config.binary, discPath, system);
  const executablePath = path.normalize(config.executablePath);
  const executableTarget =
    emulators.resolveEmulatorExecutableTarget(executablePath);

  if (!executableTarget || !existsSync(executableTarget)) {
    throw new EmulatorNotConfiguredError(system);
  }

  const resolvedLaunchCommand = resolveLaunchCommand({
    baseCommand: executableTarget,
    baseArgs,
    launchOptions: null,
    wrapperCommands: [
      ...(useGamemode ? ["gamemoderun"] : []),
      ...(useMangohud ? ["mangohud"] : []),
    ],
  });

  const workingDirectory = path.dirname(executableTarget);

  try {
    const processRef = spawn(
      resolvedLaunchCommand.command,
      resolvedLaunchCommand.args,
      {
        shell: false,
        detached: true,
        stdio: "ignore",
        cwd: workingDirectory,
        env: {
          ...process.env,
          ...resolvedLaunchCommand.env,
        },
      }
    );

    await new Promise<void>((resolve, reject) => {
      const onSpawn = () => {
        processRef.off("error", onError);
        resolve();
      };
      const onError = () => {
        processRef.off("spawn", onSpawn);
        reject(new EmulatorNotConfiguredError(system));
      };
      processRef.once("spawn", onSpawn);
      processRef.once("error", onError);
    });

    if (game) {
      await emulators.startEmulatorSession({
        game,
        system,
        executablePath: config.executablePath,
        sku: selectedDisc?.sku ?? null,
        child: processRef,
      });
    }

    processRef.unref();
  } catch (error) {
    logger.error("Failed to spawn classics emulator", error);
    throw error;
  }
};
