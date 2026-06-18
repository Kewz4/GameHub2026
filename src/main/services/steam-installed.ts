import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { logger } from "./logger";

/**
 * Candidate Steam root directories across platforms. The first that exists and
 * contains a `steamapps` folder is used as the primary root; additional library
 * folders are discovered from `libraryfolders.vdf`.
 */
function candidateSteamRoots(): string[] {
  const home = os.homedir();
  if (process.platform === "win32") {
    const programFiles =
      process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
    const programFiles64 = process.env["ProgramFiles"] ?? "C:\\Program Files";
    return [
      path.join(programFiles, "Steam"),
      path.join(programFiles64, "Steam"),
      "C:\\Steam",
    ];
  }
  if (process.platform === "darwin") {
    return [path.join(home, "Library", "Application Support", "Steam")];
  }
  // Linux / Steam Deck
  return [
    path.join(home, ".steam", "steam"),
    path.join(home, ".steam", "root"),
    path.join(home, ".local", "share", "Steam"),
  ];
}

/** Extracts every `"path"  "…"` value from a libraryfolders.vdf document. */
function parseLibraryPaths(vdf: string): string[] {
  const paths: string[] = [];
  const regex = /"path"\s*"([^"]+)"/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(vdf)) !== null) {
    // VDF escapes backslashes as `\\` — normalise to single separators.
    paths.push(match[1].replace(/\\\\/g, "\\"));
  }
  return paths;
}

/** Lists installed app ids in a single `steamapps` directory via its manifests. */
async function appIdsInSteamApps(steamAppsDir: string): Promise<string[]> {
  const entries = await fs.promises.readdir(steamAppsDir).catch(() => []);
  const ids: string[] = [];
  for (const name of entries) {
    const m = /^appmanifest_(\d+)\.acf$/i.exec(name);
    if (m) ids.push(m[1]);
  }
  return ids;
}

/**
 * Returns the set of Steam app ids that are actually installed on this machine,
 * by reading the local `appmanifest_<appid>.acf` files across every Steam
 * library folder. Used to confirm a synced Steam game is installed before
 * offering a "Play" button (vs "You own this game — install via Steam").
 *
 * Resolves to an empty set when Steam isn't installed or nothing can be read —
 * callers treat that as "no confirmed installs" and fall back to the owned
 * state, which is the safe default.
 */
export async function getInstalledSteamAppIds(): Promise<Set<string>> {
  const installed = new Set<string>();

  let root: string | null = null;
  for (const candidate of candidateSteamRoots()) {
    if (fs.existsSync(path.join(candidate, "steamapps"))) {
      root = candidate;
      break;
    }
  }

  if (!root) {
    logger.log("[SteamInstalled] no local Steam installation found");
    return installed;
  }

  // The set of library `steamapps` directories: always the primary root, plus
  // any extra libraries declared in libraryfolders.vdf.
  const steamAppsDirs = new Set<string>([path.join(root, "steamapps")]);

  const vdfPath = path.join(root, "steamapps", "libraryfolders.vdf");
  const vdf = await fs.promises.readFile(vdfPath, "utf8").catch(() => "");
  if (vdf) {
    for (const libPath of parseLibraryPaths(vdf)) {
      steamAppsDirs.add(path.join(libPath, "steamapps"));
    }
  }

  for (const dir of steamAppsDirs) {
    for (const id of await appIdsInSteamApps(dir)) {
      installed.add(id);
    }
  }

  logger.log(
    `[SteamInstalled] ${installed.size} installed Steam app(s) detected across ${steamAppsDirs.size} library folder(s)`
  );
  return installed;
}
