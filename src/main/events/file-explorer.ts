import fs from "node:fs";
import path from "node:path";

import { registerEvent } from "./register-event";

const MAX_VISIBLE_ENTRIES = 10_000;

function requireAbsolutePath(input: string) {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error("A file-system path is required");
  }

  return path.resolve(input);
}

registerEvent("readDirectory", async (_event, inputPath: string) => {
  const directoryPath = requireAbsolutePath(inputPath);
  const entries = await fs.promises.readdir(directoryPath, {
    withFileTypes: true,
  });

  const visibleEntries = entries
    .filter((entry) => entry.isDirectory() || entry.isFile())
    .sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) {
        return left.isDirectory() ? -1 : 1;
      }
      return left.name.localeCompare(right.name, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    })
    .slice(0, MAX_VISIBLE_ENTRIES);

  return Promise.all(
    visibleEntries.map(async (entry) => {
      const entryPath = path.join(directoryPath, entry.name);
      const size = entry.isFile()
        ? await fs.promises
            .stat(entryPath)
            .then((stats) => stats.size)
            .catch(() => 0)
        : 0;

      return {
        name: entry.name,
        path: entryPath,
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile(),
        extension: path.extname(entry.name).slice(1).toLowerCase(),
        size,
      };
    })
  );
});

registerEvent("getPathInfo", async (_event, inputPath: string) => {
  const resolvedPath = requireAbsolutePath(inputPath);

  try {
    const stats = await fs.promises.stat(resolvedPath);
    return {
      exists: true,
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile(),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { exists: false, isDirectory: false, isFile: false };
    }
    throw error;
  }
});

registerEvent("listDrives", async () => {
  if (process.platform === "win32") {
    const candidates = Array.from(
      { length: 26 },
      (_, index) => `${String.fromCharCode(65 + index)}:${path.sep}`
    );
    const available = await Promise.all(
      candidates.map(async (candidate) => {
        try {
          await fs.promises.access(candidate, fs.constants.R_OK);
          return candidate;
        } catch {
          return null;
        }
      })
    );
    return available.filter((drive): drive is string => drive !== null);
  }

  if (process.platform === "darwin") {
    const volumes = await fs.promises
      .readdir("/Volumes", { withFileTypes: true })
      .catch(() => []);
    return [
      "/",
      ...volumes
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join("/Volumes", entry.name)),
    ];
  }

  return ["/"];
});
