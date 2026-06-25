import axios from "axios";
import type { EmulatorSystem } from "@types";
import {
  gamehubMetaSublevel,
  gamehubMetaKey,
  type GameHubMetaEntry,
} from "@main/level/sublevels/gamehub-meta";

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
  const url = `${GAMEHUB_META_BASE_URL}/${system}.json`;

  let data: HostedMetaFile;
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

/** True when the local metadata store already holds at least one entry. */
async function gamehubMetaHasEntries(): Promise<boolean> {
  for await (const _key of gamehubMetaSublevel.keys({ limit: 1 })) {
    return true;
  }
  return false;
}

/**
 * Populate the console metadata store on first run so emulated games render
 * rich cards out of the box. No-ops once cached; runs in the background and
 * swallows network errors.
 */
export async function ensureGameHubMeta(): Promise<void> {
  try {
    if (await gamehubMetaHasEntries()) return;
    await syncAllGameHubMeta();
  } catch (err) {
    console.warn("[gamehub-meta] Background bootstrap failed:", err);
  }
}
