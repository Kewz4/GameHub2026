import axios from "axios";
import { JSDOM } from "jsdom";
import UserAgent from "user-agents";
import path from "node:path";
import fs from "node:fs";
import { THEMES_PATH } from "@main/constants";

export const getFileBuffer = async (url: string) =>
  fetch(url, { method: "GET" }).then((response) =>
    response.arrayBuffer().then((buffer) => Buffer.from(buffer))
  );

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const requestWebPage = async (url: string) => {
  const userAgent = new UserAgent();

  const data = await axios
    .get(url, {
      headers: {
        "User-Agent": userAgent.toString(),
      },
    })
    .then((response) => response.data);

  const { window } = new JSDOM(data);
  return window.document;
};

export const isPortableVersion = () => {
  return !!process.env.PORTABLE_EXECUTABLE_FILE;
};

export const normalizePath = (str: string) =>
  path.posix.normalize(str).replaceAll("\\", "/");

export const addTrailingSlash = (str: string) =>
  str.endsWith("/") ? str : `${str}/`;

const sanitizeFolderName = (name: string): string => {
  return name
    .toLowerCase()
    .replaceAll(/[^a-z0-9-_\s]/g, "")
    .replaceAll(/\s+/g, "-")
    .replaceAll(/-+/g, "-")
    .replaceAll(/(^-|-$)/g, "");
};

export const getThemePath = (themeId: string, themeName?: string): string => {
  if (themeName) {
    const sanitizedName = sanitizeFolderName(themeName);
    if (sanitizedName) {
      return path.join(THEMES_PATH, sanitizedName);
    }
  }
  return path.join(THEMES_PATH, themeId);
};

export const getThemeSoundPath = (
  themeId: string,
  themeName?: string
): string | null => {
  const themeDir = getThemePath(themeId, themeName);
  const legacyThemeDir = themeName ? path.join(THEMES_PATH, themeId) : null;

  const checkDir = (dir: string): string | null => {
    if (!fs.existsSync(dir)) {
      return null;
    }

    const formats = ["wav", "mp3", "ogg", "m4a"];

    for (const format of formats) {
      const soundPath = path.join(dir, `achievement.${format}`);
      if (fs.existsSync(soundPath)) {
        return soundPath;
      }
    }

    return null;
  };

  const soundPath = checkDir(themeDir);
  if (soundPath) {
    return soundPath;
  }

  if (legacyThemeDir) {
    return checkDir(legacyThemeDir);
  }

  return null;
};

export * from "./reg-parser";
export * from "./launch-game";
export * from "./game-executable-path";
export * from "./open-native-game-executable";
export * from "./download-error-handler";
export * from "./download-game-helper";
export * from "./global-trackers";
export * from "./launch-classics-game";

import type { EmulatorSystem } from "@types";

/**
 * Resolve an EmulatorSystem from a stored platform string, an exact system key,
 * or a `minerva:<system>:...` / `local-<system>-...` objectId prefix. Covers
 * every supported console — not just PlayStation — so launch/metadata/scan code
 * can route a game to the correct emulator binary. Mirrors the renderer's
 * `platformToEmulatorSystem`.
 */
export const platformToSystem = (
  platform: string | null | undefined
): EmulatorSystem | null => {
  if (!platform) return null;
  const p = platform.toLowerCase();

  // Fast path: an exact EmulatorSystem key (search dropdown / synthetic ids).
  const EXACT: EmulatorSystem[] = [
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
  if ((EXACT as string[]).includes(p)) return p as EmulatorSystem;

  if (p.includes("playstation 3") || p.includes("ps3")) return "ps3";
  if (p.includes("playstation 2") || p.includes("ps2")) return "ps2";
  if (p.includes("playstation portable") || p.includes("psp")) return "psp";
  if (p.includes("playstation") || p.includes("ps1") || p.includes("psx"))
    return "ps1";
  if (p.includes("nintendo 64") || p.includes("n64")) return "n64";
  if (p.includes("game boy advance") || p.includes("gba")) return "gba";
  if (p.includes("game boy color") || p.includes("gbc")) return "gbc";
  if (p.includes("game boy")) return "gb";
  if (p.includes("nintendo dsi") || p.includes("dsi")) return "dsi";
  if (p.includes("nintendo 3ds") || p.includes("3ds")) return "n3ds";
  if (p.includes("nintendo ds") || p.includes("nds")) return "nds";
  if (p.includes("nintendo switch") || p.includes("switch")) return "switch";
  if (p.includes("wii u") || p.includes("wiiu")) return "wiiu";
  if (p.includes("gamecube") || p.includes("gc")) return "gc";
  if (p.includes("wii")) return "wii";
  return null;
};

/**
 * GB / GBC / GBA share ONE merged catalogue (Dump/gb_gba_gbc) and ONE emulator
 * (RALibretro's mGBA core, keyed per-system). The catalogue can't tell the
 * three apart before download, so every entry is stamped "gba" — which then
 * bakes into the objectId (minerva:gba:…). Once a ROM exists, its EXTENSION is
 * the ground truth (.gb → gb, .gbc/.cgb/.sgb → gbc, .gba/.agb → gba), so the
 * real subtype is resolved from the bound disc wherever it matters (launch
 * systemId, console badge, achievements, metadata).
 */
export const GB_FAMILY_SYSTEMS: ReadonlySet<EmulatorSystem> = new Set([
  "gb",
  "gbc",
  "gba",
]);

/** The real GB-family system from a ROM/disc path's extension, or null when the
 *  path isn't a GB-family ROM. */
export const gbFamilySystemFromPath = (
  romPath: string | null | undefined
): EmulatorSystem | null => {
  if (!romPath) return null;
  const ext = path.extname(romPath).toLowerCase();
  if (ext === ".gb") return "gb";
  if (ext === ".gbc" || ext === ".cgb" || ext === ".sgb") return "gbc";
  if (ext === ".gba" || ext === ".agb") return "gba";
  return null;
};

/**
 * The system to actually use for a launchbox game. For a GB-family game with a
 * bound ROM, the file extension wins over `stored` (the objectId/platform
 * system, which is the merged catalogue's "gba" guess and is unreliable for
 * this family). Everything else passes through unchanged.
 */
export const resolveEffectiveSystem = (
  stored: EmulatorSystem | null | undefined,
  romPath: string | null | undefined
): EmulatorSystem | null => {
  if (stored && GB_FAMILY_SYSTEMS.has(stored)) {
    return gbFamilySystemFromPath(romPath) ?? stored;
  }
  return stored ?? null;
};

/** Human folder name for each console, used to group emulator downloads under
 *  "Emulator Games/<platform>" instead of dumping the torrent's own tree. */
const EMULATOR_PLATFORM_FOLDER: Record<EmulatorSystem, string> = {
  ps1: "PS1 Games",
  ps2: "PS2 Games",
  ps3: "PS3 Games",
  psp: "PSP Games",
  n3ds: "3DS Games",
  nds: "DS Games",
  dsi: "DSi Games",
  n64: "N64 Games",
  gb: "GB Games",
  gbc: "GBC Games",
  gba: "GBA Games",
  wiiu: "Wii U Games",
  wii: "Wii Games",
  gc: "GameCube Games",
  switch: "Switch Games",
};

export const EMULATOR_GAMES_ROOT = "Emulator Games";

/** Relative folder (e.g. "Emulator Games/Wii U Games") a console download for
 *  `system` should be stored under. */
export const emulatorPlatformFolder = (
  system: EmulatorSystem | null | undefined
): string | null => {
  if (!system) return null;
  const folder = EMULATOR_PLATFORM_FOLDER[system];
  return folder ? `${EMULATOR_GAMES_ROOT}/${folder}` : null;
};

/**
 * Extract the EmulatorSystem encoded in a launchbox objectId. Minerva games use
 * `minerva:<system>:<normalizedTitle>`; imported ROMs use `local-<system>-<hash>`.
 * Returns null for opaque launchbox ids (fall back to the stored platform).
 */
export const systemFromObjectId = (objectId: string): EmulatorSystem | null => {
  if (objectId.startsWith("minerva:")) {
    return platformToSystem(objectId.split(":")[1] ?? null);
  }
  const local = objectId.match(/^local-([a-z0-9]+)-/i);
  if (local) return platformToSystem(local[1]);
  return null;
};
