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
 * Path-segment markers that mean a folder is managed by a store integration
 * (Steam/Epic/GOG/Xbox/EA/Ubisoft/etc.). Discovery of "unknown" games skips
 * these because those titles are already imported by their platform sync.
 */
const STORE_MANAGED_SEGMENTS = [
  "steamapps",
  "epic games",
  "gog galaxy",
  "gog.com",
  "xboxgames",
  "windowsapps",
  "ea games",
  "origin games",
  "ubisoft",
  "battle.net",
  "amazon games",
  "riot games",
];

/** True when a path lives inside a store-managed install location. */
export function isStoreManagedPath(p: string): boolean {
  const lower = p.toLowerCase();
  return STORE_MANAGED_SEGMENTS.some((seg) => lower.includes(seg));
}

/**
 * Executable name fragments that are never the game itself — installers,
 * redistributables, crash handlers, anti-cheat services and engine tooling.
 * Matched as case-insensitive substrings of the .exe basename.
 */
const NON_GAME_EXE_PATTERNS = [
  "unins",
  "setup",
  "install",
  "vcredist",
  "vc_redist",
  "dxsetup",
  "dxwebsetup",
  "directx",
  "dotnet",
  "oalinst",
  "redist",
  "prereq",
  "crashhandler",
  "crashreport",
  "crashpad",
  "easyanticheat",
  "battleye",
  "be_service",
  "activation",
  "cleanup",
  "python",
  "ffmpeg",
  "notification_helper",
  "subprocess",
  "helper",
  "report",
  "touchup",
];

/** Folder-name fragments that hold support binaries, never the main game exe. */
const NON_GAME_FOLDER_RE =
  /[\\/](_?commonredist|redist|directx|dotnet|vcredist|vc_redist|easyanticheat|battleye|dxsetup|prerequisites?)[\\/]/i;

function isLikelyGameExe(name: string): boolean {
  const lower = name.toLowerCase();
  if (!lower.endsWith(".exe")) return false;
  return !NON_GAME_EXE_PATTERNS.some((p) => lower.includes(p));
}

export interface DiscoveredGame {
  title: string;
  executablePath: string;
}

/** Pick the most likely main executable inside a single game folder. */
async function bestExeForFolder(
  folder: string,
  folderName: string
): Promise<string | null> {
  let entries: fs.Dirent[];
  try {
    entries = (await fs.promises.readdir(folder, {
      withFileTypes: true,
      recursive: true,
    })) as fs.Dirent[];
  } catch {
    return null;
  }

  const candidates: { path: string; depth: number; base: string }[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !isLikelyGameExe(entry.name)) continue;
    const parentPath =
      "parentPath" in entry
        ? (entry.parentPath as string)
        : "path" in entry
          ? (entry as unknown as { path: string }).path
          : folder;
    const full = path.join(parentPath, entry.name);
    if (NON_GAME_FOLDER_RE.test(full)) continue;
    const rel = path.relative(folder, full);
    candidates.push({
      path: full,
      depth: rel.split(/[\\/]/).length,
      base: entry.name.toLowerCase().replace(/\.exe$/, ""),
    });
  }

  if (candidates.length === 0) return null;

  // Prefer an exe whose name resembles the folder (game) name.
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const folderNorm = norm(folderName);
  if (folderNorm.length >= 3) {
    const nameMatch = candidates.find((c) => {
      const b = norm(c.base);
      return b.length >= 3 && (folderNorm.includes(b) || b.includes(folderNorm));
    });
    if (nameMatch) return nameMatch.path;
  }

  // Otherwise the shallowest executable (top of the game folder).
  candidates.sort((a, b) => a.depth - b.depth);
  return candidates[0].path;
}

/**
 * Discover games installed on disk that are NOT managed by a store integration.
 * Treats each immediate sub-folder of every root as one game (folder name =
 * title) and resolves its main executable heuristically. Store-managed paths
 * are skipped entirely.
 */
export async function discoverUnknownGames(
  roots: string[],
  onProgress?: (current: number, total: number, title: string) => void
): Promise<DiscoveredGame[]> {
  const gameFolders: { folder: string; name: string }[] = [];
  for (const root of roots) {
    if (isStoreManagedPath(root)) continue;
    let subs: fs.Dirent[];
    try {
      subs = await fs.promises.readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const sub of subs) {
      if (!sub.isDirectory()) continue;
      const folder = path.join(root, sub.name);
      if (isStoreManagedPath(folder)) continue;
      gameFolders.push({ folder, name: sub.name });
    }
  }

  const results: DiscoveredGame[] = [];
  let i = 0;
  for (const { folder, name } of gameFolders) {
    i++;
    onProgress?.(i, gameFolders.length, name);
    const exe = await bestExeForFolder(folder, name);
    if (exe) results.push({ title: name, executablePath: exe });
  }
  return results;
}

/**
 * Non-store game library roots to crawl when discovering unknown games. These
 * are generic "Games" folders plus the common repack roots — deliberately NOT
 * the store install paths (those are owned by platform sync).
 */
export function discoverGameLibraryRoots(extra: string[] = []): string[] {
  const candidates = new Set<string>(extra);

  if (process.platform === "win32") {
    const programFilesX86 =
      process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";

    for (const d of fixedDriveLetters()) {
      candidates.add(`${d}:\\Games`);
      candidates.add(`${d}:\\Game`);
    }

    candidates.add(path.join(programFilesX86, "DODI-Repacks"));
  }

  return [...candidates].filter((dir) => {
    if (isStoreManagedPath(dir)) return false;
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
