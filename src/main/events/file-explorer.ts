import fs from "node:fs";
import path from "node:path";

import { registerEvent } from "./register-event";
import { readFileExplorerDirectory } from "../helpers/read-file-explorer-directory";

function requireAbsolutePath(input: string) {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error("A file-system path is required");
  }

  return path.resolve(input);
}

registerEvent("readDirectory", async (_event, inputPath: string) => {
  const directoryPath = requireAbsolutePath(inputPath);
  return readFileExplorerDirectory(directoryPath);
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
