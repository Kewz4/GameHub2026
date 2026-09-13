import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { inspectSteamEmulatorDirectory } from "./steam-emulator-target";

type RecoveryStatus =
  | "prepared"
  | "applied"
  | "rolled-back"
  | "rollback-incomplete";

interface RecoveryFile {
  relativePath: string;
  backupRelativePath: string;
  size: number;
  sha256: string;
}

export interface SteamEmulatorRecoveryManifest {
  version: 1;
  appId: string;
  gameDir: string;
  createdAt: string;
  status: RecoveryStatus;
  files: RecoveryFile[];
  preexistingArtifacts: string[];
  failureReason?: string;
}

export interface SteamEmulatorRecoveryBackup {
  directory: string;
  manifestPath: string;
  manifest: SteamEmulatorRecoveryManifest;
}

export interface SteamEmulatorRollbackResult {
  complete: boolean;
  reason: string;
}

const normalizeForComparison = (value: string) =>
  process.platform === "win32" ? value.toLowerCase() : value;

const isWithin = (candidate: string, root: string) => {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
};

const sha256File = async (filePath: string) => {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
};

const relativeInside = (gameDir: string, target: string) => {
  const relative = path.relative(gameDir, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Recovery target escaped the game directory");
  }
  return relative;
};

const writeManifest = async (backup: SteamEmulatorRecoveryBackup) => {
  const temporaryPath = path.join(
    backup.directory,
    `.manifest.${process.pid}.${Date.now()}.tmp`
  );
  await fs.promises.writeFile(
    temporaryPath,
    JSON.stringify(backup.manifest, null, 2),
    { encoding: "utf8", flag: "wx" }
  );
  await fs.promises.rename(temporaryPath, backup.manifestPath);
};

const safeBackupLeaf = (gameDir: string, appId: string) => {
  const gameName = path
    .basename(gameDir)
    .replace(/[^a-z0-9._-]+/gi, "-")
    .slice(0, 60);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `steam-emulator-${gameName}-${appId}-${stamp}-${crypto
    .randomBytes(4)
    .toString("hex")}`;
};

/** Create and verify an exclusive, same-volume copy before the CLI runs. */
export const prepareSteamEmulatorRecoveryBackup = async (
  gameDir: string,
  appId: string,
  steamApiDllPaths: string[],
  preexistingArtifactPaths: string[]
): Promise<SteamEmulatorRecoveryBackup> => {
  if (!/^\d+$/.test(appId) || steamApiDllPaths.length === 0) {
    throw new Error("A numeric app id and Steam API files are required");
  }

  const canonicalGameDir = await fs.promises.realpath(gameDir);
  const backupRoot = path.join(
    path.dirname(canonicalGameDir),
    "_gamehub-backups"
  );
  if (
    normalizeForComparison(path.parse(backupRoot).root) !==
      normalizeForComparison(path.parse(canonicalGameDir).root) ||
    isWithin(backupRoot, canonicalGameDir)
  ) {
    throw new Error("A safe same-volume recovery location is unavailable");
  }

  try {
    const rootStat = await fs.promises.lstat(backupRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw new Error("Recovery root is not a regular directory");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await fs.promises.mkdir(backupRoot, { recursive: false });
  }

  const directory = path.join(
    backupRoot,
    safeBackupLeaf(canonicalGameDir, appId)
  );
  await fs.promises.mkdir(directory, { recursive: false });
  const backup: SteamEmulatorRecoveryBackup = {
    directory,
    manifestPath: path.join(directory, "manifest.json"),
    manifest: {
      version: 1,
      appId,
      gameDir: canonicalGameDir,
      createdAt: new Date().toISOString(),
      status: "prepared",
      files: [],
      preexistingArtifacts: preexistingArtifactPaths.map((artifactPath) =>
        relativeInside(canonicalGameDir, artifactPath)
      ),
    },
  };

  try {
    const filesDirectory = path.join(directory, "files");
    await fs.promises.mkdir(filesDirectory, { recursive: false });

    for (const [index, sourcePath] of steamApiDllPaths.entries()) {
      const relativePath = relativeInside(canonicalGameDir, sourcePath);
      const sourceStat = await fs.promises.lstat(sourcePath);
      if (
        !sourceStat.isFile() ||
        sourceStat.isSymbolicLink() ||
        sourceStat.nlink > 1
      ) {
        throw new Error("Steam API file changed before recovery backup");
      }

      const backupRelativePath = path.join(
        "files",
        `${String(index).padStart(3, "0")}-${path.basename(sourcePath)}`
      );
      const backupPath = path.join(directory, backupRelativePath);
      await fs.promises.copyFile(
        sourcePath,
        backupPath,
        fs.constants.COPYFILE_EXCL
      );
      const [sourceHash, backupHash] = await Promise.all([
        sha256File(sourcePath),
        sha256File(backupPath),
      ]);
      const backupStat = await fs.promises.stat(backupPath);
      if (sourceHash !== backupHash || sourceStat.size !== backupStat.size) {
        throw new Error("Steam API recovery copy verification failed");
      }
      backup.manifest.files.push({
        relativePath,
        backupRelativePath,
        size: sourceStat.size,
        sha256: sourceHash,
      });
    }

    await fs.promises.writeFile(
      backup.manifestPath,
      JSON.stringify(backup.manifest, null, 2),
      { encoding: "utf8", flag: "wx" }
    );
    return backup;
  } catch (error) {
    await fs.promises.rm(directory, { recursive: true, force: true });
    throw error;
  }
};

export const markSteamEmulatorRecoveryApplied = async (
  backup: SteamEmulatorRecoveryBackup,
  write: typeof writeManifest = writeManifest
) => {
  backup.manifest.status = "applied";
  delete backup.manifest.failureReason;
  try {
    await write(backup);
  } catch (error) {
    // Do not leave the in-memory manifest in an applied state when its durable
    // publication failed; the caller must treat this as a failed transaction.
    backup.manifest.status = "prepared";
    throw error;
  }
};

export const markSteamEmulatorRollbackIncomplete = async (
  backup: SteamEmulatorRecoveryBackup,
  failureReason: string
) => {
  backup.manifest.status = "rollback-incomplete";
  backup.manifest.failureReason = failureReason;
  await writeManifest(backup);
};

/** Restore originals and remove only artifacts absent from the pre-run scan. */
export const rollbackSteamEmulatorMutation = async (
  backup: SteamEmulatorRecoveryBackup,
  failureReason: string,
  additionalBlockedRoots: string[] = []
): Promise<SteamEmulatorRollbackResult> => {
  let complete = true;
  const errors: string[] = [];
  const canonicalGameDir = await fs.promises.realpath(backup.manifest.gameDir);
  if (
    normalizeForComparison(canonicalGameDir) !==
    normalizeForComparison(backup.manifest.gameDir)
  ) {
    complete = false;
    errors.push("game directory identity changed");
  }

  for (const file of backup.manifest.files) {
    try {
      const destination = path.join(canonicalGameDir, file.relativePath);
      relativeInside(canonicalGameDir, destination);
      const source = path.join(backup.directory, file.backupRelativePath);
      const [sourceHash, sourceStat] = await Promise.all([
        sha256File(source),
        fs.promises.stat(source),
      ]);
      if (sourceHash !== file.sha256 || sourceStat.size !== file.size) {
        throw new Error("backup verification failed");
      }
      await fs.promises.copyFile(source, destination);
      const [restoredHash, restoredStat] = await Promise.all([
        sha256File(destination),
        fs.promises.stat(destination),
      ]);
      if (restoredHash !== file.sha256 || restoredStat.size !== file.size) {
        throw new Error("restore verification failed");
      }
    } catch (error) {
      complete = false;
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  const postInspection = await inspectSteamEmulatorDirectory(
    canonicalGameDir,
    additionalBlockedRoots
  );
  if (!postInspection.ok) {
    complete = false;
    errors.push(postInspection.reason);
  } else {
    const preexisting = new Set(
      backup.manifest.preexistingArtifacts.map(normalizeForComparison)
    );
    const newlyCreated = postInspection.artifactPaths
      .map((artifactPath) => ({
        absolute: artifactPath,
        relative: relativeInside(canonicalGameDir, artifactPath),
      }))
      .filter(
        ({ relative }) => !preexisting.has(normalizeForComparison(relative))
      )
      .sort((left, right) => right.absolute.length - left.absolute.length);

    for (const artifact of newlyCreated) {
      try {
        const stat = await fs.promises.lstat(artifact.absolute);
        if (stat.isSymbolicLink()) throw new Error("new artifact is a link");
        await fs.promises.rm(artifact.absolute, {
          recursive: stat.isDirectory(),
          force: true,
        });
      } catch (error) {
        complete = false;
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  }

  const verification = await inspectSteamEmulatorDirectory(
    canonicalGameDir,
    additionalBlockedRoots
  );
  const remainingNewArtifacts = verification.ok
    ? verification.artifactPaths.filter((artifactPath) => {
        const relative = relativeInside(canonicalGameDir, artifactPath);
        return !backup.manifest.preexistingArtifacts.some(
          (existing) =>
            normalizeForComparison(existing) ===
            normalizeForComparison(relative)
        );
      })
    : [];
  if (!verification.ok || remainingNewArtifacts.length > 0) {
    complete = false;
    errors.push(
      verification.ok
        ? "new emulator artifacts remain after rollback"
        : verification.reason
    );
  }

  backup.manifest.status = complete ? "rolled-back" : "rollback-incomplete";
  backup.manifest.failureReason = failureReason;
  try {
    await writeManifest(backup);
  } catch (error) {
    complete = false;
    errors.push("recovery manifest update failed");
  }

  return {
    complete,
    reason: complete
      ? "Steam emulator mutation was rolled back"
      : `Steam emulator rollback incomplete: ${errors.join("; ")}`,
  };
};
