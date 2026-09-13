import { WindowManager } from "./window-manager";
import { createGame, trackGamePlaytime } from "./library-sync";
import type { Game, GameRunning, UserPreferences } from "@types";
import axios from "axios";
import { db, gamesSublevel, levelKeys } from "@main/level";
import { logger, networkLogger } from "./logger";
import { PowerSaveBlockerManager } from "./power-save-blocker";
import { OverlayManager } from "./overlay-manager";
import { shouldActivateOverlayGame } from "./overlay-active-game";
import fs from "node:fs";
import path from "node:path";
import { AchievementWatcherManager } from "./achievements/achievement-watcher-manager";
import { RaWatcherManager } from "./achievements/retroachievements/ra-watcher-manager";
import { INTERVALS } from "@main/constants";
import { Wine } from "./wine";
import { NativeAddon } from "./native-addon";
import { launchedGamePids } from "./launched-game-pids";
import {
  hasLaunchedPidMatch,
  hasLinuxNativeOrAppImageMatch,
  type LinuxProcessInfo,
} from "./linux-process-match";
import { isWindowsBatchFile } from "@main/helpers/windows-batch-command";
import { selectGameExecutablePath } from "@main/helpers/game-executable-path";
import { runAutomaticCloudSaveAfterExit } from "./cloud-save/automatic-sync-lifecycle";
import {
  clearCloudSaveLaunchGuard,
  markCloudSaveLaunchSessionRunning,
} from "./cloud-save/launch-guard";
import {
  clearAllExternalGameLaunches,
  clearExternalGameLaunch,
  confirmExternalLaunchProcess,
  getExternalGameLaunch,
  getPotentialExternalLaunchProcesses,
  hasExternalGameLaunch,
  hasTrackedExternalGameLaunches,
  isExternalGameLaunchExpired,
  markExternalGameLaunchSeen,
  resetExternalLaunchObservation,
  selectExternalLaunchProcess,
  shouldWaitForExternalProcessHandoff,
  withDiscoveredExecutablePath,
  type ExternalGameLaunchState,
  type ExternalGameProcess,
  type ExternalProcessWindow,
} from "./external-game-launch-tracker";

export const gamesPlaytime = new Map<
  string,
  {
    lastTick: number;
    firstTick: number;
    lastSyncTick: number;
    cloudSaveSessionToken?: string;
  }
>();

/**
 * Emulator games run inside a shared emulator process (Cemu.exe, etc.), so the
 * executable-path process scan never matches them. The emulator launcher
 * registers them here instead, and they're merged into the `on-games-running`
 * broadcast so the Play button flips to Close while the emulator is open.
 */
const emulatorRunningGames = new Map<string, number>();

/**
 * Read-only session check shared by cloud-save mutation guards. This includes
 * emulated games, whose child process is tracked separately from PC titles.
 */
export const isGameRunning = (
  objectId: string,
  shop: Game["shop"]
): boolean => {
  const gameKey = levelKeys.game(shop, objectId);
  return (
    gamesPlaytime.has(gameKey) ||
    emulatorRunningGames.has(gameKey) ||
    hasExternalGameLaunch(gameKey)
  );
};

export const setEmulatorGameRunning = (
  gameKey: string,
  running: boolean
): void => {
  if (running) emulatorRunningGames.set(gameKey, performance.now());
  else emulatorRunningGames.delete(gameKey);
};

interface ExecutableInfo {
  name: string;
  os: string;
  exe: string;
}

interface GameExecutables {
  [key: string]: ExecutableInfo[];
}

const TICKS_TO_UPDATE_API = (3 * 60 * 1000) / INTERVALS.processWatcher; // 3 minutes
let currentTick = 1;

const platform = process.platform;

const logPlaytimeTrace = (
  event: string,
  game: Game,
  payload?: Record<string, unknown>
) => {
  networkLogger.info("[playtime-trace]", event, {
    gameKey: levelKeys.game(game.shop, game.objectId),
    shop: game.shop,
    objectId: game.objectId,
    remoteId: game.remoteId,
    localPlayTimeInMilliseconds: Math.trunc(game.playTimeInMilliseconds ?? 0),
    unsyncedDeltaPlayTimeInMilliseconds:
      game.unsyncedDeltaPlayTimeInMilliseconds ?? 0,
    lastTimePlayed:
      game.lastTimePlayed instanceof Date
        ? game.lastTimePlayed.toISOString()
        : game.lastTimePlayed,
    ...payload,
  });
};

const getGameExecutables = async () => {
  const gameExecutables = (
    await axios
      .get(
        import.meta.env.MAIN_VITE_EXTERNAL_RESOURCES_URL +
          "/game-executables.json"
      )
      .catch(() => {
        return { data: {} };
      })
  ).data as GameExecutables;

  Object.keys(gameExecutables).forEach((key) => {
    gameExecutables[key] = gameExecutables[key]
      .filter((executable) => {
        if (platform === "win32") {
          return executable.os === "win32";
        } else if (platform === "linux") {
          return executable.os === "linux" || executable.os === "win32";
        }

        return false;
      })
      .map((executable) => {
        return {
          name:
            platform === "win32"
              ? executable.name.replace(/\//g, "\\")
              : executable.name,
          os: executable.os,
          exe: executable.name.slice(executable.name.lastIndexOf("/") + 1),
        };
      });
  });

  return gameExecutables;
};

export const gameExecutables = await getGameExecutables();

const findGamePathByProcess = async (
  processMap: Map<string, Set<string>>,
  winePrefixMap: Map<string, string>,
  game: Game
): Promise<Game | null> => {
  const executables = gameExecutables[game.objectId] ?? [];

  for (const executable of executables) {
    const executableName = executable.exe.toLowerCase();
    const executablewithoutExtension = executableName.replace(/\.exe$/i, "");

    const pathSet =
      processMap.get(executableName) ??
      processMap.get(executablewithoutExtension);

    if (pathSet) {
      for (const path of pathSet) {
        if (
          path.toLowerCase().endsWith(executable.name.toLowerCase()) ||
          path.toLowerCase().endsWith(executablewithoutExtension)
        ) {
          const gameKey = levelKeys.game(game.shop, game.objectId);
          const updatedGame = withDiscoveredExecutablePath(game, path);

          if (process.platform === "linux" && winePrefixMap.has(path)) {
            updatedGame.winePrefixPath = winePrefixMap.get(path)!;
          }

          await gamesSublevel.put(gameKey, updatedGame);
          logger.info("Set game path", gameKey, path);
          return updatedGame;
        }
      }
    }
  }

  return null;
};

const getSystemProcessMap = async () => {
  const {
    processMap: rawMap,
    winePrefixMap: rawWineMap,
    linuxProcesses,
  } = await NativeAddon.getSystemProcessMap();

  const processMap = new Map<string, Set<string>>(
    Object.entries(rawMap).map(([k, v]) => [k, new Set(v)])
  );

  const winePrefixMap = new Map<string, string>(Object.entries(rawWineMap));

  return { processMap, winePrefixMap, linuxProcesses };
};

const sameExecutablePath = (left: string | null, right: string) =>
  !!left &&
  path.normalize(left).toLowerCase() === path.normalize(right).toLowerCase();

const findProcessForPaths = (
  processes: ExternalGameProcess[],
  executablePaths: string[]
) =>
  processes.find((process) =>
    executablePaths.some((executablePath) =>
      sameExecutablePath(process.exe, executablePath)
    )
  ) ?? null;

const discoverExternalLaunchProcess = (
  state: ExternalGameLaunchState,
  processes: ExternalGameProcess[]
) => {
  const possibleProcesses = getPotentialExternalLaunchProcesses(
    state,
    processes
  );
  const windows = new Map<number, ExternalProcessWindow>();

  if (process.platform === "win32") {
    for (const candidate of possibleProcesses) {
      const bounds = NativeAddon.getProcessWindowBounds(candidate.pid);
      if (bounds) windows.set(candidate.pid, bounds);
    }
  }

  const match = selectExternalLaunchProcess({
    state,
    processes,
    foregroundPid: NativeAddon.getForegroundProcessId(),
    windows,
    requireVisibleWindow: process.platform === "win32",
  });

  if (!match) {
    resetExternalLaunchObservation(state.gameKey);
    return null;
  }

  return confirmExternalLaunchProcess(state.gameKey, match)
    ? match.process
    : null;
};

const bindExternalProcessToGame = async (
  game: Game,
  process: ExternalGameProcess
) => {
  const executablePath = process.exe;
  if (!executablePath || /^[a-z][a-z\d+.-]*:\/\//i.test(executablePath)) {
    return game;
  }

  const previousNativePath = game.nativeExecutablePath;
  const trackingExecutablePaths = [
    ...(game.trackingExecutablePaths ?? []),
    ...(previousNativePath && previousNativePath !== executablePath
      ? [previousNativePath]
      : []),
  ].filter(
    (candidate, index, values) =>
      candidate !== executablePath && values.indexOf(candidate) === index
  );

  const updatedGame: Game = {
    ...game,
    // Keep the protocol in executablePath; it is still the launch command.
    // nativeExecutablePath is detection-only for the spawned game process.
    nativeExecutablePath: executablePath,
    trackingExecutablePaths,
    trackingExecutablePathsUpdatedAt: new Date(),
  };

  await gamesSublevel.put(
    levelKeys.game(game.shop, game.objectId),
    updatedGame
  );
  logger.info("Bound external game launch to visible process", {
    gameKey: levelKeys.game(game.shop, game.objectId),
    pid: process.pid,
    executablePath,
  });
  return updatedGame;
};

const hasLinuxCompatibilityProcessMatch = (
  game: Game,
  executablePath: string,
  linuxProcesses: LinuxProcessInfo[]
) => {
  if (path.extname(executablePath).toLowerCase() !== ".exe") {
    return false;
  }

  const executableName = path.basename(executablePath).toLowerCase();
  const executableNameWithoutExtension = executableName.replace(/\.exe$/i, "");
  const executableDirectory = path.posix.dirname(
    path.posix.normalize(executablePath)
  );
  const expectedWinePrefix = Wine.getEffectivePrefixPath(
    game.winePrefixPath,
    game.objectId
  );

  return linuxProcesses.some((process) => {
    if (
      !process.cwd ||
      path.posix.normalize(process.cwd) !== executableDirectory
    ) {
      return false;
    }

    if (
      expectedWinePrefix &&
      process.steamCompatDataPath &&
      path.posix.normalize(process.steamCompatDataPath) !==
        path.posix.normalize(expectedWinePrefix)
    ) {
      return false;
    }

    if (
      process.name.toLowerCase() === executableName ||
      process.name.toLowerCase() === executableNameWithoutExtension
    ) {
      return true;
    }

    const processRunsUnderWine = /^wine(?:64)?(?:-preloader)?$/i.test(
      path.posix.basename(process.exe)
    );

    return processRunsUnderWine && process.name.length > 0;
  });
};

export const watchProcesses = async () => {
  const games = await gamesSublevel
    .values()
    .all()
    .then((results) => {
      return results.filter((game) => game.isDeleted === false);
    });

  if (!games.length) return;

  const { processMap, winePrefixMap, linuxProcesses } =
    await getSystemProcessMap();

  const pidToProcess = new Map<number, LinuxProcessInfo>(
    linuxProcesses.map((process) => [process.pid, process])
  );
  const externalProcesses = hasTrackedExternalGameLaunches()
    ? await NativeAddon.listProcesses()
    : [];

  for (const game of games) {
    let detectedGame = game;
    const gameKey = levelKeys.game(game.shop, game.objectId);
    let externalLaunch = getExternalGameLaunch(gameKey);

    if (externalLaunch && isExternalGameLaunchExpired(externalLaunch)) {
      clearExternalGameLaunch(gameKey);
      clearCloudSaveLaunchGuard(
        game.objectId,
        game.shop,
        externalLaunch.cloudSaveSessionToken ?? undefined
      );
      logger.warn(
        "External game launch expired before a game process appeared",
        {
          gameKey,
          protocolUrl: externalLaunch.protocolUrl,
        }
      );
      externalLaunch = null;
    }

    // Platform URI games use nativeExecutablePath as their discovered process
    // target. For local/repacked games, however, that value can point at an old
    // extraction after the user moves the folder; prefer whichever local
    // candidate still exists so the launch session is not orphaned.
    const executablePath = selectGameExecutablePath(game);
    const isProtocolUrl = executablePath
      ? /^[a-z][a-z\d+.-]*:\/\//i.test(executablePath)
      : false;
    if (!executablePath || isProtocolUrl) {
      if (gameExecutables[game.objectId]) {
        const manifestGame = await findGamePathByProcess(
          processMap,
          winePrefixMap,
          game
        );
        if (manifestGame) {
          detectedGame = manifestGame;
          const process = findProcessForPaths(externalProcesses, [
            manifestGame.nativeExecutablePath ??
              manifestGame.executablePath ??
              "",
          ]);
          if (process) launchedGamePids.set(gameKey, process.pid);
          if (externalLaunch) {
            markExternalGameLaunchSeen(gameKey, process);
          }

          if (gamesPlaytime.has(gameKey)) onTickGame(detectedGame);
          else onOpenGame(detectedGame);
          continue;
        }
      }

      if (externalLaunch) {
        const boundProcess = externalLaunch.boundPid
          ? (externalProcesses.find(
              ({ pid }) => pid === externalLaunch?.boundPid
            ) ?? null)
          : null;

        if (boundProcess) {
          launchedGamePids.set(gameKey, boundProcess.pid);
          markExternalGameLaunchSeen(gameKey, boundProcess);
          if (gamesPlaytime.has(gameKey)) onTickGame(detectedGame);
          else onOpenGame(detectedGame);
          continue;
        }

        const discoveredProcess = discoverExternalLaunchProcess(
          externalLaunch,
          externalProcesses
        );
        if (discoveredProcess) {
          detectedGame = await bindExternalProcessToGame(
            detectedGame,
            discoveredProcess
          );
          launchedGamePids.set(gameKey, discoveredProcess.pid);
          if (gamesPlaytime.has(gameKey)) onTickGame(detectedGame);
          else onOpenGame(detectedGame);
          continue;
        }

        if (
          gamesPlaytime.has(gameKey) &&
          shouldWaitForExternalProcessHandoff(externalLaunch)
        ) {
          continue;
        }
      }

      if (gamesPlaytime.has(gameKey)) onCloseGame(detectedGame);
      continue;
    }

    const trackingPaths = game.trackingExecutablePaths?.filter(Boolean) ?? [];

    let matchPaths: string[];
    if (isWindowsBatchFile(executablePath)) {
      matchPaths = trackingPaths.length ? trackingPaths : [executablePath];
    } else {
      matchPaths = [executablePath, ...trackingPaths];
    }

    let hasProcess = matchPaths.some((matchPath) => {
      const executable = matchPath
        .slice(matchPath.lastIndexOf(platform === "win32" ? "\\" : "/") + 1)
        .toLowerCase();

      const processPaths = processMap.get(executable);
      if (
        processPaths &&
        [...processPaths].some((processPath) =>
          platform === "linux"
            ? path.posix.normalize(processPath) ===
              path.posix.normalize(matchPath)
            : processPath.toLowerCase() === matchPath.toLowerCase()
        )
      ) {
        return true;
      }

      if (platform === "linux") {
        return (
          hasLinuxNativeOrAppImageMatch(matchPath, linuxProcesses) ||
          hasLinuxCompatibilityProcessMatch(game, matchPath, linuxProcesses)
        );
      }

      return false;
    });

    // A moved/re-extracted game or bootstrap executable can leave the library
    // pointing at a path which is not the actual render process. On Windows,
    // repair it only when exactly one same-name process is running in a strict
    // child/parent directory of the configured location. This covers nested
    // repacks without guessing between unrelated generic game.exe processes.
    if (
      !hasProcess &&
      platform === "win32" &&
      !isWindowsBatchFile(executablePath)
    ) {
      const executableName = path.basename(executablePath).toLowerCase();
      const candidates = [...(processMap.get(executableName) ?? [])];
      const previousDirectory = path.dirname(executablePath).toLowerCase();
      const nearbyCandidates = candidates.filter((candidate) => {
        const candidateDirectory = path.dirname(candidate).toLowerCase();
        return (
          candidateDirectory.startsWith(`${previousDirectory}${path.sep}`) ||
          previousDirectory.startsWith(`${candidateDirectory}${path.sep}`)
        );
      });
      // Never fall back to an arbitrary system-wide same-name process. Generic
      // names such as game.exe are common, and persisting the wrong path would
      // silently bind this library entry to another running game.
      if (nearbyCandidates.length === 1) {
        const repairedPath = nearbyCandidates[0];
        const updatedGame = game.nativeExecutablePath
          ? { ...game, nativeExecutablePath: repairedPath }
          : { ...game, executablePath: repairedPath };
        detectedGame = updatedGame;
        hasProcess = true;
        if (!fs.existsSync(executablePath)) {
          await gamesSublevel.put(gameKey, updatedGame);
          logger.info("Repaired moved game executable path", {
            game: gameKey,
            previousPath: executablePath,
            executable: repairedPath,
          });
        } else if (!gamesPlaytime.has(gameKey)) {
          // A valid bootstrap executable may launch a nested render process.
          // Use that process for this session without permanently replacing a
          // still-valid library path.
          logger.info("Detected nested game render executable", {
            game: gameKey,
            configuredPath: executablePath,
            executable: repairedPath,
          });
        }
      }
    }

    if (!hasProcess && platform === "linux") {
      hasProcess = hasLaunchedPidMatch(
        launchedGamePids.get(gameKey),
        executablePath,
        pidToProcess
      );
    }

    if (externalLaunch) {
      const boundProcess = externalLaunch.boundPid
        ? (externalProcesses.find(
            ({ pid }) => pid === externalLaunch?.boundPid
          ) ?? null)
        : null;
      const exactProcess =
        boundProcess ?? findProcessForPaths(externalProcesses, matchPaths);

      if (exactProcess) {
        hasProcess = true;
        launchedGamePids.set(gameKey, exactProcess.pid);
        markExternalGameLaunchSeen(gameKey, exactProcess);
      } else if (hasProcess) {
        // The compact process map proved the executable is alive even if the
        // detailed PID enumeration was unavailable for this tick.
        markExternalGameLaunchSeen(gameKey);
      } else {
        const discoveredProcess = discoverExternalLaunchProcess(
          externalLaunch,
          externalProcesses
        );
        if (discoveredProcess) {
          detectedGame = await bindExternalProcessToGame(
            detectedGame,
            discoveredProcess
          );
          launchedGamePids.set(gameKey, discoveredProcess.pid);
          hasProcess = true;
        } else if (
          gamesPlaytime.has(gameKey) &&
          shouldWaitForExternalProcessHandoff(externalLaunch)
        ) {
          continue;
        }
      }
    }

    if (hasProcess) {
      if (gamesPlaytime.has(gameKey)) {
        onTickGame(detectedGame);
      } else {
        onOpenGame(detectedGame);
      }
    } else if (gamesPlaytime.has(gameKey)) {
      onCloseGame(detectedGame);
    }
  }

  currentTick++;

  if (WindowManager.mainWindow) {
    const gamesRunning = Array.from(gamesPlaytime.entries()).map((entry) => {
      return {
        id: entry[0],
        sessionDurationInMillis: performance.now() - entry[1].firstTick,
      } as Pick<GameRunning, "id" | "sessionDurationInMillis">;
    });

    // Merge emulator games (tracked by their spawned child, not a process scan).
    for (const [id, startedAt] of emulatorRunningGames) {
      if (gamesPlaytime.has(id)) continue;
      gamesRunning.push({
        id,
        sessionDurationInMillis: performance.now() - startedAt,
      } as Pick<GameRunning, "id" | "sessionDurationInMillis">);
    }

    WindowManager.mainWindow.webContents.send("on-games-running", gamesRunning);
  }
};

function onOpenGame(game: Game) {
  const now = performance.now();
  const gameKey = levelKeys.game(game.shop, game.objectId);
  const externalLaunch = getExternalGameLaunch(gameKey);
  const expectedSessionToken = externalLaunch?.cloudSaveSessionToken;
  const cloudSaveSession = externalLaunch
    ? expectedSessionToken
      ? markCloudSaveLaunchSessionRunning(
          game.objectId,
          game.shop,
          expectedSessionToken
        )
      : null
    : markCloudSaveLaunchSessionRunning(game.objectId, game.shop);

  gamesPlaytime.set(gameKey, {
    lastTick: now,
    firstTick: now,
    lastSyncTick: now,
    cloudSaveSessionToken: cloudSaveSession?.token,
  });

  logPlaytimeTrace("session-open", game, {
    performanceNow: now,
  });

  // RetroAchievements live polling for RA-capable emulated games.
  RaWatcherManager.startPolling(game).catch(() => {});

  // Activate the in-game overlay for this session (Shift+F3 / Guide,
  // performance HUD, achievements/friends/notes). No-op when the overlay is
  // disabled in preferences.
  OverlayManager.setActiveGame(game);

  // On Linux, keep the launcher visible briefly and let it auto-close itself.
  if (process.platform !== "linux") {
    WindowManager.closeGameLauncherWindow();
  }

  // Hide Hydra to tray on game startup if enabled
  db.get<string, UserPreferences | null>(levelKeys.userPreferences, {
    valueEncoding: "json",
  })
    .then((userPreferences) => {
      if (userPreferences?.hideToTrayOnGameStart) {
        WindowManager.mainWindow?.hide();
      }
    })
    .catch(() => {});

  // NOTE: no cloud upload here. Automatic sync restores the newest cloud save
  // BEFORE launch (open-game.ts) and uploads on close (onCloseGame below).
  // Uploading at open would push a stale local save over the cloud copy and
  // race the pre-launch restore.

  if (game.shop === "custom") return;

  AchievementWatcherManager.firstSyncWithRemoteIfNeeded(
    game.shop,
    game.objectId
  );

  if (game.remoteId) {
    const deltaToSync = game.unsyncedDeltaPlayTimeInMilliseconds ?? 0;
    const syncTimestamp = new Date();

    logPlaytimeTrace("open-sync-track-request", game, {
      deltaToSync,
      syncTimestamp: syncTimestamp.toISOString(),
    });

    trackGamePlaytime(game, deltaToSync, syncTimestamp)
      .then(() => {
        logPlaytimeTrace("open-sync-track-success", game, {
          deltaToSync,
        });

        gamesSublevel.put(gameKey, {
          ...game,
          unsyncedDeltaPlayTimeInMilliseconds: 0,
        });
      })
      .catch((error) => {
        logPlaytimeTrace("open-sync-track-failed", game, {
          deltaToSync,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  } else {
    const payload = { ...game, lastTimePlayed: new Date() };

    logPlaytimeTrace("open-sync-create-request", payload, {
      syncTimestamp:
        payload.lastTimePlayed instanceof Date
          ? payload.lastTimePlayed.toISOString()
          : payload.lastTimePlayed,
    });

    createGame(payload)
      .then(() => {
        logPlaytimeTrace("open-sync-create-success", payload);
      })
      .catch((error) => {
        logPlaytimeTrace("open-sync-create-failed", payload, {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }
}

function onTickGame(game: Game) {
  const now = performance.now();
  const gamePlaytime = gamesPlaytime.get(
    levelKeys.game(game.shop, game.objectId)
  )!;

  const overlayGame = OverlayManager.getActiveGame();
  if (shouldActivateOverlayGame(overlayGame, game)) {
    // Refresh executable metadata and give a failed shortcut registration a
    // chance to re-arm. A null slot means a newer overlapping game just
    // closed, so this surviving session becomes active again.
    OverlayManager.setActiveGame(game);
  }

  const delta = now - gamePlaytime.lastTick;

  const updatedGame: Game = {
    ...game,
    playTimeInMilliseconds: (game.playTimeInMilliseconds ?? 0) + delta,
    lastTimePlayed: new Date(),
  };

  gamesSublevel.put(levelKeys.game(game.shop, game.objectId), updatedGame);

  gamesPlaytime.set(levelKeys.game(game.shop, game.objectId), {
    ...gamePlaytime,
    lastTick: now,
  });

  if (currentTick % TICKS_TO_UPDATE_API === 0 && game.shop !== "custom") {
    const deltaToSync =
      now -
      gamePlaytime.lastSyncTick +
      (game.unsyncedDeltaPlayTimeInMilliseconds ?? 0);

    logPlaytimeTrace("periodic-sync-request", game, {
      method: game.remoteId ? "track" : "create",
      deltaToSync,
      performanceNow: now,
      lastSyncTick: gamePlaytime.lastSyncTick,
      lastTick: gamePlaytime.lastTick,
    });

    const gamePromise = game.remoteId
      ? trackGamePlaytime(game, deltaToSync, game.lastTimePlayed!)
      : createGame(game);

    gamePromise
      .then(() => {
        logPlaytimeTrace("periodic-sync-success", game, {
          method: game.remoteId ? "track" : "create",
          deltaToSync,
        });

        gamesSublevel.put(levelKeys.game(game.shop, game.objectId), {
          ...updatedGame,
          unsyncedDeltaPlayTimeInMilliseconds: 0,
        });
      })
      .catch((error) => {
        logPlaytimeTrace("periodic-sync-failed", game, {
          method: game.remoteId ? "track" : "create",
          deltaToSync,
          error: error instanceof Error ? error.message : String(error),
        });

        gamesSublevel.put(levelKeys.game(game.shop, game.objectId), {
          ...updatedGame,
          unsyncedDeltaPlayTimeInMilliseconds: deltaToSync,
        });
      })
      .finally(() => {
        gamesPlaytime.set(levelKeys.game(game.shop, game.objectId), {
          ...gamePlaytime,
          lastTick: now,
          lastSyncTick: now,
        });
      });
  }
}

const onCloseGame = (game: Game) => {
  const gameKey = levelKeys.game(game.shop, game.objectId);
  const now = performance.now();
  const gamePlaytime = gamesPlaytime.get(gameKey)!;
  gamesPlaytime.delete(gameKey);
  clearExternalGameLaunch(gameKey);
  launchedGamePids.delete(gameKey);
  PowerSaveBlockerManager.markGameClosed(gameKey);
  RaWatcherManager.stopPolling(game);
  OverlayManager.clearActiveGame(game);

  const delta = now - gamePlaytime.lastTick;

  logPlaytimeTrace("session-close", game, {
    performanceNow: now,
    delta,
    firstTick: gamePlaytime.firstTick,
    lastTick: gamePlaytime.lastTick,
    lastSyncTick: gamePlaytime.lastSyncTick,
  });

  const updatedGame: Game = {
    ...game,
    playTimeInMilliseconds: (game.playTimeInMilliseconds ?? 0) + delta,
    lastTimePlayed: new Date(),
  };

  gamesSublevel.put(gameKey, updatedGame);

  // Resolve disabled | legacy | v2 once and invoke exactly one backend. This
  // runs for every GameShop, including custom and store-URI titles.
  void runAutomaticCloudSaveAfterExit(
    game.objectId,
    game.shop,
    gamePlaytime.cloudSaveSessionToken
  ).catch((error: unknown) => {
    logger.error("[Cloud Save] Automatic post-exit sync failed", {
      shop: game.shop,
      objectId: game.objectId,
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  });

  if (game.shop === "custom") return;

  if (game.remoteId) {
    const deltaToSync =
      now -
      gamePlaytime.lastSyncTick +
      (game.unsyncedDeltaPlayTimeInMilliseconds ?? 0);

    logPlaytimeTrace("close-sync-track-request", game, {
      deltaToSync,
      syncTimestamp:
        game.lastTimePlayed instanceof Date
          ? game.lastTimePlayed.toISOString()
          : game.lastTimePlayed,
    });

    return trackGamePlaytime(game, deltaToSync, game.lastTimePlayed!)
      .then(() => {
        logPlaytimeTrace("close-sync-track-success", game, {
          deltaToSync,
        });

        return gamesSublevel.put(gameKey, {
          ...updatedGame,
          unsyncedDeltaPlayTimeInMilliseconds: 0,
        });
      })
      .catch((error) => {
        logPlaytimeTrace("close-sync-track-failed", game, {
          deltaToSync,
          error: error instanceof Error ? error.message : String(error),
        });

        return gamesSublevel.put(gameKey, {
          ...updatedGame,
          unsyncedDeltaPlayTimeInMilliseconds: deltaToSync,
        });
      });
  } else {
    logPlaytimeTrace("close-sync-create-request", game, {
      syncTimestamp:
        game.lastTimePlayed instanceof Date
          ? game.lastTimePlayed.toISOString()
          : game.lastTimePlayed,
    });

    return createGame(game)
      .then(() => {
        logPlaytimeTrace("close-sync-create-success", game);
      })
      .catch((error) => {
        logPlaytimeTrace("close-sync-create-failed", game, {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }
};

export const clearGamesPlaytime = async () => {
  for (const game of gamesPlaytime.keys()) {
    const gameData = await gamesSublevel.get(game);

    if (gameData) {
      await onCloseGame(gameData);
    }
  }

  gamesPlaytime.clear();
  clearAllExternalGameLaunches();
};
