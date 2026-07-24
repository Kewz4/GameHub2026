import type { HowLongToBeatCategory, EmulatorSystem } from "@types";
import {
  hltbCacheSublevel,
  HLTB_CACHE_TTL_MS,
  HLTB_NEGATIVE_TTL_MS,
} from "@main/level/sublevels/hltb-cache";
import {
  gamehubMetaSublevel,
  gamehubMetaKey,
  normalizeMetaTitle,
} from "@main/level/sublevels/gamehub-meta";
import { fetchHowLongToBeat } from "./hltb-client";

function normalizeKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Console systems that ship a hosted metadata file (mirrors the meta sync). */
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
  "switch",
];

/** Hours (the dataset's grain) -> "12½ Hours" / "45 Mins". Matches the PC HLTB
 *  section's duration format exactly so both render identically. */
function formatHltbHours(hours: number | null | undefined): string | null {
  if (!hours || hours <= 0) return null;
  if (hours < 1) return `${Math.round(hours * 60)} Mins`;
  const halves = Math.round(hours * 2) / 2;
  const whole = Math.floor(halves);
  const frac = halves - whole > 0 ? "½" : "";
  return `${whole}${frac} Hours`;
}

/** Build the shared category list from the dataset's hour figures, dropping any
 *  category the dataset has no time for. */
function categoriesFromDataset(hltb: {
  main: number | null;
  mainExtra: number | null;
  completionist: number | null;
}): HowLongToBeatCategory[] {
  const out: HowLongToBeatCategory[] = [];
  const add = (title: string, hours: number | null) => {
    const duration = formatHltbHours(hours);
    if (duration) out.push({ title, duration, accuracy: "00" });
  };
  add("Main Story", hltb.main);
  add("Main + Extras", hltb.mainExtra);
  add("Completionist", hltb.completionist);
  return out;
}

/** Read the hosted dataset's HLTB for a title — scoped to a system when known,
 *  else the first system whose dataset has a hit. Returns null when the dataset
 *  carries no playtimes for it. */
async function datasetHltb(
  title: string,
  system: EmulatorSystem | "" | undefined
): Promise<HowLongToBeatCategory[] | null> {
  const norm = normalizeMetaTitle(title);
  const systems = system ? [system as EmulatorSystem] : META_SYSTEMS;
  for (const sys of systems) {
    const entry = await gamehubMetaSublevel
      .get(gamehubMetaKey(sys, norm))
      .catch(() => null);
    const hltb = entry?.hltb;
    if (hltb && (hltb.main || hltb.mainExtra || hltb.completionist)) {
      const cats = categoriesFromDataset(hltb);
      if (cats.length) return cats;
    }
  }
  return null;
}

/**
 * HowLongToBeat times for a console/emulated game, by title. Prefers the hosted
 * dataset (offline, reliable — and what makes the emulated HLTB section render
 * identically to the PC-game one via the shared component). Falls back to a
 * LevelDB-cached live HLTB lookup (30d for hits, 3d for misses) only when the
 * dataset has nothing. `system`, when known, scopes the dataset lookup so a
 * game that exists on several consoles resolves to the right one.
 */
export async function getConsoleHowLongToBeat(
  title: string,
  system?: EmulatorSystem | ""
): Promise<HowLongToBeatCategory[] | null> {
  const fromDataset = await datasetHltb(title, system);
  if (fromDataset) return fromDataset;

  const key = normalizeKey(title);
  if (!key) return null;

  const cached = await hltbCacheSublevel.get(key).catch(() => null);
  if (cached) {
    const ttl = cached.categories ? HLTB_CACHE_TTL_MS : HLTB_NEGATIVE_TTL_MS;
    if (Date.now() - cached.cachedAt < ttl) {
      return cached.categories;
    }
  }

  const categories = await fetchHowLongToBeat(title);
  await hltbCacheSublevel
    .put(key, { categories, cachedAt: Date.now() })
    .catch(() => {});
  return categories;
}

export { fetchHowLongToBeat } from "./hltb-client";
