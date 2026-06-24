import { createHash } from "node:crypto";

import { getSteamGridDbArtwork } from "@main/services/steamgriddb";
import { logger } from "@main/services/logger";
import {
  gamesShopAssetsSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import type { ClassicsDisc, EmulatorSystem } from "@types";

import { KNOWN_BINARIES } from "./known-binaries";
import { scanRomFolder } from "./scan-rom-folder";
import { parseRomFilename } from "./parse-rom-filename";
import {
  updateEmulatorConfig,
  recomputeTotals,
} from "./emulators-repository";
import { randomUUID } from "node:crypto";
import type { RomFolder } from "@types";

const SHOP = "launchbox" as const;

// Human-facing platform label persisted on the Game record, mirroring the
// SYSTEM_DEFAULT_PLATFORM table in import-launchbox-roms.ts.
const SYSTEM_DISPLAY_PLATFORM: Record<EmulatorSystem, string> = {
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

const baseNameOf = (filePath: string): string => {
  const norm = filePath.replace(/[\\/]+$/, "");
  const idx = Math.max(norm.lastIndexOf("/"), norm.lastIndexOf("\\"));
  return idx >= 0 ? norm.slice(idx + 1) : norm;
};

const normalizeTitleKey = (title: string, region: string | null): string =>
  `${title.trim().toLowerCase()}::${(region ?? "").toLowerCase()}`;

const syntheticObjectId = (
  system: EmulatorSystem,
  title: string,
  region: string | null
): string => {
  const hash = createHash("sha1")
    .update(normalizeTitleKey(title, region))
    .digest("hex")
    .slice(0, 16);
  return `local-${system}-${hash}`;
};

const persistRomFolder = async (
  system: EmulatorSystem,
  folderPath: string,
  scanSubfolders: boolean,
  fileCount: number,
  sizeBytes: number
) => {
  await updateEmulatorConfig(system, (current) => {
    const existing = current.romFolders.find((f) => f.path === folderPath);
    const updated: RomFolder = {
      id: existing?.id ?? randomUUID(),
      path: folderPath,
      scanSubfolders,
      fileCount,
      sizeBytes,
      lastScanAt: Date.now(),
    };

    const nextFolders = existing
      ? current.romFolders.map((f) => (f.path === folderPath ? updated : f))
      : [...current.romFolders, updated];

    return recomputeTotals({
      ...current,
      romFolders: nextFolders,
    });
  });
};

export interface SgdbImportProgress {
  processed: number;
  total: number;
  currentFile: string | null;
  matched: number;
  sizeBytes: number;
}

export interface SgdbImportResult {
  fileCount: number;
  sizeBytes: number;
  matched: number;
}

/**
 * Imports ROMs for cartridge / non-PlayStation systems into the library by
 * matching each game group's title against SteamGridDB for artwork. Unlike the
 * LaunchBox importer, there is no Hydra catalogue entry for these — we mint a
 * stable synthetic `local-${system}-${hash}` objectId per title+region and
 * persist it under the emulation `launchbox` shop.
 */
export async function importSgdbRoms(
  system: EmulatorSystem,
  folderPath: string,
  scanSubfolders: boolean,
  onProgress?: (p: SgdbImportProgress) => void
): Promise<SgdbImportResult> {
  const binary = KNOWN_BINARIES[system];
  const platform = SYSTEM_DISPLAY_PLATFORM[system] ?? null;

  const scan = await scanRomFolder(folderPath, binary, scanSubfolders);
  const games = scan.games.filter((g) => !g.wrongPlatform);
  const total = games.length;

  let matched = 0;

  for (let i = 0; i < games.length; i++) {
    const game = games[i];
    const fileName = baseNameOf(game.primaryPath);
    const { title, region } = parseRomFilename(fileName);
    if (!title) continue;

    const objectId = syntheticObjectId(system, title, region);
    const gameKey = levelKeys.game(SHOP, objectId);

    const discs: ClassicsDisc[] = [
      {
        path: game.primaryPath,
        label: title,
        fileName,
        sku: null,
      },
    ];

    let iconUrl: string | null = null;
    let libraryImageUrl: string | null = null;
    let libraryHeroImageUrl: string | null = null;
    let logoImageUrl: string | null = null;
    let coverImageUrl: string | null = null;

    try {
      const artwork = await getSteamGridDbArtwork(title);
      if (artwork) {
        iconUrl = artwork.gridUrl;
        coverImageUrl = artwork.gridUrl;
        libraryImageUrl = artwork.wideGridUrl;
        libraryHeroImageUrl = artwork.heroUrl;
        logoImageUrl = artwork.logoUrl;
        matched += 1;
      }
    } catch (err) {
      logger.warn(`[sgdb-import] artwork lookup failed for "${title}"`, err);
    }

    await gamesShopAssetsSublevel
      .put(gameKey, {
        objectId,
        shop: SHOP,
        title,
        iconUrl,
        libraryImageUrl,
        libraryHeroImageUrl,
        logoImageUrl,
        coverImageUrl,
        logoPosition: null,
        downloadSources: [],
        updatedAt: Date.now(),
      })
      .catch((err) => logger.error("[sgdb-import] could not cache assets", err));

    const existing = await gamesSublevel.get(gameKey).catch(() => undefined);
    if (existing) {
      existing.isDeleted = false;
      existing.addedToLibraryAt ??= new Date();
      existing.title = title;
      existing.iconUrl = iconUrl;
      existing.libraryHeroImageUrl = libraryHeroImageUrl;
      existing.logoImageUrl = logoImageUrl;
      if (platform && !existing.platform) existing.platform = platform;
      existing.discs = discs;
      if (
        !existing.selectedDiscPath ||
        !discs.some((d) => d.path === existing.selectedDiscPath)
      ) {
        existing.selectedDiscPath = discs[0]?.path ?? null;
      }
      existing.romSizeBytes = game.sizeBytes ?? existing.romSizeBytes ?? null;
      await gamesSublevel.put(gameKey, existing);
    } else {
      await gamesSublevel.put(gameKey, {
        title,
        iconUrl,
        libraryHeroImageUrl,
        logoImageUrl,
        objectId,
        shop: SHOP,
        remoteId: null,
        isDeleted: false,
        playTimeInMilliseconds: 0,
        lastTimePlayed: null,
        addedToLibraryAt: new Date(),
        platform,
        discs,
        selectedDiscPath: discs[0]?.path ?? null,
        romSizeBytes: game.sizeBytes ?? null,
      });
    }

    onProgress?.({
      processed: i + 1,
      total,
      currentFile: fileName,
      matched,
      sizeBytes: scan.sizeBytes,
    });
  }

  await persistRomFolder(
    system,
    folderPath,
    scanSubfolders,
    scan.fileCount,
    scan.sizeBytes
  ).catch((err) =>
    logger.error("[sgdb-import] could not persist rom folder", err)
  );

  return {
    fileCount: scan.fileCount,
    sizeBytes: scan.sizeBytes,
    matched,
  };
}
