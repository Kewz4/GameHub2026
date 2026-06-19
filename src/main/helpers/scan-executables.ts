import fs from "node:fs";
import path from "node:path";
import { logger } from "@main/services/logger";

/**
 * Steam library `steamapps/common` directories discovered from the local Steam
 * install (primary root + every library declared in libraryfolders.vdf).
 */
function steamCommonDirs(): string[] {
  if (process.platform !== "win32") return [];

  const programFilesX86 =
    process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const programFiles = process.env["ProgramFiles"] ?? "C:\\Program Files";
  const roots = [
    path.join(programFilesX86, "Steam"),
    path.join(programFiles, "Steam"),
    "C:\\Steam",
  ];

  const root = roots.find((r) => fs.existsSync(path.join(r, "steamapps")));
  if (!root) return [];

  const dirs = new Set<string>([path.join(root, "steamapps", "common")]);

  try {
    const vdf = fs.readFileSync(
      path.join(root, "steamapps", "libraryfolders.vdf"),
      "utf8"
    );
    const regex = /"path"\s*"([^"]+)"/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(vdf)) !== null) {
      const libPath = match[1].replace(/\\\\/g, "\\");
      dirs.add(path.join(libPath, "steamapps", "common"));
    }
  } catch {
    // No vdf / unreadable — primary common dir is still included.
  }

  return [...dirs];
}

/** Fixed (non-removable) drive letters present on the machine, C: through Z:. */
function fixedDriveLetters(): string[] {
  if (process.platform !== "win32") return [];
  const drives: string[] = [];
  for (let c = "C".charCodeAt(0); c <= "Z".charCodeAt(0); c++) {
    const letter = String.fromCharCode(c);
    if (fs.existsSync(`${letter}:\\`)) drives.push(letter);
  }
  return drives;
}

/**
 * Build the full set of directories the deep scan should search. Combines:
 *   • per-drive common game folders (Games, SteamLibrary, GOG/Epic/Xbox dirs)
 *   • the real Steam library `common` folders from libraryfolders.vdf
 *   • the standard Epic / GOG install roots under Program Files
 *   • any caller-supplied extra directories
 * Only existing directories are returned, de-duplicated.
 */
export function discoverScanDirectories(extra: string[] = []): string[] {
  const candidates = new Set<string>(extra);

  if (process.platform === "win32") {
    const programFilesX86 =
      process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
    const programFiles = process.env["ProgramFiles"] ?? "C:\\Program Files";

    for (const d of fixedDriveLetters()) {
      candidates.add(`${d}:\\Games`);
      candidates.add(`${d}:\\SteamLibrary\\steamapps\\common`);
      candidates.add(`${d}:\\GOG Games`);
      candidates.add(`${d}:\\Epic Games`);
      candidates.add(`${d}:\\XboxGames`);
    }

    candidates.add(path.join(programFilesX86, "DODI-Repacks"));
    candidates.add(path.join(programFiles, "Epic Games"));
    candidates.add(path.join(programFilesX86, "GOG Galaxy", "Games"));

    for (const dir of steamCommonDirs()) candidates.add(dir);
  }

  return [...candidates].filter((dir) => {
    try {
      return fs.statSync(dir).isDirectory();
    } catch {
      return false;
    }
  });
}

/**
 * Walk each directory ONCE and index every file whose (lower-cased) name is in
 * `wantedNames`, mapping that name to its first-seen absolute path.
 *
 * This replaces the old approach of re-walking the entire tree once per game
 * (O(games × tree)); a single pass per directory (O(tree)) is dramatically
 * faster and is the main reason the deep scan felt unreliable on large drives.
 */
export async function indexExecutables(
  directories: string[],
  wantedNames: Set<string>
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  if (wantedNames.size === 0) return found;

  for (const dir of directories) {
    if (found.size === wantedNames.size) break; // everything resolved
    try {
      const entries = await fs.promises.readdir(dir, {
        withFileTypes: true,
        recursive: true,
      });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const name = entry.name.toLowerCase();
        if (!wantedNames.has(name) || found.has(name)) continue;
        const parentPath =
          "parentPath" in entry
            ? (entry.parentPath as string)
            : "path" in entry
              ? (entry as unknown as { path: string }).path
              : dir;
        found.set(name, path.join(parentPath, entry.name));
      }
    } catch (err) {
      logger.error(`[ScanInstalledGames] Error reading folder ${dir}:`, err);
    }
  }

  return found;
}
