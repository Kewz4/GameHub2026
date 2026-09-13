import fs from "node:fs";
import path from "node:path";

import { cleanGameFolderName } from "@main/helpers/clean-game-folder-name";
import { normalizeGameTitle } from "@main/helpers/normalize-game-title";

const DEFAULT_MAX_DEPTH = 6;
const DEFAULT_MAX_ENTRIES = 10_000;
const DEFAULT_TIMEOUT_MS = 5_000;

const SUPPORT_DIRECTORY_NAMES = new Set([
  "_commonredist",
  "commonredist",
  "directx",
  "dotnet",
  "easyanticheat",
  "redist",
  "redistributables",
  "support",
  "vcredist",
]);

export interface PostInstallScanLimits {
  maxDepth?: number;
  maxEntries?: number;
  timeoutMs?: number;
}

export type PostInstallExecutableScanResult =
  | { status: "found"; executablePath: string }
  | {
      status: "not-found" | "ambiguous" | "budget-exceeded";
      executablePath: null;
    };

interface ExecutableCandidate {
  absolutePath: string;
  depth: number;
  namePriority: number;
}

const normalizeFolderTitle = (folderName: string) =>
  normalizeGameTitle(cleanGameFolderName(folderName));

export function isPlausibleGameInstallFolder(
  folderName: string,
  gameTitle: string
) {
  const normalizedFolder = normalizeFolderTitle(folderName);
  const normalizedTitle = normalizeGameTitle(gameTitle);

  return normalizedTitle.length > 0 && normalizedFolder === normalizedTitle;
}

/**
 * Lists only immediate, title-matched children of a shared library root. This
 * deliberately avoids recursively searching an entire Games or Program Files
 * tree where generic names such as game.exe and launcher.exe are ambiguous.
 */
export async function findTitleMatchedInstallFolders(
  rootPath: string,
  gameTitle: string
): Promise<string[]> {
  let entries: fs.Dirent[];

  try {
    entries = await fs.promises.readdir(rootPath, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.isSymbolicLink() &&
        isPlausibleGameInstallFolder(entry.name, gameTitle)
    )
    .map((entry) => path.join(rootPath, entry.name));
}

/**
 * Finds an exact known executable within one concrete installation folder.
 * The walk is sequential, permission tolerant, deadline/entry/depth bounded,
 * and never follows symlinks or junctions into unrelated filesystem trees.
 */
export async function findKnownExecutableInInstallFolder(
  rootPath: string,
  executableNames: readonly string[],
  limits: PostInstallScanLimits = {}
): Promise<PostInstallExecutableScanResult> {
  const maxDepth = limits.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxEntries = limits.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const timeoutMs = limits.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  const namePriorities = new Map(
    executableNames.map((name, index) => [name.toLowerCase(), index])
  );

  if (namePriorities.size === 0) {
    return { status: "not-found", executablePath: null };
  }

  const queue: Array<{ directoryPath: string; depth: number }> = [
    { directoryPath: rootPath, depth: 0 },
  ];
  const matches: ExecutableCandidate[] = [];
  let entriesVisited = 0;

  while (queue.length > 0) {
    if (Date.now() > deadline || entriesVisited >= maxEntries) {
      return { status: "budget-exceeded", executablePath: null };
    }

    const current = queue.shift()!;
    let entries: fs.Dirent[];

    try {
      entries = await fs.promises.readdir(current.directoryPath, {
        withFileTypes: true,
      });
    } catch {
      continue;
    }

    for (const entry of entries) {
      entriesVisited += 1;
      if (entriesVisited > maxEntries || Date.now() > deadline) {
        return { status: "budget-exceeded", executablePath: null };
      }

      const absolutePath = path.join(current.directoryPath, entry.name);

      if (entry.isDirectory()) {
        if (
          !entry.isSymbolicLink() &&
          current.depth < maxDepth &&
          !SUPPORT_DIRECTORY_NAMES.has(entry.name.toLowerCase())
        ) {
          queue.push({
            directoryPath: absolutePath,
            depth: current.depth + 1,
          });
        }
        continue;
      }

      if (!entry.isFile()) continue;

      const namePriority = namePriorities.get(entry.name.toLowerCase());
      if (namePriority === undefined) continue;

      matches.push({
        absolutePath,
        depth: current.depth,
        namePriority,
      });
    }
  }

  if (matches.length === 0) {
    return { status: "not-found", executablePath: null };
  }

  matches.sort(
    (left, right) =>
      left.namePriority - right.namePriority ||
      left.depth - right.depth ||
      left.absolutePath.localeCompare(right.absolutePath)
  );

  const best = matches[0];
  const equallyRanked = matches.filter(
    (candidate) =>
      candidate.namePriority === best.namePriority &&
      candidate.depth === best.depth
  );

  if (equallyRanked.length !== 1) {
    return { status: "ambiguous", executablePath: null };
  }

  return { status: "found", executablePath: best.absolutePath };
}

export interface FindPostInstallExecutableOptions {
  gameTitle: string;
  downloadFolderPath: string;
  executableNames: readonly string[];
  sharedLibraryRoots?: readonly string[];
  winePrefixPath?: string | null;
  limits?: PostInstallScanLimits;
}

const existingDirectory = async (candidatePath: string) => {
  try {
    return (await fs.promises.stat(candidatePath)).isDirectory();
  } catch {
    return false;
  }
};

export async function findPostInstallExecutable({
  gameTitle,
  downloadFolderPath,
  executableNames,
  sharedLibraryRoots = [],
  winePrefixPath,
  limits,
}: FindPostInstallExecutableOptions): Promise<PostInstallExecutableScanResult> {
  if (await existingDirectory(downloadFolderPath)) {
    const downloadResult = await findKnownExecutableInInstallFolder(
      downloadFolderPath,
      executableNames,
      limits
    );
    if (downloadResult.status !== "not-found") {
      return downloadResult;
    }
  }

  const candidateRoots = [...sharedLibraryRoots];

  if (winePrefixPath) {
    const driveC = path.join(winePrefixPath, "drive_c");
    candidateRoots.push(
      path.join(driveC, "Games"),
      path.join(driveC, "Program Files"),
      path.join(driveC, "Program Files (x86)")
    );
  }

  const sharedInstallFolders: string[] = [];
  for (const rootPath of candidateRoots) {
    sharedInstallFolders.push(
      ...(await findTitleMatchedInstallFolders(rootPath, gameTitle))
    );
  }

  const uniqueFolders = [
    ...new Map(
      sharedInstallFolders.map((folderPath) => [
        process.platform === "win32"
          ? path.resolve(folderPath).toLowerCase()
          : path.resolve(folderPath),
        folderPath,
      ])
    ).values(),
  ];

  const sharedMatches: string[] = [];
  let sawAmbiguousFolder = false;

  for (const folderPath of uniqueFolders) {
    const result = await findKnownExecutableInInstallFolder(
      folderPath,
      executableNames,
      limits
    );

    if (result.status === "found") {
      sharedMatches.push(result.executablePath);
    }
    if (result.status === "budget-exceeded") return result;
    if (result.status === "ambiguous") sawAmbiguousFolder = true;
  }

  if (sharedMatches.length === 1 && !sawAmbiguousFolder) {
    return { status: "found", executablePath: sharedMatches[0] };
  }

  if (sharedMatches.length > 1 || sawAmbiguousFolder) {
    return { status: "ambiguous", executablePath: null };
  }

  return { status: "not-found", executablePath: null };
}
