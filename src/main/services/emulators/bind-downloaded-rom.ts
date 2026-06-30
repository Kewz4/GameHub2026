import path from "node:path";
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

  const root = download.folderName
    ? path.join(download.downloadPath, download.folderName)
    : download.downloadPath;

  try {
    const result = await scanRomFolder(root, binary, true);
    const playable = result.games.filter((g) => !g.wrongPlatform);
    if (playable.length === 0) {
      logger.warn(
        `[bindDownloadedRom] No ${system} ROM found under ${root} for ${download.objectId}`
      );
      return;
    }

    const discs: ClassicsDisc[] = playable.map((g) => ({
      path: g.primaryPath,
      label: baseName(g.name),
      fileName: g.name,
      sku: null,
    }));

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
