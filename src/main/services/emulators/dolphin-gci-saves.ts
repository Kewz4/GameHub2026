import fs from "node:fs";
import path from "node:path";
import { emulatorUserPaths } from "./emulator-user-paths";

const GCI_FOLDER_DEVICE = "8";
const GAMECUBE_REGIONS = ["USA", "JAP", "EUR", "DEV"] as const;
const MAX_GCI_SCAN_ENTRIES = 20_000;

type IniSection = Map<string, string>;

const readIniSection = (file: string, wantedSection: string): IniSection => {
  let contents: string;
  try {
    contents = fs.readFileSync(file, "utf8");
  } catch {
    return new Map();
  }

  const values = new Map<string, string>();
  let section = "";
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const sectionMatch = /^\[([^\]]+)]$/.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1].trim().toLowerCase();
      continue;
    }
    if (section !== wantedSection.toLowerCase()) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    values.set(
      line.slice(0, separator).trim().toLowerCase(),
      line.slice(separator + 1).trim()
    );
  }
  return values;
};

const isGciFolderDevice = (
  value: string | undefined,
  defaultValue: boolean
) => {
  if (value === undefined) return defaultValue;
  return value.trim().toLowerCase() === GCI_FOLDER_DEVICE;
};

const hasCustomGciFolder = (core: IniSection, slot: "a" | "b") =>
  Boolean(core.get(`gcifolder${slot}path`)?.trim());

/**
 * Resolve only Dolphin's standard, portable GCI-folder destinations.
 *
 * Modern Dolphin defaults Slot A to device 8 (MemoryCardFolder) and Slot B to
 * disabled. An explicit raw-card device, a per-game override, or a custom GCI
 * path fails closed: GameHub must not guess a destination whose region/path
 * transformation is controlled by Dolphin rather than this installation.
 */
export const resolveDolphinGciCardFolders = (
  installDir: string,
  gameCode: string
): string[] => {
  if (!/^[A-Z0-9]{6}$/.test(gameCode)) return [];

  const roots = emulatorUserPaths("dolphin", installDir);
  const configRoot = roots.config;
  const globalCore = readIniSection(
    path.join(configRoot, "Dolphin.ini"),
    "Core"
  );
  const gameCore = readIniSection(
    path.join(roots.data, "GameSettings", `${gameCode}.ini`),
    "Core"
  );
  const gcRoot = path.join(roots.data, "GC");
  const folders: string[] = [];

  for (const [slot, defaultFolderMode] of [
    ["a", true],
    ["b", false],
  ] as const) {
    const slotValue =
      gameCore.get(`slot${slot}`) ?? globalCore.get(`slot${slot}`);
    if (!isGciFolderDevice(slotValue, defaultFolderMode)) continue;

    // A game-specific custom path wins over the global one. Supporting either
    // requires reproducing Dolphin's region rewriting exactly, including paths
    // outside the portable install, so leave it to a user-approved mapping.
    if (
      hasCustomGciFolder(gameCore, slot) ||
      hasCustomGciFolder(globalCore, slot)
    ) {
      continue;
    }

    const cardName = slot === "a" ? "Card A" : "Card B";
    folders.push(
      ...GAMECUBE_REGIONS.map((region) => path.join(gcRoot, region, cardName))
    );
  }

  return folders;
};

const readGciGameCode = (file: string): string | null => {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, "r");
    const header = Buffer.alloc(4);
    if (fs.readSync(fd, header, 0, header.length, 0) !== header.length) {
      return null;
    }
    const code = header.toString("ascii");
    return /^[A-Z0-9]{4}$/.test(code) ? code : null;
  } catch {
    return null;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
};

/** Find only GCI payloads Dolphin itself associates with this game code. */
export const findDolphinGciFilesForGame = (
  cardFolders: readonly string[],
  gameCode: string
): string[] => {
  if (!/^[A-Z0-9]{6}$/.test(gameCode)) return [];
  const wanted = gameCode.slice(0, 4);
  const matches: string[] = [];
  const stack = [...cardFolders];
  let visited = 0;

  while (stack.length > 0 && visited < MAX_GCI_SCAN_ENTRIES) {
    const current = stack.pop()!;
    visited += 1;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (
        entry.isFile() &&
        path.extname(entry.name).toLowerCase() === ".gci" &&
        readGciGameCode(full) === wanted
      ) {
        matches.push(full);
      }
    }
  }

  return matches.sort((left, right) => left.localeCompare(right));
};

export const buildDolphinGciRestorePatterns = (
  cardFolders: readonly string[]
): string[] => cardFolders.map((folder) => path.join(folder, "*.gci"));
