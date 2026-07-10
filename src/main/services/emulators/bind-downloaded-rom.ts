import path from "node:path";
import fs from "node:fs";
import { gamesSublevel, levelKeys } from "@main/level";
import type { ClassicsDisc, Download, EmulatorSystem } from "@types";
import { KNOWN_BINARIES } from "./known-binaries";
import { scanRomFolder } from "./scan-rom-folder";
import { logger } from "../logger";

/** Display platform label per console (mirrors the launchbox importer). */
const SYSTEM_PLATFORM_LABEL: Record<EmulatorSystem, string> = {
  ps1: "PlayStation",
  ps2: "PlayStation 2",
  ps3: "PlayStation 3",
  psp: "PlayStation Portable",
  n3ds: "Nintendo 3DS",
  nds: "Nintendo DS",
  dsi: "Nintendo DSi",
  n64: "Nintendo 64",
  gb: "Game Boy",
  gbc: "Game Boy Color",
  gba: "Game Boy Advance",
  wiiu: "Nintendo Wii U",
  wii: "Nintendo Wii",
  gc: "Nintendo GameCube",
};

const baseName = (p: string): string => {
  const name = path.basename(p);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
};

/**
 * Move a ROM file (already at `srcPath`) directly under `root`, returning the
 * new path. If it's already at the root, or the move fails, the original path
 * is returned so the disc still resolves.
 */
function flattenIntoRoot(srcPath: string, root: string): string {
  try {
    if (path.dirname(srcPath) === root) return srcPath;
    let dest = path.join(root, path.basename(srcPath));
    // Avoid clobbering a different file with the same name.
    if (fs.existsSync(dest) && dest !== srcPath) {
      const ext = path.extname(dest);
      const stem = path.basename(dest, ext);
      let i = 1;
      while (fs.existsSync(dest)) {
        dest = path.join(root, `${stem} (${i})${ext}`);
        i += 1;
      }
    }
    fs.renameSync(srcPath, dest);
    return dest;
  } catch {
    return srcPath;
  }
}

/**
 * Delete the download's own leftover scaffolding (e.g. `Minerva_Myrient`) once
 * the ROM has been flattened out of it. Scoped to the download's folder ONLY —
 * never the whole platform root, which also holds other games' folders and
 * `(Update)`/`(DLC)` sibling folders that must survive.
 */
function cleanupDownloadScaffolding(
  scanRoot: string,
  platformRoot: string
): void {
  try {
    if (!scanRoot || scanRoot === platformRoot) return;
    if (fs.existsSync(scanRoot)) {
      fs.rmSync(scanRoot, { recursive: true, force: true });
    }
  } catch {
    /* best effort */
  }
}

/** Strip filesystem-hostile characters from a folder name. */
const sanitizeFolderName = (name: string): string =>
  name.replace(/[<>:"/\\|?*]/g, "").trim() || "Game";

/** A `(vNNN)`/`(v1.5.0)` tag from a folder/file name, e.g. "(v208)". */
const versionTagOf = (name: string): string | null => {
  const m = name.match(/\(\s*v[\d.]+\s*\)/i);
  return m ? m[0] : null;
};

/**
 * Find the extracted title folder (one that directly contains a `content`
 * subdir) inside the download tree — bounded BFS so a nested Myrient layout
 * still resolves without walking anything huge.
 */
function findContentTitleDir(root: string): string | null {
  const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];
  let visited = 0;
  while (queue.length && visited < 200) {
    const { dir, depth } = queue.shift()!;
    visited++;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      if (entries.some((e) => e.isDirectory() && e.name === "content")) {
        return dir;
      }
      if (depth < 4) {
        for (const e of entries) {
          if (e.isDirectory()) {
            queue.push({ dir: path.join(dir, e.name), depth: depth + 1 });
          }
        }
      }
    } catch {
      /* skip unreadable */
    }
  }
  return null;
}

/**
 * Place a completed UPDATE/DLC download next to its base game instead of
 * binding it as a launchable ROM. The extracted title folder is moved to
 * `<platformRoot>/<Base Title> (Update|DLC) [vTag]` — exactly the loose-sibling
 * layout resolveCemuGamePaths' strict name patterns find (for launching modded
 * BOTW and for future installs). Loose rom-extension files (e.g. 3DS update
 * .cia) are flattened to the platform root under their original names. The
 * companion's phantom library entry is then hidden.
 */
async function placeCompanionContent(
  download: Download,
  kind: "update" | "dlc",
  scanRoot: string,
  platformRoot: string
): Promise<void> {
  const baseObjectId = download.objectId.split("::")[0];
  const baseGame = await gamesSublevel
    .get(levelKeys.game(download.shop, baseObjectId))
    .catch(() => null);
  const baseTitle = sanitizeFolderName(baseGame?.title ?? baseObjectId);
  const tag = kind === "update" ? "(Update)" : "(DLC)";

  // 1) Folder-format content (Wii U): move the title folder to the sibling slot.
  const titleDir = findContentTitleDir(scanRoot);
  if (titleDir) {
    const vTag = versionTagOf(path.basename(titleDir)) ?? "";
    let dest = path.join(
      platformRoot,
      `${baseTitle} ${tag}${vTag ? ` ${vTag}` : ""}`
    );
    try {
      if (fs.existsSync(dest)) {
        fs.rmSync(dest, { recursive: true, force: true });
      }
      fs.renameSync(titleDir, dest);
      logger.log(`[bindDownloadedRom] Placed ${kind} → ${dest}`);
    } catch (err) {
      logger.warn(`[bindDownloadedRom] Couldn't place ${kind} folder`, err);
      dest = titleDir; // leave in place rather than lose it
    }
  } else {
    // 2) File-format content (e.g. 3DS .cia): flatten to the platform root.
    const binary = KNOWN_BINARIES[download.emulatorSystem as EmulatorSystem];
    const exts = new Set(binary?.romExtensions ?? []);
    const moveFiles = (dir: string, depth: number): void => {
      if (depth > 4) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) moveFiles(full, depth + 1);
        else if (exts.has(path.extname(e.name).toLowerCase())) {
          flattenIntoRoot(full, platformRoot);
        }
      }
    };
    moveFiles(scanRoot, 0);
  }

  cleanupDownloadScaffolding(scanRoot, platformRoot);

  // Hide the phantom companion library entry (it existed only so the download
  // pipeline could track this download — it's not a playable game).
  const companionKey = levelKeys.game(download.shop, download.objectId);
  const companion = await gamesSublevel.get(companionKey).catch(() => null);
  if (companion) {
    await gamesSublevel.put(companionKey, { ...companion, isDeleted: true });
  }
}

/**
 * After a minerva/console download finishes (and any archive is extracted),
 * locate the ROM file(s) in the download folder and bind them to the library
 * entry as discs — making the game launchable via the emulator and giving the
 * Play button a disc path. Without this a downloaded ROM never becomes
 * playable (the launch path would throw NO_DISC).
 *
 * Best-effort: any failure is logged and left for a manual rescan.
 */
export const bindDownloadedRom = async (download: Download): Promise<void> => {
  const system = (download.emulatorSystem ?? null) as EmulatorSystem | null;
  if (!system) return;

  const binary = KNOWN_BINARIES[system];
  if (!binary) return;

  // The download root is the platform folder (…/Emulator Games/<Platform>).
  // Minerva magnets are one giant file-selected torrent, so libtorrent writes
  // the ROM deep inside `<root>/Minerva_Myrient/No-Intro/<console>/…` — we scan
  // that whole tree, then flatten the found ROM(s) up to the platform root and
  // delete the leftover Myrient directories so the user just sees the game file.
  const platformRoot = download.downloadPath;
  const scanRoot = download.folderName
    ? path.join(platformRoot, download.folderName)
    : platformRoot;

  try {
    // Companion downloads (update/DLC) are PLACED next to the base game, never
    // bound as launchable ROMs — the scan would (correctly) skip them anyway.
    const companion = download.objectId.match(/::(update|dlc)/);
    if (companion) {
      await placeCompanionContent(
        download,
        companion[1] as "update" | "dlc",
        scanRoot,
        platformRoot
      );
      return;
    }

    const result = await scanRomFolder(scanRoot, binary, true);
    const playable = result.games.filter((g) => !g.wrongPlatform);
    if (playable.length === 0) {
      logger.warn(
        `[bindDownloadedRom] No ${system} ROM found under ${scanRoot} for ${download.objectId}`
      );
      return;
    }

    const discs: ClassicsDisc[] = [];
    for (const g of playable) {
      const flattened = flattenIntoRoot(g.primaryPath, platformRoot);
      discs.push({
        path: flattened,
        label: baseName(g.name),
        fileName: g.name,
        sku: null,
      });
    }

    // Remove the now-empty Myrient scaffolding left behind by the torrent —
    // scoped to THIS download's folder so sibling games and their
    // (Update)/(DLC) folders are never touched. Skip when any bound disc still
    // lives inside it (e.g. a folder-format game that IS the scan root).
    const discInsideScanRoot = discs.some((d) =>
      (d.path + path.sep).startsWith(scanRoot + path.sep)
    );
    if (!discInsideScanRoot) {
      cleanupDownloadScaffolding(scanRoot, platformRoot);
    }

    const gameKey = levelKeys.game(download.shop, download.objectId);
    const game = await gamesSublevel.get(gameKey);
    if (!game) return;

    await gamesSublevel.put(gameKey, {
      ...game,
      platform: game.platform ?? SYSTEM_PLATFORM_LABEL[system] ?? system,
      discs,
      selectedDiscPath: discs[0]?.path ?? null,
      romSizeBytes: result.sizeBytes || game.romSizeBytes || null,
      isDeleted: false,
    });

    logger.log(
      `[bindDownloadedRom] Bound ${discs.length} ${system} disc(s) for ${download.objectId}`
    );
  } catch (err) {
    logger.error(
      `[bindDownloadedRom] Failed to bind ROM for ${download.objectId}`,
      err
    );
  }
};
