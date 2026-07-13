import fs from "node:fs";
import path from "node:path";
import { cleanGameFolderName } from "./clean-game-folder-name";
import { getExeGameTitle } from "./exe-metadata";
import { logger } from "@main/services/logger";
import { KNOWN_BINARIES } from "@main/services/emulators/known-binaries";
import { parseRomFilename } from "@main/services/emulators/parse-rom-filename";
import type { EmulatorSystem } from "@types";

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
      return (
        b.length >= 3 && (folderNorm.includes(b) || b.includes(folderNorm))
      );
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

  const candidates: { name: string; exe: string }[] = [];
  let i = 0;
  for (const { folder, name } of gameFolders) {
    i++;
    onProgress?.(i, gameFolders.length, name);
    const exe = await bestExeForFolder(folder, name);
    if (exe) candidates.push({ name, exe });
  }

  // Prefer the game name from the exe's version info (file Properties →
  // Details) — download-site folders rename the FOLDER ("Death Must Die
  // -SteamGG.NET") but not the exe metadata. Fall back to the cleaned folder
  // name. Fetched in small batches so the per-exe PowerShell call doesn't
  // serialize the scan.
  const results: DiscoveredGame[] = [];
  const BATCH = 5;
  for (let start = 0; start < candidates.length; start += BATCH) {
    const batch = candidates.slice(start, start + BATCH);
    const titles = await Promise.all(
      batch.map(({ exe }) => getExeGameTitle(exe, 3_000).catch(() => null))
    );
    batch.forEach(({ name, exe }, idx) => {
      results.push({
        title: titles[idx] ?? cleanGameFolderName(name),
        executablePath: exe,
      });
    });
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

// ─── ROM file discovery (emulator/console game scan) ─────────────────────────

/**
 * ROM extension → the EmulatorSystem(s) that use it. Built from KNOWN_BINARIES
 * so the scan stays in sync with the emulator definitions. Extensions shared
 * by multiple systems (e.g. `.iso` → ps2/ps3/psp/wii/gc/wiiu) are resolved by
 * the parent folder name (see `systemFromFolderName`).
 */
const ROM_EXTENSION_MAP: Map<string, EmulatorSystem[]> = (() => {
  const map = new Map<string, EmulatorSystem[]>();
  for (const [system, binary] of Object.entries(KNOWN_BINARIES)) {
    for (const ext of binary.romExtensions) {
      const lower = ext.toLowerCase();
      const list = map.get(lower) ?? [];
      list.push(system as EmulatorSystem);
      map.set(lower, list);
    }
  }
  return map;
})();

/** Folder-name fragments → EmulatorSystem, mirrors the download folder layout. */
const FOLDER_NAME_TO_SYSTEM: Array<[RegExp, EmulatorSystem]> = [
  [/ps3/i, "ps3"],
  [/ps2/i, "ps2"],
  [/ps1|psx|playstation\b/i, "ps1"],
  [/psp|playstation portable/i, "psp"],
  [/3ds/i, "n3ds"],
  [/dsi/i, "dsi"],
  [/\bnds\b|\bds\b/i, "nds"],
  [/n64|nintendo 64/i, "n64"],
  [/gba|game boy advance/i, "gba"],
  [/gbc|game boy color/i, "gbc"],
  [/\bgb\b|game boy\b/i, "gb"],
  [/wii\s*u/i, "wiiu"],
  [/\bwii\b/i, "wii"],
  [/gamecube|\bgc\b/i, "gc"],
];

/** Try to determine the system from a folder name (e.g. "PS3 Games" → ps3). */
function systemFromFolderName(folderName: string): EmulatorSystem | null {
  for (const [re, system] of FOLDER_NAME_TO_SYSTEM) {
    if (re.test(folderName)) return system;
  }
  return null;
}

export interface DiscoveredRom {
  title: string;
  romPath: string;
  system: EmulatorSystem;
}

/** Common ROM directory names to scan (in addition to "Emulator Games"). */
const ROM_ROOT_NAMES = [
  "Emulator Games",
  "ROMs",
  "Roms",
  "Emulator",
  "Emulators",
];

/**
 * Discover emulator/console ROM files on disk. Scans:
 *   • Per-drive "Emulator Games" folders (where GameHub downloads ROMs to)
 *   • Per-drive "ROMs" / "Emulator" folders (common user-organized locations)
 *   • The generic game folders (D:\Games etc.) — ROMs mixed with PC games
 *
 * For each ROM found, the system is determined by:
 *   1. The parent folder name (e.g. "PS3 Games" → ps3) — most reliable
 *   2. The extension when it's unique to one system (e.g. `.3ds` → n3ds)
 *   3. Skipped when the extension is shared and the folder gives no clue
 */
export async function discoverRomFiles(
  extraDirs: string[] = [],
  onProgress?: (current: number, total: number, title: string) => void
): Promise<DiscoveredRom[]> {
  if (process.platform !== "win32") return [];

  // Build the list of ROM root directories to scan.
  const roots = new Set<string>(extraDirs);
  for (const d of fixedDriveLetters()) {
    for (const name of ROM_ROOT_NAMES) {
      roots.add(`${d}:\\${name}`);
    }
    // Also scan the generic Games folder for loose ROMs.
    roots.add(`${d}:\\Games`);
  }

  const existingRoots = [...roots].filter((dir) => {
    try {
      return fs.statSync(dir).isDirectory();
    } catch {
      return false;
    }
  });

  const results: DiscoveredRom[] = [];
  const seenPaths = new Set<string>();

  for (const root of existingRoots) {
    if (isStoreManagedPath(root)) continue;

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(root, {
        withFileTypes: true,
        recursive: true,
      });
    } catch {
      continue;
    }

    // Group entries by their immediate parent folder name so we can use it to
    // disambiguate shared extensions. We process files only.
    let i = 0;
    const files = entries.filter((e) => e.isFile());
    for (const entry of files) {
      const lower = entry.name.toLowerCase();
      const ext = path.extname(lower);
      const systems = ROM_EXTENSION_MAP.get(ext);
      if (!systems || systems.length === 0) continue;

      const parentPath =
        "parentPath" in entry
          ? (entry.parentPath as string)
          : "path" in entry
            ? (entry as unknown as { path: string }).path
            : root;
      const fullPath = path.join(parentPath, entry.name);
      const fullPathLower = fullPath.toLowerCase();
      if (seenPaths.has(fullPathLower)) continue;
      // Skip files inside store-managed paths (Steam/Epic/etc.).
      if (isStoreManagedPath(fullPath)) continue;

      // Determine the system: prefer the folder name, fall back to unique ext.
      const parentFolderName = path.basename(parentPath);
      let system: EmulatorSystem | null =
        systemFromFolderName(parentFolderName);

      if (!system && systems.length === 1) {
        // Unique extension — no ambiguity.
        system = systems[0];
      } else if (!system) {
        // Shared extension and folder name gives no clue — try the grandparent
        // folder too (e.g. "Emulator Games/PS3 Games/game.iso").
        const grandparent = path.basename(path.dirname(parentPath));
        system = systemFromFolderName(grandparent);
      }

      if (!system) continue; // can't safely categorize — skip

      // Skip multi-file disc images: .bin is a .cue sidecar, .mdf is a .mds
      // sidecar. The .cue/.mds is the launchable entry point.
      if (ext === ".bin" || ext === ".mdf" || ext === ".img") {
        const cue = path.join(
          parentPath,
          entry.name.replace(/\.(bin|mdf|img)$/i, ".cue")
        );
        const mds = path.join(
          parentPath,
          entry.name.replace(/\.(bin|mdf|img)$/i, ".mds")
        );
        const ccd = path.join(
          parentPath,
          entry.name.replace(/\.(bin|mdf|img)$/i, ".ccd")
        );
        if (fs.existsSync(cue) || fs.existsSync(mds) || fs.existsSync(ccd))
          continue;
      }

      seenPaths.add(fullPathLower);
      const { title } = parseRomFilename(entry.name);
      results.push({ title, romPath: fullPath, system });

      i++;
      if (i % 10 === 0) {
        onProgress?.(i, files.length, title);
      }
    }
  }

  return results;
}
