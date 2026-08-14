import fs from "node:fs";
import path from "node:path";

import type { Game } from "@types";
import { isOfflinePlaySetupEligible } from "@shared";

const MAX_TREE_ENTRIES = 20_000;
const MAX_TREE_DEPTH = 16;
const DEVICE_OR_UNC_PATH_PATTERN = /^(?:\\\\[?.]\\|\\\\)/;
const STEAM_API_NAMES = new Set(["steam_api.dll", "steam_api64.dll"]);
const ARTIFACT_FILE_NAMES = new Set([
  "steam_api.rne",
  "steam_api64.rne",
  "steam_api.dll.bak",
  "steam_api64.dll.bak",
  "steam_emu.ini",
  "smartsteamemu.ini",
  "smartsteamemu64.ini",
  "cream_api.ini",
]);
const ARTIFACT_DIRECTORY_NAMES = new Set(["steam_settings"]);

const isArtifactFileName = (name: string, siblingNames: Set<string>) =>
  ARTIFACT_FILE_NAMES.has(name) ||
  (name.endsWith(".exe.bak") && siblingNames.has(name.slice(0, -4)));

export interface SteamEmulatorDirectoryInspection {
  ok: boolean;
  reason: string;
  gameDir?: string;
  steamApiDllPaths: string[];
  artifactPaths: string[];
}

export interface SteamEmulatorTargetResult
  extends SteamEmulatorDirectoryInspection {
  executablePath?: string;
}

const canonicalizeExisting = async (value: string) =>
  fs.promises.realpath(value);

const normalizeForComparison = (value: string) =>
  process.platform === "win32" ? value.toLowerCase() : value;

const isWithin = (candidate: string, root: string) => {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
};

const rejectedInspection = (
  reason: string
): SteamEmulatorDirectoryInspection => ({
  ok: false,
  reason,
  steamApiDllPaths: [],
  artifactPaths: [],
});

const validateDirectoryBoundary = async (
  candidate: string,
  additionalBlockedRoots: string[]
): Promise<SteamEmulatorDirectoryInspection | string> => {
  if (
    !candidate ||
    !path.win32.isAbsolute(candidate) ||
    DEVICE_OR_UNC_PATH_PATTERN.test(candidate)
  ) {
    return "A local drive game directory is required";
  }

  let stat: fs.Stats;
  let lexicalStat: fs.Stats;
  try {
    [stat, lexicalStat] = await Promise.all([
      fs.promises.stat(candidate),
      fs.promises.lstat(candidate),
    ]);
  } catch {
    return "Game directory does not exist";
  }
  if (!stat.isDirectory()) return "Game directory is not a directory";
  if (lexicalStat.isSymbolicLink()) {
    return "Linked game directories cannot be modified";
  }

  const gameDir = await canonicalizeExisting(candidate);
  const driveRoot = path.parse(gameDir).root;
  if (
    normalizeForComparison(gameDir) === normalizeForComparison(driveRoot) ||
    normalizeForComparison(path.dirname(gameDir)) ===
      normalizeForComparison(driveRoot)
  ) {
    return "Drive roots and broad collection roots cannot be modified";
  }

  const environmentRoots = [
    process.env.WINDIR,
    process.env.ProgramFiles,
    process.env["ProgramFiles(x86)"],
    process.env.ProgramData,
  ];
  const blockedRoots: string[] = [];
  for (const value of [...environmentRoots, ...additionalBlockedRoots]) {
    if (!value?.trim() || !path.win32.isAbsolute(value)) continue;
    try {
      blockedRoots.push(await canonicalizeExisting(value));
    } catch {
      // A non-existent optional block root cannot contain the target.
    }
  }
  if (blockedRoots.some((root) => isWithin(gameDir, root))) {
    return "System and launcher directories cannot be modified";
  }

  const userRoot = process.env.USERPROFILE?.trim();
  if (userRoot) {
    const broadUserRoots = [
      userRoot,
      path.join(userRoot, "Desktop"),
      path.join(userRoot, "Documents"),
      path.join(userRoot, "Downloads"),
    ];
    for (const root of broadUserRoots) {
      try {
        if (
          normalizeForComparison(gameDir) ===
          normalizeForComparison(await canonicalizeExisting(root))
        ) {
          return "Broad user folders cannot be modified";
        }
      } catch {
        // Missing common folder: nothing to block.
      }
    }
  }

  return {
    ok: true,
    reason: "Safe local game directory boundary",
    gameDir,
    steamApiDllPaths: [],
    artifactPaths: [],
  };
};

/**
 * Inspect a bounded, link-free target before any third-party mutation. The
 * asynchronous walk yields to Electron's main loop between directories.
 */
export const inspectSteamEmulatorDirectory = async (
  candidate: string,
  additionalBlockedRoots: string[] = []
): Promise<SteamEmulatorDirectoryInspection> => {
  const boundary = await validateDirectoryBoundary(
    candidate.trim(),
    additionalBlockedRoots
  );
  if (typeof boundary === "string") return rejectedInspection(boundary);
  const gameDir = boundary.gameDir!;

  const steamApiDllPaths: string[] = [];
  const artifactPaths: string[] = [];
  const pending: Array<{ directory: string; depth: number }> = [
    { directory: gameDir, depth: 0 },
  ];
  let visitedEntries = 0;

  while (pending.length) {
    const current = pending.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(current.directory, {
        withFileTypes: true,
      });
    } catch {
      return rejectedInspection("Game folder could not be inspected safely");
    }
    const siblingNames = new Set(
      entries.map((entry) => entry.name.toLowerCase())
    );

    for (const entry of entries) {
      visitedEntries += 1;
      if (visitedEntries > MAX_TREE_ENTRIES) {
        return rejectedInspection("Game folder is too large to inspect safely");
      }

      const fullPath = path.join(current.directory, entry.name);
      let entryStat: fs.Stats;
      try {
        entryStat = await fs.promises.lstat(fullPath);
      } catch {
        return rejectedInspection(
          "Game folder changed during safety inspection"
        );
      }
      if (entryStat.isSymbolicLink()) {
        return rejectedInspection(
          "Game folders containing links or junctions cannot be modified"
        );
      }

      const name = entry.name.toLowerCase();
      if (entryStat.isDirectory()) {
        if (ARTIFACT_DIRECTORY_NAMES.has(name)) {
          artifactPaths.push(fullPath);
          continue;
        }
        if (current.depth >= MAX_TREE_DEPTH) {
          return rejectedInspection(
            "Game folder nesting is too deep to inspect safely"
          );
        }
        pending.push({ directory: fullPath, depth: current.depth + 1 });
        continue;
      }
      if (!entryStat.isFile()) continue;

      if (STEAM_API_NAMES.has(name)) {
        if (entryStat.nlink > 1) {
          return rejectedInspection(
            "Hard-linked Steam API files cannot be modified safely"
          );
        }
        steamApiDllPaths.push(fullPath);
      }
      // SteamAutoCrack's optional unpacker writes `<executable>.exe.bak` next
      // to its source. Track only that exact adjacent shape for transactional
      // diff/rollback; unrelated backup-looking files are never signatures or
      // deletion candidates.
      if (isArtifactFileName(name, siblingNames)) artifactPaths.push(fullPath);
    }
  }

  if (steamApiDllPaths.length === 0) {
    return rejectedInspection("No Steam API DLL was found in the game folder");
  }

  return {
    ok: true,
    reason: "Safe local Steam game directory",
    gameDir,
    steamApiDllPaths,
    artifactPaths,
  };
};

/** Last-line guard for public directory-based setup callers. */
export const resolveSafeSteamEmulatorDirectory = (
  gameDir: string,
  additionalBlockedRoots: string[] = []
) => inspectSteamEmulatorDirectory(gameDir, additionalBlockedRoots);

/**
 * Last-line destructive safety gate. The executable being launched is the
 * authority; stale database paths are not. It must be a real local .exe in a
 * non-system game directory, with a canonical numeric Steam app id.
 */
export const resolveSafeSteamEmulatorTarget = async (
  game: Pick<Game, "shop" | "objectId" | "libraryOrigin" | "executablePath">,
  executablePath: string | null | undefined,
  additionalBlockedRoots: string[] = []
): Promise<SteamEmulatorTargetResult> => {
  const candidate = executablePath?.trim() ?? "";
  const eligibilityGame = { ...game, executablePath: candidate };
  if (!isOfflinePlaySetupEligible(eligibilityGame)) {
    return {
      ...rejectedInspection("Game is not eligible for offline-play setup"),
    };
  }
  if (
    !path.win32.isAbsolute(candidate) ||
    DEVICE_OR_UNC_PATH_PATTERN.test(candidate) ||
    path.extname(candidate).toLowerCase() !== ".exe"
  ) {
    return {
      ...rejectedInspection("A local Windows executable is required"),
    };
  }

  let stat: fs.Stats;
  let lexicalStat: fs.Stats;
  try {
    [stat, lexicalStat] = await Promise.all([
      fs.promises.stat(candidate),
      fs.promises.lstat(candidate),
    ]);
  } catch {
    return { ...rejectedInspection("Game executable does not exist") };
  }
  if (!stat.isFile()) {
    return { ...rejectedInspection("Game executable is not a regular file") };
  }
  if (lexicalStat.isSymbolicLink()) {
    return {
      ...rejectedInspection("Linked game executables cannot be modified"),
    };
  }

  const canonicalExecutable = await canonicalizeExisting(candidate);
  const inspection = await inspectSteamEmulatorDirectory(
    path.dirname(canonicalExecutable),
    additionalBlockedRoots
  );
  if (!inspection.ok || !inspection.gameDir) return inspection;

  return {
    ...inspection,
    executablePath: canonicalExecutable,
    reason: "Safe local Steam game target",
  };
};
