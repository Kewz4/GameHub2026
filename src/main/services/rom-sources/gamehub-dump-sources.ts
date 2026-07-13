import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { EmulatorSystem } from "@types";
import { db } from "@main/level";
import {
  minervaCatalogueSublevel,
  invalidateMinervaSearchIndex,
  type MinervaCatalogueEntry,
} from "@main/level/sublevels/minerva-catalogue";
import {
  normalizeRomTitle as normalizeTitle,
  displayRomTitle,
} from "@main/services/emulators/parse-rom-filename";
import { logger } from "../logger";

/**
 * GameHub Vault — the community-dumped USA game catalogue (games + updates +
 * DLC) that replaces the Minerva archive. Each entry is a DIRECT hoster link
 * (mostly VikingFile), so downloads route through the normal HTTP/TorBox path
 * — no collection torrent or file-index selection. Entries are stored in the
 * same catalogue sublevel the search/UI already use.
 */

// Bump when the Dump layout or parsing changes so installs re-seed.
// v2: base-game keys gain a `:stem` suffix so scanAllVariants' tight
//     `${system}:${title}:` … `${system}:${title}:\xFF` range matches them
//     (was: base games were keyed without the suffix and fell outside the
//     range, so download options came back empty for every game).
const DUMP_VERSION = 2;
const DUMP_VERSION_KEY = "gamehubDumpVersion";

/** Bundled Dump dir (extraResource in packaged builds; repo root in dev). */
const DUMP_DIR = app.isPackaged
  ? path.join(process.resourcesPath, "dump")
  : path.join(__dirname, "..", "..", "Dump");

/** Dump folder → EmulatorSystem. `gb_gba_gbc` is a merged Game Boy catalogue
 *  (RALibretro auto-detects GB/GBC/GBA by file extension at launch). */
const CONSOLE_MAP: Record<string, EmulatorSystem> = {
  "3ds": "n3ds",
  ds: "nds",
  gamecube: "gc",
  gb_gba_gbc: "gba",
  n64: "n64",
  ps1: "ps1",
  ps2: "ps2",
  ps3: "ps3",
  psp: "psp",
  wii: "wii",
  wiiu: "wiiu",
};

/** Consoles that ship update/DLC catalogues + the file names they use. */
const SUPPLEMENTAL: Record<string, { updates?: string[]; dlc?: string[] }> = {
  "3ds": { updates: ["updates.json"], dlc: ["dlc.json"] },
  ps3: { updates: ["update.json", "updates.json"], dlc: ["dlc.json"] },
  psp: { dlc: ["dlc.json"] },
  wiiu: { updates: ["updates.json"], dlc: ["dlc.json"] },
};

interface DumpGame {
  title: string;
  fileSize?: string | null;
  version?: string | null;
  downloadLink?: string | null;
  linkAlive?: boolean;
  dlc_count?: number;
  update_count?: number;
}

interface DumpSupplemental {
  title: string;
  game_title: string;
  update_link?: string | null;
  dlc_link?: string | null;
  fileSize?: string | null;
}

function readJson<T>(folder: string, file: string): T | null {
  try {
    const p = path.join(DUMP_DIR, folder, file);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
  } catch (err) {
    logger.warn(`[dump] failed to read ${folder}/${file}:`, err);
    return null;
  }
}

/** Load one console folder (games + its updates/DLC) into the catalogue. */
async function loadConsole(folder: string): Promise<number> {
  const system = CONSOLE_MAP[folder];
  if (!system) return 0;

  const games = readJson<DumpGame[]>(folder, "games.json");
  if (!games?.length) return 0;

  const now = Date.now();
  const batch = minervaCatalogueSublevel.batch();
  let count = 0;

  for (const game of games) {
    const url = game.downloadLink?.trim();
    if (!url || !/^https?:\/\//i.test(url)) continue;

    const entry: MinervaCatalogueEntry = {
      system,
      title: displayRomTitle(game.title),
      region: "USA",
      filename: game.title,
      romPath: "",
      magnet: null,
      torrentUrl: null,
      downloadUrl: url,
      fileSize: game.fileSize ?? null,
      contentType: "game",
      titleId: null,
    };
    // Key MUST carry a `:`-delimited filename stem suffix so the tight
    // range scan in scanAllVariants (`${system}:${title}:` …
    // `${system}:${title}:\xFF`) matches. The old Minerva loader always
    // appended `:normalizeTitle(filenameStem)`; without it, base games
    // sorted BEFORE the scan's lower bound and download options returned
    // empty. Dump games have no separate filename, so we reuse the title
    // itself as the disambiguator.
    const normTitle = normalizeTitle(game.title);
    batch.put(`${system}:${normTitle}:${normTitle}`, {
      entry,
      cachedAt: now,
    });
    count += 1;
  }

  // Updates / DLC, keyed by the base game's normalized title so the
  // download-options scan pairs them up.
  const supp = SUPPLEMENTAL[folder];
  const loadSupp = (
    files: string[] | undefined,
    kind: "update" | "dlc",
    linkKey: "update_link" | "dlc_link",
    prefix: string
  ) => {
    if (!files) return;
    const rows = files
      .map((f) => readJson<DumpSupplemental[]>(folder, f))
      .find((r) => r?.length);
    if (!rows) return;
    // Number DLC per game so multiple DLC of one title get distinct keys.
    const perGame = new Map<string, number>();
    for (const row of rows) {
      const link = row[linkKey]?.trim();
      if (!link || !/^https?:\/\//i.test(link)) continue;
      const gameNorm = normalizeTitle(row.game_title);
      const n = (perGame.get(gameNorm) ?? 0) + 1;
      perGame.set(gameNorm, n);
      const entry: MinervaCatalogueEntry = {
        system,
        title: displayRomTitle(row.title),
        region: "USA",
        filename: row.title,
        romPath: "",
        magnet: null,
        torrentUrl: null,
        downloadUrl: link,
        fileSize: row.fileSize ?? null,
        contentType: kind,
        titleId: null,
      };
      batch.put(`${prefix}${gameNorm}:${n}`, { entry, cachedAt: now });
      count += 1;
    }
  };
  loadSupp(supp?.updates, "update", "update_link", `${system}-upd:`);
  loadSupp(supp?.dlc, "dlc", "dlc_link", `${system}-dlc:`);

  await batch.write();
  return count;
}

export async function syncAllDumpSources(): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const folder of Object.keys(CONSOLE_MAP)) {
    try {
      result[folder] = await loadConsole(folder);
    } catch (err) {
      logger.error(`[dump] sync failed for ${folder}:`, err);
      result[folder] = 0;
    }
  }
  invalidateMinervaSearchIndex();
  logger.log("[dump] catalogue synced:", result);
  return result;
}

/** Seed the console catalogue from the bundled Dump (version-gated). */
export async function ensureGameHubDumpCatalogue(): Promise<void> {
  const stored = await db
    .get<string, number>(DUMP_VERSION_KEY, { valueEncoding: "json" })
    .catch(() => 0);

  const hasEntries = await (async () => {
    for await (const _ of minervaCatalogueSublevel.keys({ limit: 1 }))
      return true;
    return false;
  })();

  if (hasEntries && stored === DUMP_VERSION) return;

  // Version changed (or first run): rebuild from scratch.
  await minervaCatalogueSublevel.clear();
  await syncAllDumpSources();
  await db.put(DUMP_VERSION_KEY, DUMP_VERSION, { valueEncoding: "json" });
  invalidateMinervaSearchIndex();
}
