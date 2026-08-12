import { shell } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { GameShop, type Game, type UserPreferences } from "@types";
import { db, downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";
import {
  WindowManager,
  logger,
  Umu,
  PowerSaveBlockerManager,
  Wine,
  NativeAddon,
  launchedGamePids,
} from "@main/services";
import { CommonRedistManager } from "@main/services/common-redist-manager";
import { parseExecutablePath } from "../events/helpers/parse-executable-path";
import { isGamemodeAvailable } from "./is-gamemode-available";
import { isMangohudAvailable } from "./is-mangohud-available";
import { resolveLaunchCommand } from "./resolve-launch-command";
import {
  buildWindowsBatchCommand,
  isWindowsBatchFile,
} from "./windows-batch-command";
import {
  findAchievementFiles,
  hasAchievementEmulatorSignature,
} from "@main/services/achievements/find-achievement-files";

export interface LaunchGameOptions {
  shop: GameShop;
  objectId: string;
  executablePath: string;
  launchOptions?: string | null;
}

const isWindowsExecutable = (executablePath: string) =>
  path.extname(executablePath).toLowerCase() === ".exe";

const ensureExecutablePermission = (executablePath: string) => {
  try {
    const currentMode = fs.statSync(executablePath).mode;
    const hasOwnerExecuteBit = (currentMode & 0o100) !== 0;

    if (!hasOwnerExecuteBit) {
      fs.chmodSync(executablePath, currentMode | 0o100);
    }
  } catch (error) {
    logger.warn("Failed to ensure executable permission", {
      executablePath,
      error,
    });
  }
};

const launchNatively = (
  executablePath: string,
  launchOptions?: string | null,
  useMangohud = false,
  useGamemode = false
): number | null => {
  const workingDirectory = path.dirname(executablePath);
  const resolvedLaunchCommand = resolveLaunchCommand({
    baseCommand: executablePath,
    launchOptions,
    wrapperCommands: [
      ...(useGamemode ? ["gamemoderun"] : []),
      ...(useMangohud ? ["mangohud"] : []),
    ],
  });

  if (process.platform === "linux") {
    ensureExecutablePermission(executablePath);
  } else if (
    resolvedLaunchCommand.command === executablePath &&
    resolvedLaunchCommand.args.length === 0 &&
    Object.keys(resolvedLaunchCommand.env).length === 0
  ) {
    shell.openPath(executablePath);
    return null;
  }

  if (
    process.platform === "win32" &&
    isWindowsBatchFile(resolvedLaunchCommand.command)
  ) {
    const processRef = spawn(
      buildWindowsBatchCommand(
        resolvedLaunchCommand.command,
        resolvedLaunchCommand.args
      ),
      {
        shell: true,
        detached: true,
        stdio: "ignore",
        cwd: workingDirectory,
        env: {
          ...process.env,
          ...resolvedLaunchCommand.env,
        },
      }
    );

    processRef.on("error", (error) => {
      logger.error("Failed to launch game", error);
    });

    processRef.unref();

    return processRef.pid ?? null;
  }

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

  processRef.on("error", (error) => {
    logger.error("Failed to launch game", error);
  });

  processRef.unref();

  return processRef.pid ?? null;
};

const launchWithWine = async (
  executablePath: string,
  launchOptions?: string | null,
  useMangohud = false,
  useGamemode = false
): Promise<boolean> => {
  const workingDirectory = path.dirname(executablePath);
  const resolvedLaunchCommand = resolveLaunchCommand({
    baseCommand: "wine",
    baseArgs: [executablePath],
    launchOptions,
    wrapperCommands: [
      ...(useGamemode ? ["gamemoderun"] : []),
      ...(useMangohud ? ["mangohud"] : []),
    ],
  });

  return await new Promise<boolean>((resolve) => {
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

    processRef.once("spawn", () => {
      processRef.unref();
      resolve(true);
    });

    processRef.once("error", (error) => {
      logger.error("Failed to launch game with Wine", error);
      resolve(false);
    });
  });
};

const resolveProtonPathForLaunch = async (
  gameProtonPath?: string | null
): Promise<string | null> => {
  if (gameProtonPath && Umu.isValidProtonPath(gameProtonPath)) {
    return gameProtonPath;
  }

  const userPreferences = await db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);

  const defaultProtonPath = userPreferences?.defaultProtonPath;

  if (defaultProtonPath && Umu.isValidProtonPath(defaultProtonPath)) {
    return defaultProtonPath;
  }

  return null;
};

const cleanupStaleCompatibilityProcesses = async (
  objectId: string,
  winePrefixPath: string | null
) => {
  if (process.platform !== "linux" || !winePrefixPath) return;

  const defaultPrefixPath = Wine.getDefaultPrefixPathForGame(objectId);
  if (defaultPrefixPath !== winePrefixPath) return;

  const processes = await NativeAddon.listProcesses();

  const stalePids = processes
    .filter((runningProcess) => {
      const processPrefix = runningProcess.environ?.STEAM_COMPAT_DATA_PATH;
      if (processPrefix !== winePrefixPath) return false;

      const processExe = runningProcess.exe?.toLowerCase() ?? "";
      const processName = runningProcess.name.toLowerCase();

      return (
        processExe.includes("wine") ||
        processName.endsWith(".exe") ||
        processName === "wineserver"
      );
    })
    .map((runningProcess) => runningProcess.pid);

  if (!stalePids.length) return;

  logger.info("Killing stale compatibility processes before game launch", {
    objectId,
    winePrefixPath,
    stalePids,
  });

  for (const pid of stalePids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Ignore races and missing permissions.
    }
  }
};

const launchWindowsBinaryOnLinux = async (
  gameKey: string,
  objectId: string,
  parsedPath: string,
  game: Game | undefined,
  launchOptions: string | null | undefined,
  useMangohud: boolean,
  useGamemode: boolean
): Promise<boolean> => {
  const protonPath = await resolveProtonPathForLaunch(game?.protonPath);
  const winePrefixPath = Wine.getEffectivePrefixPath(
    game?.winePrefixPath,
    objectId
  );

  await cleanupStaleCompatibilityProcesses(objectId, winePrefixPath);

  try {
    await Umu.launchExecutable(parsedPath, [], {
      winePrefixPath,
      protonPath,
      gameId: objectId,
      launchOptions,
      useGamemode,
      useMangohud,
    });
    PowerSaveBlockerManager.markCompatibilityLaunchStarted(gameKey);
    return true;
  } catch (error) {
    logger.error("Failed to launch game with umu-run, falling back", error);
  }

  const launchedWithWine = await launchWithWine(
    parsedPath,
    launchOptions,
    useMangohud,
    useGamemode
  );

  if (launchedWithWine) {
    PowerSaveBlockerManager.markCompatibilityLaunchStarted(gameKey);
    return true;
  }

  return false;
};

/**
 * Shows the launcher window and launches the game executable
 * Shared between deep link handler and openGame event
 */
export const launchGame = async (
  options: LaunchGameOptions
): Promise<number | null> => {
  const { shop, objectId, executablePath, launchOptions } = options;

  const parsedPath = parseExecutablePath(executablePath);

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

  if (game) {
    const updatedGame = { ...game, executablePath: parsedPath, launchOptions };
    await gamesSublevel.put(gameKey, updatedGame);

    // Auto-crack clean Steam files before launch (SteamAutoCrack +
    // experimental Goldberg emulator). Skipped for external/platform games
    // and for games that already carry an emulator signature.
    if (process.platform === "win32" && game.shop === "steam") {
      try {
        const { ensureGoldbergCracked } = await import(
          "@main/services/crack/steam-auto-crack"
        );
        const gameDir = path.dirname(parsedPath);
        const detection = await ensureGoldbergCracked(gameDir, objectId);
        logger.log("Pre-launch crack check", {
          objectId,
          status: detection.status,
        });
      } catch (error) {
        logger.error("Pre-launch crack check failed, continuing", error);
      }
    }

    // Option A: First-launch achievement emulator detection for REPACK games only.
    // A repack is a game that was downloaded through Hydra (so it has a download
    // record keyed by gameKey). We deliberately skip games launched from a
    // legitimate platform install (e.g. an owned Steam copy), since those already
    // get achievements through the platform and shouldn't be prompted to inject
    // experimental tracking.
    if (!game.achievementEmulatorChecked) {
      const isRepack = await downloadsSublevel
        .get(gameKey)
        .then((download) => !!download)
        .catch(() => false);

      if (isRepack) {
        const hasExistingSupport =
          findAchievementFiles(updatedGame).length > 0 ||
          hasAchievementEmulatorSignature(updatedGame);

        if (!hasExistingSupport) {
          WindowManager.sendToAppWindows("on-achievement-support-missing", {
            objectId,
            shop,
            title: game.title,
          });
        }

        await gamesSublevel.put(gameKey, {
          ...updatedGame,
          achievementEmulatorChecked: true,
        });
      }
    }
  }

  await WindowManager.createGameLauncherWindow(shop, objectId);

  // Run preflight check for common redistributables (Windows only)
  // Wrapped in try/catch to ensure game launch is never blocked
  if (process.platform === "win32") {
    try {
      logger.log("Starting preflight check for game launch", {
        shop,
        objectId,
      });
      const preflightPassed = await CommonRedistManager.runPreflight();
      logger.log("Preflight check result", { passed: preflightPassed });
    } catch (error) {
      logger.error(
        "Preflight check failed with error, continuing with launch",
        error
      );
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 2000));

  if (process.platform === "linux") {
    if (isWindowsExecutable(parsedPath)) {
      const launched = await launchWindowsBinaryOnLinux(
        gameKey,
        objectId,
        parsedPath,
        game,
        launchOptions,
        useMangohud,
        useGamemode
      );

      if (launched) return null;
    }

    const pid = launchNatively(
      parsedPath,
      launchOptions,
      useMangohud,
      useGamemode
    );

    if (pid !== null) launchedGamePids.set(gameKey, pid);

    return pid;
  }

  return launchNatively(parsedPath, launchOptions, useMangohud, useGamemode);
};
