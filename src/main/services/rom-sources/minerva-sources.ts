import axios from "axios";
import type { EmulatorSystem } from "@types";
import {
  minervaCatalogueSublevel,
  type MinervaCatalogueEntry,
} from "@main/level/sublevels/minerva-catalogue";
import { normalizeTitle } from "./minerva-source";

/**
 * Hosted Minerva catalogue. Each platform is a static JSON file (Hydra download
 * source format) generated offline from minerva's hash database and committed to
 * the repo, then served raw from GitHub — mirroring how hydralinks.cloud serves
 * source files. This replaces live per-page scraping with a single fast fetch.
 */
const MINERVA_SOURCES_BASE_URL =
  process.env.MINERVA_SOURCES_BASE_URL ??
  "https://raw.githubusercontent.com/Kewz4/hydra/dev/sources/minerva";

/** The shared tracker list minerva appends to every magnet (from its rom.js). */
const MINERVA_TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://tracker.openbittorrent.com:6969/announce",
  "http://tracker.openbittorrent.com:80/announce",
  "https://opentracker.i2p.rocks:443/announce",
  "udp://open.demonii.com:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://exodus.desync.com:6969/announce",
  "udp://explodie.org:6969/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://opentracker.io:6969/announce",
  "udp://bt1.archive.org:6969/announce",
  "udp://bt.ktrackers.com:6666/announce",
];

const trackerSuffix = MINERVA_TRACKERS.map(
  (t) => `&tr=${encodeURIComponent(t)}`
).join("");

interface MinervaSourceDownload {
  title: string;
  fileSize: string | null;
  uris: string[];
  uploadDate: string | null;
  fileName?: string;
  contentType?: "game" | "update" | "dlc";
  titleId?: string | null;
}

interface MinervaSourceFile {
  name: string;
  downloads: MinervaSourceDownload[];
}

const ALL_SYSTEMS: EmulatorSystem[] = [
  "n3ds",
  "nds",
  "dsi",
  "n64",
  "gb",
  "gbc",
  "gba",
  "wiiu",
  "wii",
  "gc",
  "ps1",
  "ps2",
  "ps3",
  "psp",
];

/**
 * Map from key prefix stored in LevelDB to the JSON filename that feeds it.
 * Prefixes ending in "-upd:" / "-dlc:" are supplemental catalogues for
 * PS3 and WiiU; they are keyed separately so base-game searches remain fast.
 */
const SUPPLEMENTAL_SOURCES: Array<{
  prefix: string;
  file: string;
  system: EmulatorSystem;
  defaultContentType: "game" | "update" | "dlc";
}> = [
  {
    prefix: "ps3-upd:",
    file: "ps3-updates.json",
    system: "ps3",
    defaultContentType: "update",
  },
  {
    prefix: "ps3-dlc:",
    file: "ps3-dlc.json",
    system: "ps3",
    defaultContentType: "dlc",
  },
  {
    prefix: "wiiu-upd:",
    file: "wiiu-updates.json",
    system: "wiiu",
    defaultContentType: "update",
  },
  {
    prefix: "wiiu-dlc:",
    file: "wiiu-dlc.json",
    system: "wiiu",
    defaultContentType: "dlc",
  },
];

/** Attach the shared tracker list to a base magnet (if not already present). */
function withTrackers(magnet: string): string {
  if (!magnet.startsWith("magnet:")) return magnet;
  if (magnet.includes("&tr=")) return magnet;
  return magnet + trackerSuffix;
}

/**
 * Fetch the hosted source file for one system and populate the local catalogue
 * sublevel. Returns the number of entries stored.
 *
 * For entries whose JSON includes a `contentType` field the routing is:
 *   "game"   → key prefix `${system}:`
 *   "update" → key prefix `${system}-upd:`
 *   "dlc"    → key prefix `${system}-dlc:`
 */
export async function syncMinervaSource(
  system: EmulatorSystem
): Promise<number> {
  const url = `${MINERVA_SOURCES_BASE_URL}/${system}.json`;

  let data: MinervaSourceFile;
  try {
    const resp = await axios.get<MinervaSourceFile>(url, {
      timeout: 60_000,
      responseType: "json",
    });
    data = resp.data;
  } catch (err) {
    console.warn(`[minerva] Failed to fetch source for ${system}:`, err);
    return 0;
  }

  if (!data?.downloads?.length) return 0;

  const now = Date.now();
  let count = 0;
  const batch = minervaCatalogueSublevel.batch();

  for (const download of data.downloads) {
    const magnet = download.uris?.[0] ? withTrackers(download.uris[0]) : null;
    const ct = download.contentType ?? "game";
    const prefix =
      ct === "update"
        ? `${system}-upd:`
        : ct === "dlc"
          ? `${system}-dlc:`
          : `${system}:`;

    const entry: MinervaCatalogueEntry = {
      system,
      title: download.title,
      region: null,
      filename: download.fileName ?? download.title,
      romPath: "",
      magnet,
      torrentUrl: null,
      fileSize: download.fileSize,
      contentType: ct,
      titleId: download.titleId ?? null,
    };
    const key = `${prefix}${normalizeTitle(download.title)}`;
    batch.put(key, { entry, cachedAt: now });
    count += 1;
  }

  await batch.write();
  return count;
}

/**
 * Fetch a supplemental source file (updates / DLC) and store it under a fixed
 * key prefix so base-game searches remain separate.
 */
async function syncSupplementalSource(opts: {
  prefix: string;
  file: string;
  system: EmulatorSystem;
  defaultContentType: "game" | "update" | "dlc";
}): Promise<number> {
  const url = `${MINERVA_SOURCES_BASE_URL}/${opts.file}`;

  let data: MinervaSourceFile;
  try {
    const resp = await axios.get<MinervaSourceFile>(url, {
      timeout: 60_000,
      responseType: "json",
    });
    data = resp.data;
  } catch {
    // Supplemental files may not exist yet — silently skip.
    return 0;
  }

  if (!data?.downloads?.length) return 0;

  const now = Date.now();
  let count = 0;
  const batch = minervaCatalogueSublevel.batch();

  for (const download of data.downloads) {
    const magnet = download.uris?.[0] ? withTrackers(download.uris[0]) : null;
    const ct = download.contentType ?? opts.defaultContentType;
    const entry: MinervaCatalogueEntry = {
      system: opts.system,
      title: download.title,
      region: null,
      filename: download.fileName ?? download.title,
      romPath: "",
      magnet,
      torrentUrl: null,
      fileSize: download.fileSize,
      contentType: ct,
      titleId: download.titleId ?? null,
    };
    const key = `${opts.prefix}${normalizeTitle(download.title)}`;
    batch.put(key, { entry, cachedAt: now });
    count += 1;
  }

  await batch.write();
  return count;
}

/** Sync the hosted catalogue for every supported system (including updates/DLC). */
export async function syncAllMinervaSources(): Promise<
  Partial<Record<EmulatorSystem, number>>
> {
  const result: Partial<Record<EmulatorSystem, number>> = {};
  for (const system of ALL_SYSTEMS) {
    result[system] = await syncMinervaSource(system);
  }
  for (const supp of SUPPLEMENTAL_SOURCES) {
    await syncSupplementalSource(supp);
  }
  return result;
}

/** True when the local catalogue already holds at least one entry. */
async function minervaCatalogueHasEntries(): Promise<boolean> {
  for await (const _key of minervaCatalogueSublevel.keys({ limit: 1 })) {
    return true;
  }
  return false;
}

/**
 * Populate the catalogue on first run so console games are searchable without
 * the user manually pressing "Refresh" in settings. No-ops once cached; runs
 * in the background and swallows network errors.
 */
export async function ensureMinervaCatalogue(): Promise<void> {
  try {
    if (await minervaCatalogueHasEntries()) return;
    await syncAllMinervaSources();
  } catch (err) {
    console.warn("[minerva] Background catalogue bootstrap failed:", err);
  }
}
