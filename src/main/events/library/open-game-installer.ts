import { shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";

import { getDownloadsPath } from "../helpers/get-downloads-path";
import { discoverGameLibraryRoots } from "@main/helpers/scan-executables";
import { registerEvent } from "../register-event";
import { downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { GameShop } from "@types";
import {
  GameExecutables,
  logger,
  Umu,
  WindowManager,
  Wine,
} from "@main/services";
import { runAutomaticCloudSaveSync } from "@main/services/cloud-save";
import { enqueueGameRecordMutation } from "./game-record-mutation-queue";
import { findPostInstallExecutable } from "./post-install-executable-scan";

interface InstallerLaunchResult {
  launched: boolean;
  observesExit: boolean;
}

type InstallerExitHandler = (
  code: number | null,
  signal: NodeJS.Signals | null
) => void;

const UNTRACKED_INSTALL_RESCAN_DELAYS_MS = [
  30_000, 120_000, 600_000, 1_800_000,
];

const getSharedInstallRoots = () => {
  const roots = discoverGameLibraryRoots();

  if (process.platform === "win32") {
    roots.push(
      ...[
        process.env["ProgramFiles"],
        process.env["ProgramFiles(x86)"],
        process.env["LOCALAPPDATA"]
          ? path.join(process.env["LOCALAPPDATA"], "Programs")
          : undefined,
      ].filter((candidate): candidate is string => Boolean(candidate))
    );
  }

  return [...new Set(roots)];
};

const rescanAndBindExecutableAfterInstall = async (
  shop: GameShop,
  objectId: string,
  downloadFolderPath: string,
  winePrefixPath?: string | null
) => {
  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey).catch(() => null);

  if (!game || game.executablePath) return false;

  const executableNames = GameExecutables.getExecutablesForGame(objectId);
  if (!executableNames?.length) {
    logger.info("Post-install executable scan skipped: no known executables", {
      gameKey,
    });
    return false;
  }

  const result = await findPostInstallExecutable({
    gameTitle: game.title,
    downloadFolderPath,
    executableNames,
    sharedLibraryRoots: getSharedInstallRoots(),
    winePrefixPath,
  });

  if (result.status !== "found") {
    logger.info("Post-install executable scan completed without a safe match", {
      gameKey,
      status: result.status,
    });
    return false;
  }

  const bound = await enqueueGameRecordMutation(gameKey, async () => {
    const currentGame = await gamesSublevel.get(gameKey).catch(() => null);

    // A manual selection made while the installer or scan was running always
    // wins. This mutation shares a queue with updateExecutablePath.
    if (!currentGame || currentGame.executablePath) return false;

    await gamesSublevel.put(gameKey, {
      ...currentGame,
      executablePath: result.executablePath,
      nativeExecutablePath: result.executablePath,
      isInstalledLocally: true,
    });
    return true;
  });

  if (!bound) return false;

  logger.info("Bound executable detected after installer completion", {
    gameKey,
    executablePath: result.executablePath,
  });
  WindowManager.sendToAppWindows("on-library-batch-complete");
  void runAutomaticCloudSaveSync(objectId, shop, "environment-changed").catch(
    (error) => {
      logger.error("Post-install cloud-save environment refresh failed", {
        gameKey,
        error,
      });
    }
  );
  return true;
};

const scheduleUntrackedInstallRescans = (scan: () => Promise<boolean>) => {
  let finished = false;

  for (const delay of UNTRACKED_INSTALL_RESCAN_DELAYS_MS) {
    const timer = setTimeout(() => {
      if (finished) return;
      void scan()
        .then((bound) => {
          finished ||= bound;
        })
        .catch((error) => {
          logger.error("Scheduled post-install executable scan failed", error);
        });
    }, delay);
    timer.unref();
  }
};

const launchInstallerWithWine = async (
  filePath: string,
  onExit?: InstallerExitHandler
): Promise<InstallerLaunchResult> => {
  const launched = await new Promise<boolean>((resolve) => {
    let resolved = false;
    const child = spawn("wine", [filePath], {
      detached: true,
      stdio: "ignore",
      shell: false,
    });

    child.once("spawn", () => {
      resolved = true;
      child.unref();
      resolve(true);
    });

    child.once("exit", (code, signal) => {
      if (resolved) onExit?.(code, signal);
    });

    child.once("error", (error) => {
      logger.error("Failed to execute game installer with wine", error);
      if (!resolved) resolve(false);
    });
  });

  return { launched, observesExit: launched };
};

const launchInstallerDirectly = async (
  filePath: string,
  onExit?: InstallerExitHandler
): Promise<InstallerLaunchResult> => {
  const launched = await new Promise<boolean>((resolve) => {
    let resolved = false;
    const child = spawn(filePath, [], {
      detached: true,
      stdio: "ignore",
      shell: false,
    });

    child.once("spawn", () => {
      resolved = true;
      child.unref();
      resolve(true);
    });

    child.once("exit", (code, signal) => {
      if (resolved) onExit?.(code, signal);
    });

    child.once("error", (error) => {
      logger.error("Failed to execute game installer directly", error);
      if (!resolved) resolve(false);
    });
  });

  return { launched, observesExit: launched };
};

const openPathAndCheck = async (
  filePath: string
): Promise<InstallerLaunchResult> => {
  const openError = await shell.openPath(filePath);
  return { launched: openError.length === 0, observesExit: false };
};

const executeGameInstaller = async (
  filePath: string,
  options?: {
    gameId?: string;
    winePrefixPath?: string | null;
    protonPath?: string | null;
    onExit?: InstallerExitHandler;
  }
): Promise<InstallerLaunchResult> => {
  if (process.platform === "win32") {
    const directLaunch = await launchInstallerDirectly(
      filePath,
      options?.onExit
    );
    if (directLaunch.launched) {
      return directLaunch;
    }

    return await openPathAndCheck(filePath);
  }

  if (process.platform === "linux") {
    try {
      await Umu.launchExecutable(filePath, [], {
        gameId: options?.gameId,
        winePrefixPath: options?.winePrefixPath,
        protonPath: options?.protonPath,
        onExit: options?.onExit,
      });
      return { launched: true, observesExit: true };
    } catch (error) {
      logger.error("Failed to execute game installer with umu-run", error);

      const wineLaunch = await launchInstallerWithWine(
        filePath,
        options?.onExit
      );
      if (wineLaunch.launched) {
        return wineLaunch;
      }

      return await openPathAndCheck(filePath);
    }
  }

  return await openPathAndCheck(filePath);
};

const openGameInstaller = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const downloadKey = levelKeys.game(shop, objectId);
  const download = await downloadsSublevel.get(downloadKey);
  const game = await gamesSublevel.get(downloadKey).catch(() => null);
  const effectiveWinePrefixPath = Wine.getEffectivePrefixPath(
    game?.winePrefixPath,
    objectId
  );

  if (!download?.folderName) return true;

  const gamePath = path.join(
    download.downloadPath ?? (await getDownloadsPath()),
    download.folderName
  );

  if (!fs.existsSync(gamePath)) {
    return true;
  }

  if (process.platform === "darwin") {
    shell.openPath(gamePath);
    return true;
  }

  if (fs.lstatSync(gamePath).isFile()) {
    shell.showItemInFolder(gamePath);
    return true;
  }

  const setupPath = path.join(gamePath, "setup.exe");
  const runPostInstallScan = () =>
    rescanAndBindExecutableAfterInstall(
      shop,
      objectId,
      gamePath,
      effectiveWinePrefixPath
    );
  const onInstallerExit: InstallerExitHandler = () => {
    void runPostInstallScan().catch((error) => {
      logger.error("Post-install executable scan failed", {
        gameKey: downloadKey,
        error,
      });
    });
  };

  let launchResult: InstallerLaunchResult | null = null;

  if (fs.existsSync(setupPath)) {
    launchResult = await executeGameInstaller(setupPath, {
      gameId: objectId,
      winePrefixPath: effectiveWinePrefixPath,
      protonPath: game?.protonPath,
      onExit: onInstallerExit,
    });
  } else {
    const gamePathFileNames = fs.readdirSync(gamePath);
    const gamePathExecutableFiles = gamePathFileNames.filter(
      (fileName: string) => path.extname(fileName).toLowerCase() === ".exe"
    );

    if (gamePathExecutableFiles.length === 1) {
      launchResult = await executeGameInstaller(
        path.join(gamePath, gamePathExecutableFiles[0]),
        {
          gameId: objectId,
          winePrefixPath: effectiveWinePrefixPath,
          protonPath: game?.protonPath,
          onExit: onInstallerExit,
        }
      );
    }
  }

  if (launchResult) {
    if (launchResult.launched && !launchResult.observesExit) {
      scheduleUntrackedInstallRescans(runPostInstallScan);
    }
    return launchResult.launched;
  }

  await shell.openPath(gamePath);
  return true;
};

registerEvent("openGameInstaller", openGameInstaller);
