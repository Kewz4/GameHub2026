import fs from "node:fs";
import path from "node:path";

import type { Game, GameShop } from "@types";

export interface ManualSaveMapping {
  files: string[];
}

interface GameSaveFolderDependencies {
  resolveEmulatorGameSaveFolder: (
    shop: GameShop,
    objectId: string
  ) => Promise<string | null>;
  getManualSaveMapping: (
    shop: GameShop,
    objectId: string
  ) => Promise<ManualSaveMapping | null | undefined>;
  getGame: (shop: GameShop, objectId: string) => Promise<Game | null>;
  getGameTitleFallback: (
    shop: GameShop,
    objectId: string
  ) => Promise<string | null>;
  findManifestSavePaths: (
    shop: GameShop,
    title: string,
    objectId: string,
    executablePath: string | null
  ) => Promise<string[]>;
}

const pathExistsAsDirectory = (candidate: string) => {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
};

/** Turn an expanded path (which may contain globs or name a file) into a folder. */
export const toGameSaveFolderCandidate = (expandedPath: string): string => {
  const segments = expandedPath.split(/[/\\]+/);
  const globIndex = segments.findIndex(
    (segment) => segment.includes("*") || segment.includes("?")
  );
  const cleanSegments =
    globIndex === -1 ? segments : segments.slice(0, globIndex);
  const candidate = cleanSegments.join(path.sep);

  if (pathExistsAsDirectory(candidate)) return candidate;
  return path.dirname(candidate);
};

const existingSaveFolder = (candidate: string): string | null => {
  try {
    const stat = fs.statSync(candidate);
    if (stat.isDirectory()) return candidate;
    if (stat.isFile()) return path.dirname(candidate);
  } catch {
    return null;
  }
  return null;
};

/**
 * Manual mappings are authoritative in Cloud Saves V2, so the folder action
 * must use the same precedence instead of silently opening a manifest or
 * emulator fallback that V2 is not actually tracking.
 */
export const resolveManualSaveFolder = (
  mapping: ManualSaveMapping | null | undefined
): string | null => {
  if (!mapping?.files.length) return null;
  for (const candidate of mapping.files) {
    const existing = existingSaveFolder(candidate);
    if (existing) return existing;

    // Ludusavi manual mappings may point at a file pattern (for example
    // `profile/**/*.sav`).  There is no concrete file to stat in that case,
    // but the containing directory is still the correct place for the UI to
    // open.  Keep the manual mapping authoritative and only return a container
    // that already exists.
    if (candidate.includes("*") || candidate.includes("?")) {
      const container = toGameSaveFolderCandidate(candidate);
      if (pathExistsAsDirectory(container)) return container;
    }
  }
  return null;
};

const chooseManifestSaveFolder = (
  expandedPaths: readonly string[],
  executablePath: string | null
) => {
  const installDir =
    executablePath && !/^[a-z][a-z\d+.-]*:\/\//i.test(executablePath)
      ? path.dirname(executablePath)
      : null;
  const comparable = (value: string) =>
    process.platform === "win32" ? value.toLowerCase() : value;
  const normalizedInstallDir = installDir ? comparable(installDir) : null;
  const isInsideInstallDir = (candidate: string) => {
    if (!normalizedInstallDir) return false;
    const relative = path.relative(normalizedInstallDir, comparable(candidate));
    return (
      relative === "" ||
      (relative !== ".." &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative))
    );
  };

  const candidates = expandedPaths.map(toGameSaveFolderCandidate);
  const existing = candidates.filter(pathExistsAsDirectory);
  return (
    existing.find((candidate) => !isInsideInstallDir(candidate)) ??
    existing[0] ??
    candidates.find((candidate) => !isInsideInstallDir(candidate)) ??
    null
  );
};

export const createGameSaveFolderResolver = (
  dependencies: GameSaveFolderDependencies
) => {
  return async (shop: GameShop, objectId: string): Promise<string | null> => {
    const manual = await dependencies
      .getManualSaveMapping(shop, objectId)
      .catch(() => null);
    if (manual?.files.length) {
      // Do not fall through to an unrelated mapper when the authoritative
      // manual path is temporarily missing. The UI should report unavailable.
      return resolveManualSaveFolder(manual);
    }

    const emulatorFolder = await dependencies
      .resolveEmulatorGameSaveFolder(shop, objectId)
      .catch(() => null);
    if (emulatorFolder) return emulatorFolder;

    const game = await dependencies.getGame(shop, objectId).catch(() => null);
    const title =
      game?.title ??
      (await dependencies
        .getGameTitleFallback(shop, objectId)
        .catch(() => null));
    if (!title) return null;

    const executablePath = game?.executablePath ?? null;
    const paths = await dependencies.findManifestSavePaths(
      shop,
      title,
      objectId,
      executablePath
    );
    if (paths.length === 0) return null;
    return chooseManifestSaveFolder(paths, executablePath);
  };
};
