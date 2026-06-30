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
 * Delete the torrent's leftover directory scaffolding (e.g. `Minerva_Myrient`)
 * directly under `root` once the ROM has been flattened out of it. Only removes
 * sub-directories — never files that now live at the root.
 */
function cleanupNestedDirs(root: string): void {
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        fs.rmSync(path.join(root, entry.name), {
          recursive: true,
          force: true,
        });
      }
    }
  } catch {
    /* best effort */
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

    // Remove the now-empty Myrient scaffolding left behind by the torrent.
    cleanupNestedDirs(platformRoot);

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
