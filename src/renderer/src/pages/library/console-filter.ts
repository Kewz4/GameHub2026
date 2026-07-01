import type { EmulatorSystem, Game } from "@types";

/**
 * The consoles offered in the Library "Console" filter pill. For now this is the
 * RALibretro set the user asked for (PS1, N64, GBA, PSP, DS, DSi); expanding it
 * later is just adding entries here.
 */
export const CONSOLE_FILTER_SYSTEMS: EmulatorSystem[] = [
  "ps1",
  "n64",
  "gba",
  "psp",
  "nds",
  "dsi",
];

/** Display labels for the console options. */
export const CONSOLE_LABELS: Partial<Record<EmulatorSystem, string>> = {
  ps1: "PlayStation",
  n64: "Nintendo 64",
  gba: "Game Boy Advance",
  psp: "PSP",
  nds: "Nintendo DS",
  dsi: "Nintendo DSi",
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
