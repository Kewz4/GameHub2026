import axios from "axios";
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { EmulatorSystem } from "@types";
import {
  gamehubMetaSublevel,
  gamehubMetaKey,
  type GameHubMetaEntry,
} from "@main/level/sublevels/gamehub-meta";

/**
 * Directory holding the bundled metadata JSON. Packaged builds ship it as an
 * extraResource (`<resources>/gamehub-meta`); a dev run reads it straight from
 * the repo (`<repo>/sources/gamehub-meta`).
 */
const LOCAL_META_DIR = app.isPackaged
  ? path.join(process.resourcesPath, "gamehub-meta")
  : path.join(__dirname, "..", "..", "sources", "gamehub-meta");

function readLocalMeta(system: EmulatorSystem): HostedMetaFile | null {
  try {
    const file = path.join(LOCAL_META_DIR, `${system}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf-8")) as HostedMetaFile;
  } catch {
    return null;
  }
}

/**
 * Hosted GameHub metadata dataset — one static JSON file per system, generated
 * offline by scripts/generate-gamehub-metadata.cjs (SteamGridDB art + IGDB
 * info) and served raw from GitHub, mirroring the Minerva ROM catalogue. This
 * is the "GameHubAPI": a static dataset, not a server.
 */
const GAMEHUB_META_BASE_URL =
  process.env.GAMEHUB_META_BASE_URL ??
  "https://raw.githubusercontent.com/Kewz4/hydra/dev/sources/gamehub-meta";

const META_SYSTEMS: EmulatorSystem[] = [
  "ps1",
  "ps2",
  "ps3",
  "psp",
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
];

interface HostedMetaFile {
  system: EmulatorSystem;
  generatedAt: number;
  games: Record<string, GameHubMetaEntry>;
}

/**
 * Fetch one system's hosted metadata file and store each entry locally. Returns
 * the number of entries stored (0 when the file is missing or empty).
 */
export async function syncGameHubMeta(system: EmulatorSystem): Promise<number> {
  // Prefer the bundled file (always present, no network). Fall back to the
  // hosted dataset only if the local copy is missing.
  let data: HostedMetaFile | null = readLocalMeta(system);

  if (!data) {
    const url = `${GAMEHUB_META_BASE_URL}/${system}.json`;
    try {
      const resp = await axios.get<HostedMetaFile>(url, {
        timeout: 60_000,
        responseType: "json",
      });
      data = resp.data;
    } catch {
      // A system may not have a generated file yet — skip silently.
      return 0;
    }
  }

  const games = data?.games;
  if (!games || typeof games !== "object") return 0;

  const batch = gamehubMetaSublevel.batch();
  let count = 0;
  for (const [normalizedTitle, entry] of Object.entries(games)) {
    batch.put(gamehubMetaKey(system, normalizedTitle), entry);
    count += 1;
  }
  await batch.write();
  return count;
}

/** Sync every system's hosted metadata file. */
export async function syncAllGameHubMeta(): Promise<
  Partial<Record<EmulatorSystem, number>>
> {
  const result: Partial<Record<EmulatorSystem, number>> = {};
  for (const system of META_SYSTEMS) {
    result[system] = await syncGameHubMeta(system);
  }
  return result;
}

/** True when the store already holds an entry for THIS system. */
async function systemHasEntries(system: EmulatorSystem): Promise<boolean> {
  for await (const _key of gamehubMetaSublevel.keys({
    gte: `${system}:`,
    lte: `${system}:\xFF`,
    limit: 1,
  })) {
    return true;
  }
  return false;
}

/**
 * Populate the console metadata store so emulated games render rich cards out
 * of the box. Re-syncs PER SYSTEM: a previous partial/failed bootstrap (which a
 * single global "has any entry" guard would have frozen forever) is repaired
 * because each system is checked independently. Reads the bundled JSON, so it
 * works offline.
 */
export async function ensureGameHubMeta(): Promise<void> {
  for (const system of META_SYSTEMS) {
    try {
      if (await systemHasEntries(system)) continue;
      await syncGameHubMeta(system);
    } catch (err) {
      console.warn(`[gamehub-meta] bootstrap failed for ${system}:`, err);
    }
  }
}
