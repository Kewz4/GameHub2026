import fs from "node:fs/promises";
import path from "node:path";
import type { DiskUsage } from "@types";

const MAX_PARENT_LOOKUPS = 64;

const logDiskUsageError = (message: string, error?: unknown) => {
  // Keep the filesystem reader usable in isolated Node tests and preflight
  // helpers; electron-log itself imports Electron application state.
  void import("./logger")
    .then(({ logger }) => logger.error(message, error))
    .catch(() => undefined);
};

const isMissingPathError = (error: unknown) =>
  (error as NodeJS.ErrnoException).code === "ENOENT";

const resolveExistingPath = async (targetPath: string) => {
  let currentPath = path.resolve(targetPath);

  for (let lookup = 0; lookup < MAX_PARENT_LOOKUPS; lookup += 1) {
    try {
      await fs.access(currentPath);
      return currentPath;
    } catch (error) {
      if (!isMissingPathError(error)) return null;

      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) return null;

      currentPath = parentPath;
    }
  }

  return null;
};

/**
 * Reads the filesystem directly instead of spawning PowerShell/WMI. Only a
 * missing path climbs to an existing parent; unreadable or detached volumes
 * remain unknown so callers never mistake them for a full disk.
 */
export const getDiskUsage = async (
  targetPath: string
): Promise<DiskUsage | null> => {
  const existingPath = await resolveExistingPath(targetPath);

  if (!existingPath) {
    logDiskUsageError(
      `[DiskUsage] No existing path to measure for ${targetPath}`
    );
    return null;
  }

  try {
    const stats = await fs.statfs(existingPath);
    const blockSize = Number(stats.bsize);
    const free = Number(stats.bavail) * blockSize;
    const total = Number(stats.blocks) * blockSize;

    if (!Number.isFinite(free) || !Number.isFinite(total) || total <= 0) {
      logDiskUsageError(
        `[DiskUsage] Unusable statfs result for ${existingPath}: bsize=${stats.bsize}, bavail=${stats.bavail}, blocks=${stats.blocks}`
      );
      return null;
    }

    return { free: Math.max(0, free), total };
  } catch (error) {
    logDiskUsageError(`[DiskUsage] Failed to read ${existingPath}`, error);
    return null;
  }
};
