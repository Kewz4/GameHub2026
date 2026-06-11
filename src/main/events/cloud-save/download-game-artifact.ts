import {
  CloudSync,
  UploadcareSync,
  logger,
  WindowManager,
  Wine,
} from "@main/services";
import fs from "node:fs";
import * as tar from "tar";
import { registerEvent } from "../register-event";
import path from "node:path";
import { backupsPath, publicProfilePath } from "@main/constants";
import type { GameShop, LudusaviBackupMapping } from "@types";
import { gamesSublevel, levelKeys } from "@main/level";

import YAML from "yaml";
import { addTrailingSlash, normalizePath } from "@main/helpers";
import { SystemPath } from "@main/services/system-path";

export const transformLudusaviBackupPathIntoWindowsPath = (
  backupPath: string,
  winePrefixPath?: string | null
) => {
  return backupPath
    .replace(winePrefixPath ? addTrailingSlash(winePrefixPath) : "", "")
    .replace("drive_c", "C:");
};

export const addWinePrefixToWindowsPath = (
  windowsPath: string,
  winePrefixPath?: string | null
) => {
  if (!winePrefixPath) return windowsPath;
  return path.join(winePrefixPath, windowsPath.replace("C:", "drive_c"));
};

/**
 * Backups store absolute paths from the machine that created them. If the
 * destination's drive doesn't exist here (e.g. backup says E:\ but the game
 * lives on D:\), remap onto the game's current install dir — or at least onto
 * a drive that exists.
 */
const remapMissingDrive = (
  destinationPath: string,
  executablePath?: string | null
): string => {
  const root = path.parse(destinationPath).root; // e.g. "E:\"
  if (!root || fs.existsSync(root)) return destinationPath;
  if (!executablePath) return destinationPath;

  const exeDir = path.dirname(executablePath);

  // If the destination contains the game's current folder name, graft the
  // remainder onto the local install dir:
  //   E:\Games\Neon Abyss\SavesDir + D:\Stuff\Neon Abyss\game.exe
  //   → D:\Stuff\Neon Abyss\SavesDir
  const gameFolder = path.basename(exeDir).toLowerCase();
  const destSegments = destinationPath.split(/[\\/]/);
  const idx = destSegments.findIndex((s) => s.toLowerCase() === gameFolder);
  if (idx !== -1) {
    return path.join(exeDir, ...destSegments.slice(idx + 1));
  }

  // Otherwise just swap the dead drive for the game's drive
  const exeRoot = path.parse(exeDir).root;
  return path.join(exeRoot, destinationPath.slice(root.length));
};

const restoreLudusaviBackup = (
  backupPath: string,
  title: string,
  homeDir: string,
  winePrefixPath?: string | null,
  artifactWinePrefixPath?: string | null,
  executablePath?: string | null
) => {
  const gameBackupPath = path.join(backupPath, title);
  const mappingYamlPath = path.join(gameBackupPath, "mapping.yaml");

  const data = fs.readFileSync(mappingYamlPath, "utf8");
  const manifest = YAML.parse(data) as {
    backups: LudusaviBackupMapping[];
    drives: Record<string, string>;
  };

  const userProfilePath =
    CloudSync.getWindowsLikeUserProfilePath(winePrefixPath);

  manifest.backups.forEach((backup) => {
    Object.keys(backup.files).forEach((key) => {
      const sourcePathWithDrives = Object.entries(manifest.drives).reduce(
        (prev, [driveKey, driveValue]) => prev.replace(driveValue, driveKey),
        key
      );

      const sourcePath = path.join(gameBackupPath, sourcePathWithDrives);
      logger.info(`Source path: ${sourcePath}`);

      const destinationPath = remapMissingDrive(
        transformLudusaviBackupPathIntoWindowsPath(key, artifactWinePrefixPath)
          .replace(
            homeDir,
            addWinePrefixToWindowsPath(userProfilePath, winePrefixPath)
          )
          .replace(
            publicProfilePath,
            addWinePrefixToWindowsPath(publicProfilePath, winePrefixPath)
          ),
        executablePath
      );

      logger.info(`Moving ${sourcePath} to ${destinationPath}`);
      try {
        fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
        if (fs.existsSync(destinationPath)) fs.unlinkSync(destinationPath);
        try {
          fs.renameSync(sourcePath, destinationPath);
        } catch {
          // Cross-filesystem fallback
          fs.copyFileSync(sourcePath, destinationPath);
          fs.unlinkSync(sourcePath);
        }
      } catch (err) {
        // Don't abort the whole restore because one file's destination is
        // unreachable on this machine
        logger.error(`Failed to restore ${destinationPath}`, err);
      }
    });
  });
};

const downloadGameArtifact = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop,
  gameArtifactId: string // Uploadcare UUID
) => {
  try {
    const game = await gamesSublevel.get(levelKeys.game(shop, objectId));
    const effectiveWinePrefixPath = Wine.getEffectivePrefixPath(
      game?.winePrefixPath,
      objectId
    );

    const zipLocation = path.join(
      SystemPath.getPath("userData"),
      `${gameArtifactId}.tar`
    );
    const backupPath = path.join(backupsPath, `${shop}-${objectId}`);

    if (fs.existsSync(backupPath)) {
      fs.rmSync(backupPath, { recursive: true, force: true });
    }

    WindowManager.mainWindow?.webContents.send(
      `on-backup-download-progress-${objectId}-${shop}`,
      { loaded: 0, total: 1 }
    );

    await UploadcareSync.downloadFile(gameArtifactId, zipLocation);

    WindowManager.mainWindow?.webContents.send(
      `on-backup-download-progress-${objectId}-${shop}`,
      { loaded: 1, total: 1 }
    );

    fs.mkdirSync(backupPath, { recursive: true });

    await tar.x({ file: zipLocation, cwd: backupPath });

    // The tar was created with cwd=backupPath and contains a subdirectory named
    // after the game's canonical ludusavi title (NOT the objectId). Find it.
    const gameFolderName = (() => {
      try {
        const entries = fs.readdirSync(backupPath, { withFileTypes: true });
        const dir = entries.find((e) => e.isDirectory());
        return dir?.name ?? objectId;
      } catch {
        return objectId;
      }
    })();

    restoreLudusaviBackup(
      backupPath,
      gameFolderName,
      normalizePath(
        CloudSync.getWindowsLikeUserProfilePath(effectiveWinePrefixPath)
      ),
      effectiveWinePrefixPath,
      effectiveWinePrefixPath,
      game?.executablePath
    );

    fs.unlinkSync(zipLocation);

    try { fs.rmSync(backupPath, { recursive: true, force: true }); } catch {}

    WindowManager.mainWindow?.webContents.send(
      `on-backup-download-complete-${objectId}-${shop}`,
      true
    );
  } catch (err) {
    logger.error("Failed to download game artifact", err);
    WindowManager.mainWindow?.webContents.send(
      `on-backup-download-complete-${objectId}-${shop}`,
      false
    );
  }
};

registerEvent("downloadGameArtifact", downloadGameArtifact);
