import fs from "node:fs/promises";
import path from "node:path";

/** One directory only; symlink targets are classified, never recursively
 * walked. Keep the selected symlink path so Steam/emulator aliases work. */
export const readFileExplorerDirectory = async (directoryPath: string) => {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  const resolved: Array<{
    name: string;
    path: string;
    isDirectory: boolean;
    isFile: boolean;
    extension: string;
    size: number;
  }> = [];
  // Bound metadata I/O concurrency on large mounted libraries.
  for (let start = 0; start < entries.length; start += 32) {
    const batch = await Promise.all(
      entries.slice(start, start + 32).map(async (entry) => {
        if (!entry.isDirectory() && !entry.isFile() && !entry.isSymbolicLink())
          return null;
        const entryPath = path.join(directoryPath, entry.name);
        try {
          const stats = await fs.stat(entryPath);
          if (!stats.isDirectory() && !stats.isFile()) return null;
          return {
            name: entry.name,
            path: entryPath,
            isDirectory: stats.isDirectory(),
            isFile: stats.isFile(),
            extension: path.extname(entry.name).slice(1).toLowerCase(),
            size: stats.isFile() ? stats.size : 0,
          };
        } catch {
          // Broken links or entries removed while the directory was loading.
          return null;
        }
      })
    );
    resolved.push(
      ...batch.filter(
        (entry): entry is NonNullable<typeof entry> => entry !== null
      )
    );
  }
  return resolved
    .sort((left, right) => {
      if (left.isDirectory !== right.isDirectory)
        return left.isDirectory ? -1 : 1;
      return left.name.localeCompare(right.name, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    })
    .slice(0, 10_000);
};
