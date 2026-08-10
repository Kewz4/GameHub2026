import { registerEvent } from "../register-event";
import { launchedGamePids, logger, Wine, emulators } from "@main/services";
import { gamesSublevel, levelKeys } from "@main/level";
import { GameShop } from "@types";
import path from "node:path";
import { NativeAddon } from "@main/services/native-addon";
import { processReferencesExecutable } from "@main/services/linux-process-match";
import { isWindowsBatchFile } from "@main/helpers/windows-batch-command";
import { requestGameProcessTermination } from "./close-game-process";

const systemRoot = process.env.SystemRoot ?? String.raw`C:\Windows`;
const taskkillDirectory = path.join(systemRoot, "System32");
const taskkillExecutable = path.join(taskkillDirectory, "taskkill.exe");

const closeGame = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  // Emulator games run in a child process we track directly — kill that first.
  if (emulators.closeEmulatorSession(shop, objectId)) return true;

  const processes = await NativeAddon.listProcesses();

  const game = await gamesSublevel.get(levelKeys.game(shop, objectId));

  if (!game) return false;

  const launchedPid = launchedGamePids.get(levelKeys.game(shop, objectId));
  const trackingPaths = game.trackingExecutablePaths?.filter(Boolean) ?? [];
  const targetPaths = [
    game.nativeExecutablePath,
    ...(game.executablePath &&
    !isWindowsBatchFile(game.executablePath) &&
    !/^[a-z][a-z\d+.-]*:\/\//i.test(game.executablePath)
      ? [game.executablePath]
      : []),
    ...trackingPaths,
  ].filter((targetPath): targetPath is string => Boolean(targetPath));

  const gameProcesses = processes.filter((runningProcess) => {
    if (runningProcess.pid === launchedPid) return true;

    const matchesTargetPath = targetPaths.some((targetPath) => {
      if (process.platform === "linux") {
        return processReferencesExecutable(
          {
            cwd: runningProcess.cwd,
            exe: runningProcess.exe,
            appImagePath: runningProcess.environ?.APPIMAGE,
          },
          targetPath
        );
      }

      return (
        !!runningProcess.exe &&
        path.normalize(runningProcess.exe).toLowerCase() ===
          path.normalize(targetPath).toLowerCase()
      );
    });

    if (matchesTargetPath) return true;

    return false;
  });

  const linuxFallbackProcess =
    process.platform === "linux" &&
    !gameProcesses.length &&
    game.executablePath?.toLowerCase().endsWith(".exe")
      ? processes.find((runningProcess) => {
          const processCwd = runningProcess.cwd?.toLowerCase();
          const gameDirectory = path
            .dirname(game.executablePath!)
            .toLowerCase();

          if (!processCwd || processCwd !== gameDirectory) {
            return false;
          }

          const expectedPrefix = Wine.getEffectivePrefixPath(
            game.winePrefixPath,
            game.objectId
          )?.toLowerCase();
          const processPrefix =
            runningProcess.environ?.STEAM_COMPAT_DATA_PATH?.toLowerCase();

          if (
            expectedPrefix &&
            processPrefix &&
            processPrefix !== expectedPrefix
          ) {
            return false;
          }

          return runningProcess.exe?.toLowerCase().includes("wine") ?? false;
        })
      : null;

  const fallbackProcesses = linuxFallbackProcess ? [linuxFallbackProcess] : [];
  const processesToClose = gameProcesses.length
    ? gameProcesses
    : fallbackProcesses;

  const requests = processesToClose.map((processToClose) => {
    const result = requestGameProcessTermination(processToClose.pid, {
      platform: process.platform,
      taskkillExecutable,
      taskkillWorkingDirectory: taskkillDirectory,
      kill: (pid) => process.kill(pid),
      launchElevated: (executable, parameters, workingDirectory) =>
        NativeAddon.launchElevated(executable, parameters, workingDirectory),
    });
    if (!result.requested) {
      logger.error("Could not request game process termination", {
        pid: processToClose.pid,
      });
    }
    return result.requested;
  });

  return requests.length > 0 && requests.every(Boolean);
};

registerEvent("closeGame", closeGame);
