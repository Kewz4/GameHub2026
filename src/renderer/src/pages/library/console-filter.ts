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
  "sony playstation": "ps1",
  "sony playstation 2": "ps2",
  "sony playstation 3": "ps3",
  "sony psp": "psp",
  "nintendo game boy": "gb",
  "nintendo game boy color": "gbc",
  "nintendo game boy advance": "gba",
};

/** The console a library game belongs to, or null if it isn't a console ROM. */
export const systemForGame = (
  game: Pick<Game, "shop" | "platform">
): EmulatorSystem | null => {
  if (game.shop !== "launchbox" || !game.platform) return null;
  const normalized = game.platform.trim().toLowerCase().replace(/\s+/g, " ");
  return PLATFORM_TO_SYSTEM[normalized] ?? null;
};
