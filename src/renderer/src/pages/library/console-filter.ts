import type { EmulatorSystem, Game } from "@types";

/**
 * Every console offered in the Library "Console" filter pill — the full set of
 * systems GameHub emulates.
 */
export const CONSOLE_FILTER_SYSTEMS: EmulatorSystem[] = [
  "ps1",
  "ps2",
  "ps3",
  "psp",
  "n64",
  "gc",
  "wii",
  "wiiu",
  "n3ds",
  "nds",
  "dsi",
  "gba",
  "gb",
  "gbc",
  "switch",
];

/** Display labels for the console options. */
export const CONSOLE_LABELS: Partial<Record<EmulatorSystem, string>> = {
  ps1: "PlayStation",
  ps2: "PlayStation 2",
  ps3: "PlayStation 3",
  psp: "PSP",
  n64: "Nintendo 64",
  gc: "GameCube",
  wii: "Wii",
  wiiu: "Wii U",
  n3ds: "Nintendo 3DS",
  nds: "Nintendo DS",
  dsi: "Nintendo DSi",
  gba: "Game Boy Advance",
  gb: "Game Boy",
  gbc: "Game Boy Color",
  switch: "Nintendo Switch",
};

/**
 * Maps a launchbox game's `platform` string back to its EmulatorSystem. Accepts
 * every spelling our import paths stamp (SYSTEM_DEFAULT_PLATFORM and
 * SYSTEM_CATALOGUE_PLATFORM), mirroring the RetroAchievements watcher.
 */
const PLATFORM_TO_SYSTEM: Record<string, EmulatorSystem> = {
  playstation: "ps1",
  "playstation 2": "ps2",
  "playstation 3": "ps3",
  "playstation portable": "psp",
  "nintendo 3ds": "n3ds",
  "nintendo ds": "nds",
  "nintendo dsi": "dsi",
  "nintendo 64": "n64",
  "game boy": "gb",
  "game boy color": "gbc",
  "game boy advance": "gba",
  "nintendo wii u": "wiiu",
  "nintendo wii": "wii",
  "nintendo gamecube": "gc",
  "nintendo switch": "switch",
  "sony playstation": "ps1",
  "sony playstation 2": "ps2",
  "sony playstation 3": "ps3",
  "sony psp": "psp",
  "nintendo game boy": "gb",
  "nintendo game boy color": "gbc",
  "nintendo game boy advance": "gba",
};

/**
 * Extract the EmulatorSystem from a launchbox objectId. Minerva/catalogue games
 * use `minerva:<system>:<normalizedTitle>`; imported ROMs use
 * `local-<system>-<hash>`. This mirrors `systemFromObjectId` in
 * src/main/helpers/index.ts.
 */
function systemFromObjectId(objectId: string): EmulatorSystem | null {
  if (objectId.startsWith("minerva:")) {
    const system = objectId.split(":")[1];
    return (CONSOLE_FILTER_SYSTEMS as string[]).includes(system)
      ? (system as EmulatorSystem)
      : null;
  }
  const local = objectId.match(/^local-([a-z0-9]+)-/i);
  if (local) {
    const system = local[1].toLowerCase();
    return (CONSOLE_FILTER_SYSTEMS as string[]).includes(system)
      ? (system as EmulatorSystem)
      : null;
  }
  return null;
}

/**
 * GB/GBC/GBA share one merged catalogue + one emulator; the catalogue stamps
 * every Game Boy title "gba" (baked into the objectId as minerva:gba:…). Once a
 * ROM is bound, its EXTENSION is the ground truth, so the real subtype is
 * resolved from the selected disc. Mirrors resolveEffectiveSystem in
 * src/main/helpers/index.ts.
 */
const GB_FAMILY_SYSTEMS: ReadonlySet<EmulatorSystem> = new Set([
  "gb",
  "gbc",
  "gba",
]);

const gbFamilySystemFromPath = (
  romPath: string | null | undefined
): EmulatorSystem | null => {
  if (!romPath) return null;
  const dot = romPath.lastIndexOf(".");
  const ext = dot > 0 ? romPath.slice(dot).toLowerCase() : "";
  if (ext === ".gb") return "gb";
  if (ext === ".gbc" || ext === ".cgb" || ext === ".sgb") return "gbc";
  if (ext === ".gba" || ext === ".agb") return "gba";
  return null;
};

/** For a GB-family game with a bound ROM, the file extension wins over the
 *  catalogue's blanket "gba"; everything else passes through unchanged. */
export const resolveEffectiveSystem = (
  stored: EmulatorSystem | null,
  romPath: string | null | undefined
): EmulatorSystem | null => {
  if (stored && GB_FAMILY_SYSTEMS.has(stored)) {
    return gbFamilySystemFromPath(romPath) ?? stored;
  }
  return stored;
};

/**
 * The console a library game belongs to, or null if it isn't a console ROM.
 * Tries `game.platform` first (set by bindDownloadedRom after download
 * completes); falls back to extracting the system from `game.objectId` (set
 * at catalogue-add time, before the download finishes) so games that are in
 * the library but not yet downloaded still appear in the Console dropdown.
 * For the merged GB family, the bound ROM's extension overrides both.
 */
export const systemForGame = (
  game: Pick<
    Game,
    "shop" | "platform" | "objectId" | "selectedDiscPath" | "discs"
  >
): EmulatorSystem | null => {
  if (game.shop !== "launchbox") return null;

  let stored: EmulatorSystem | null = null;

  // Primary: platform string (set after download by bindDownloadedRom).
  if (game.platform) {
    const normalized = game.platform.trim().toLowerCase().replace(/\s+/g, " ");
    stored = PLATFORM_TO_SYSTEM[normalized] ?? null;
  }

  // Fallback: extract from objectId (set at catalogue-add time, before
  // download completes). This is what makes games appear in the Console
  // dropdown even when they haven't been downloaded yet.
  if (!stored && game.objectId) {
    stored = systemFromObjectId(game.objectId);
  }

  return resolveEffectiveSystem(
    stored,
    game.selectedDiscPath ?? game.discs?.[0]?.path
  );
};
