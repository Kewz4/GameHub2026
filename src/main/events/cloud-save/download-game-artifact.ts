import {
  CloudSync,
  UploadcareSync,
  logger,
  WindowManager,
  Wine,
  resolveSaveBackupPlan,
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
import {
  resolveEmulatorRestorePatterns,
  systemForGame,
} from "@main/services/emulators/emulator-save-dirs";
import {
  assertNoRegistryRestorePayload,
  commitSaveRestoreJobs,
  planSaveRestoreJobs,
} from "./restore-path-safety";

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
 * Restore a Ludusavi backup ATOMICALLY (all-or-nothing), inspired by Hydra
 * PR #2538's native staged restore. The old code deleted each existing save
 * BEFORE moving the replacement in, with no rollback — so a crash, full disk,
 * or one bad file mid-restore could destroy saves and leave an inconsistent
 * mix of old/new files. Now: every existing target is moved aside to a backup
 * first, replacements are committed one by one, and if ANY file fails the whole
 * set rolls back (installed files removed, backups restored). Backups are only
 * deleted once the entire set commits.
 */
const restoreLudusaviBackup = (
  backupPath: string,
  title: string,
  homeDir: string,
  winePrefixPath?: string | null,
  artifactWinePrefixPath?: string | null,
  allowedDestinationPaths: readonly string[] = []
) => {
  const gameBackupPath = path.join(backupPath, title);
  const mappingYamlPath = path.join(gameBackupPath, "mapping.yaml");

  const data = fs.readFileSync(mappingYamlPath, "utf8");
  const manifest = YAML.parse(data) as {
    backups: LudusaviBackupMapping[];
    drives: Record<string, string>;
  };
  assertNoRegistryRestorePayload(gameBackupPath, manifest.backups);

  const userProfilePath =
    CloudSync.getWindowsLikeUserProfilePath(winePrefixPath);

  // 1. Resolve every (source, destination) pair up front, rejecting anything
  //    with a `..` traversal segment (artifacts can be authored on another
  //    machine — never let one write outside its resolved target).
  const unplannedJobs: { sourcePath: string; destinationPath: string }[] = [];
  const hasTraversal = (p: string) =>
    p.split(/[\\/]/).some((seg) => seg === "..");

  manifest.backups.forEach((backup) => {
    Object.keys(backup.files).forEach((key) => {
      const sourcePathWithDrives = Object.entries(manifest.drives).reduce(
        (prev, [driveKey, driveValue]) => prev.replace(driveValue, driveKey),
        key
      );
      if (hasTraversal(sourcePathWithDrives) || hasTraversal(key)) {
        throw new Error(`Unsafe path-traversal entry in save artifact: ${key}`);
      }

      const sourcePath = path.join(gameBackupPath, sourcePathWithDrives);
      const destinationPath = transformLudusaviBackupPathIntoWindowsPath(
        key,
        artifactWinePrefixPath
      )
        .replace(
          homeDir,
          addWinePrefixToWindowsPath(userProfilePath, winePrefixPath)
        )
        .replace(
          publicProfilePath,
          addWinePrefixToWindowsPath(publicProfilePath, winePrefixPath)
        );
      if (fs.existsSync(sourcePath)) {
        unplannedJobs.push({ sourcePath, destinationPath });
      }
    });
  });
  const jobs = planSaveRestoreJobs(
    unplannedJobs,
    allowedDestinationPaths,
    gameBackupPath
  );
  commitSaveRestoreJobs(jobs, {
    onInstall: ({ sourcePath, destinationPath }) =>
      logger.info(`Restoring ${sourcePath} -> ${destinationPath}`),
    onRollbackError: (destinationPath, error) =>
      logger.error(`Rollback failed for ${destinationPath}`, error),
  });
};

/**
 * Download + restore a cloud save artifact into the game's save locations.
 * Shared by the manual restore IPC and the automatic pre-launch restore.
 * Returns true on success.
 */
export const restoreGameArtifact = async (
  objectId: string,
  shop: GameShop,
  gameArtifactId: string // R2 object key
): Promise<boolean> => {
  try {
    const game = await gamesSublevel.get(levelKeys.game(shop, objectId));
    const effectiveWinePrefixPath = Wine.getEffectivePrefixPath(
      game?.winePrefixPath,
      objectId
    );
    const currentHomeDir = normalizePath(
      CloudSync.getWindowsLikeUserProfilePath(effectiveWinePrefixPath)
    );
    const artifactMetadata =
      await UploadcareSync.getSaveArtifactRestoreMetadata(gameArtifactId);

    const plan = await resolveSaveBackupPlan(shop, objectId);
    let allowedDestinationPaths =
      plan.status === "ready" && plan.paths.length > 0 ? plan.paths : [];
    if (
      allowedDestinationPaths.length === 0 &&
      (await systemForGame(shop, objectId))
    ) {
      allowedDestinationPaths = await resolveEmulatorRestorePatterns(
        shop,
        objectId
      );
    }
    if (allowedDestinationPaths.length === 0) {
      throw new Error(
        plan.status === "unresolved"
          ? plan.reason
          : "No current per-game save destination is available for this artifact."
      );
    }

    // gameArtifactId is now an R2 object key (e.g. "users/x/saves/steam/1/..tar")
    // which contains slashes — sanitize before using it as a local filename so
    // we don't try to write into non-existent nested directories.
    const safeArtifactName = gameArtifactId.replace(/[^a-zA-Z0-9._-]/g, "_");
    const zipLocation = path.join(
      SystemPath.getPath("userData"),
      `${safeArtifactName}.tar`
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
      artifactMetadata.homeDir
        ? normalizePath(artifactMetadata.homeDir)
        : currentHomeDir,
      effectiveWinePrefixPath,
      artifactMetadata.winePrefixPath ?? effectiveWinePrefixPath,
      allowedDestinationPaths
    );

    fs.unlinkSync(zipLocation);

    try {
      fs.rmSync(backupPath, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }

    WindowManager.mainWindow?.webContents.send(
      `on-backup-download-complete-${objectId}-${shop}`,
      true
    );
    return true;
  } catch (err) {
    logger.error("Failed to download game artifact", err);
    WindowManager.mainWindow?.webContents.send(
      `on-backup-download-complete-${objectId}-${shop}`,
      false
    );
    return false;
  }
};

const downloadGameArtifact = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop,
  gameArtifactId: string
) => restoreGameArtifact(objectId, shop, gameArtifactId);

registerEvent("downloadGameArtifact", downloadGameArtifact);
