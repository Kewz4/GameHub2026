import { promises as fs } from "node:fs";
import type { Dirent } from "node:fs";
import path from "node:path";

import type { KnownBinary } from "./known-binaries";
import { resolveSniffTarget, sniffDiscImage } from "./sniff-disc-platform";
import type { EmulatorSystem } from "@types";

const MAX_ENTRIES_PER_DIR = 5000;

export interface ScannedGame {
  primaryPath: string;
  name: string;
  sizeBytes: number;
  wrongPlatform: boolean;
}

export interface ScanResult {
  fileCount: number;
  sizeBytes: number;
  games: ScannedGame[];
}

export interface ScanProgress {
  processed: number;
  total: number;
  currentFile: string | null;
  kept: number;
}

export interface ScanOptions {
  onProgress?: (p: ScanProgress) => void;
  signal?: { cancelled: boolean };
}

interface Candidate {
  fullPath: string;
  name: string;
  isMarkerDir: boolean;
}

const matchesExtension = (name: string, extensions: string[]): boolean => {
  const lower = name.toLowerCase();
  return extensions.some((ext) => lower.endsWith(ext));
};

const isDirectoryMarker = (name: string, markers: string[]): boolean =>
  markers.length > 0 && markers.includes(name);

/**
 * Cemu's own data directories. If a user's Wii U ROM folder is (or contains) a
 * Cemu install, these hold installed titles (mlc01/usr/title/<high>/<low>),
 * graphic packs and BCML output — all of which expose code/content/meta and
 * would otherwise be scanned as bogus "games". Never descend into them.
 */
const CEMU_INTERNAL_DIRS = new Set([
  "mlc01",
  "graphicpacks",
  "shadercache",
  "controllerprofiles",
  "gameprofiles",
  "cafelibs",
]);

/** A pure 8-hex folder name is a Wii U title-id segment (e.g. "101c9400"), a
 * Cemu internal path component — never a real game folder name. */
const isTitleIdFolderName = (name: string): boolean =>
  /^[0-9a-f]{8}$/i.test(name);

const extOf = (name: string): string => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
};

const basenameNoExt = (name: string): string => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
};

const PS1_PRIMARY_EXTS = new Set([
  ".cue",
  ".ccd",
  ".mds",
  ".chd",
  ".pbp",
  ".iso",
  ".ecm",
]);
const PS1_PAIR_RULES: Record<string, string[]> = {
  ".cue": [".bin"],
  ".ccd": [".img", ".sub"],
  ".mds": [".mdf"],
};

const PS2_PRIMARY_EXTS = new Set([
  ".iso",
  ".chd",
  ".cso",
  ".zso",
  ".gz",
  ".nrg",
  ".cue",
  ".mds",
]);
const PS2_PAIR_RULES: Record<string, string[]> = {
  ".cue": [".bin"],
  ".mds": [".mdf"],
};

const PS3_LAUNCHABLE_EXTS = new Set([".iso", ".pkg", ".elf", ".self"]);

const SNIFFABLE_EXTS = new Set([
  ".cue",
  ".iso",
  ".img",
  ".mds",
  ".ccd",
  ".bin",
  ".mdf",
]);

const PS3_INTERNAL_FILES = new Set(["eboot.bin", "param.sfo", "ps3_disc.sfb"]);

const DIR_SIZE_ENTRY_CAP = 100_000;

const safeRealpath = async (p: string): Promise<string | null> => {
  try {
    return await fs.realpath(p);
  } catch {
    return null;
  }
};

const safeReaddirTypes = async (dir: string): Promise<Dirent[] | null> => {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
};

const safeStatSize = async (p: string): Promise<number | null> => {
  try {
    return (await fs.stat(p)).size;
  } catch {
    return null;
  }
};

const safeFileSize = async (p: string): Promise<number> =>
  (await safeStatSize(p)) ?? 0;

const computeDirSize = async (root: string): Promise<number> => {
  let total = 0;
  let visited = 0;
  const queue: string[] = [root];
  const seen = new Set<string>();
  for (let dir = queue.shift(); dir !== undefined; dir = queue.shift()) {
    const real = await safeRealpath(dir);
    if (real === null || seen.has(real)) continue;
    seen.add(real);
    const entries = await safeReaddirTypes(dir);
    if (!entries) continue;
    for (const entry of entries) {
      if (visited++ > DIR_SIZE_ENTRY_CAP) return total;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) queue.push(full);
      else if (entry.isFile()) total += await safeFileSize(full);
    }
  }
  return total;
};

type GameClassification = "ok" | "wrong-platform" | "skip";

/**
 * Read a Wii U title's content category from its meta.xml title_id. The high
 * half of the id encodes the type: 00050000 = base game, 0005000E = update/
 * patch, 0005000C = DLC/add-on. Returns "game" when unknown so nothing is lost.
 */
const wiiuContentType = async (
  folderPath: string
): Promise<"game" | "update" | "dlc"> => {
  try {
    const xml = await fs.readFile(
      path.join(folderPath, "meta", "meta.xml"),
      "utf-8"
    );
    const m = xml.match(/<title_id[^>]*>\s*([0-9a-fA-F]{16})\s*<\/title_id>/);
    const high = m?.[1]?.slice(0, 8).toUpperCase();
    if (high === "0005000E") return "update";
    if (high === "0005000C") return "dlc";
    return "game";
  } catch {
    return "game";
  }
};

const classifyForSystem = async (
  candidate: Candidate,
  system: EmulatorSystem
): Promise<GameClassification> => {
  if (candidate.isMarkerDir) {
    // A Wii U folder game may actually be an installed update or DLC — skip
    // those so the scan lists only base games (Cemu installs them as separate
    // code/content/meta titles that would otherwise each look like a game).
    if (system === "wiiu") {
      const ct = await wiiuContentType(candidate.fullPath);
      if (ct !== "game") return "skip";
    }
    return "ok";
  }
  const ext = extOf(candidate.name);

  if (system === "ps3") {
    if (PS3_INTERNAL_FILES.has(candidate.name.toLowerCase())) return "skip";
    if (ext === ".iso") {
      const target = await resolveSniffTarget(candidate.fullPath);
      if (!target) return "ok";
      const detected = await sniffDiscImage(target);
      if (detected === "ps3" || detected === "unknown") return "ok";
      return "wrong-platform";
    }
    return ext === ".pkg" || ext === ".elf" || ext === ".self" ? "ok" : "skip";
  }

  if (!SNIFFABLE_EXTS.has(ext)) return "ok";
  const target = await resolveSniffTarget(candidate.fullPath);
  if (!target) return "ok";
  const detected = await sniffDiscImage(target);
  if (detected === "unknown") return "ok";
  return detected === system ? "ok" : "wrong-platform";
};

interface GameGroup {
  primary: Candidate;
  sidecars: Candidate[];
}

const buildSidecarMap = (
  group: Candidate[],
  pairRules: Record<string, string[]>
): { sidecarOf: Map<string, Candidate[]>; skipped: Set<string> } => {
  const sidecarOf = new Map<string, Candidate[]>();
  const skipped = new Set<string>();
  for (const f of group) {
    const sidecarExts = pairRules[extOf(f.name)];
    if (!sidecarExts) continue;
    const base = basenameNoExt(f.name);
    const matched: Candidate[] = [];
    for (const other of group) {
      if (other === f || basenameNoExt(other.name) !== base) continue;
      if (sidecarExts.includes(extOf(other.name))) {
        matched.push(other);
        skipped.add(other.fullPath);
      }
    }
    sidecarOf.set(f.fullPath, matched);
  }
  return { sidecarOf, skipped };
};

const collectSidecarExts = (
  pairRules: Record<string, string[]>
): Set<string> => {
  const exts = new Set<string>();
  for (const list of Object.values(pairRules)) {
    for (const ext of list) exts.add(ext);
  }
  return exts;
};

const applyPairedRules = (
  group: Candidate[],
  primaryExts: Set<string>,
  pairRules: Record<string, string[]>
): GameGroup[] => {
  const m3u = group.filter((f) => extOf(f.name) === ".m3u");
  if (m3u.length > 0) return m3u.map((primary) => ({ primary, sidecars: [] }));

  const { sidecarOf, skipped } = buildSidecarMap(group, pairRules);
  const sidecarExts = collectSidecarExts(pairRules);

  const out: GameGroup[] = [];
  for (const f of group) {
    if (skipped.has(f.fullPath)) continue;
    const ext = extOf(f.name);
    if (primaryExts.has(ext)) {
      out.push({ primary: f, sidecars: sidecarOf.get(f.fullPath) ?? [] });
    } else if (sidecarExts.has(ext)) {
      out.push({ primary: f, sidecars: [] });
    }
  }
  return out;
};

const applyPs3Rules = (group: Candidate[]): GameGroup[] =>
  group
    .filter((f) => PS3_LAUNCHABLE_EXTS.has(extOf(f.name)))
    .map((primary) => ({ primary, sidecars: [] }));

const dedupGames = (binary: KnownBinary, files: Candidate[]): GameGroup[] => {
  const markerDirs = files.filter((f) => f.isMarkerDir);
  const regular = files.filter((f) => !f.isMarkerDir);

  const byDir = new Map<string, Candidate[]>();
  for (const f of regular) {
    const parent = path.dirname(f.fullPath);
    const arr = byDir.get(parent) ?? [];
    arr.push(f);
    byDir.set(parent, arr);
  }

  // Extracted titles (e.g. Wii U "loadiine" / Cemu folder games) expose
  // `code` / `content` / `meta` sub-directories. Collapse every marker triplet
  // up to its shared parent so the game is counted ONCE, named after the parent
  // folder — not three bogus games named "code"/"content"/"meta".
  const markerParents = new Map<string, Candidate>();
  for (const m of markerDirs) {
    const parent = path.dirname(m.fullPath);
    const parentName = path.basename(parent);
    // A title-id-named parent (e.g. "101c9400") is a Cemu title folder, not a
    // real game — drop it so installed titles don't show up as games.
    if (isTitleIdFolderName(parentName)) continue;
    if (!markerParents.has(parent)) {
      markerParents.set(parent, {
        fullPath: parent,
        name: parentName,
        isMarkerDir: true,
      });
    }
  }

  const games: GameGroup[] = [...markerParents.values()].map((primary) => ({
    primary,
    sidecars: [],
  }));
  // Only PlayStation discs need pairing/sniffing rules. Every other console
  // (carts, handhelds, single-file Wii U/Cemu .wua/.wux, GC/Wii images) is a
  // single ROM file per game — each collected candidate (already filtered to the
  // system's romExtensions) is its own game. Previously these all fell through
  // to PS1 disc rules, which dropped any file whose extension wasn't a PS1 disc
  // ext (.cue/.iso/…) — i.e. it silently found ZERO games for gb/gba/nds/n64/
  // 3ds/wiiu/wii/gc, matching the "scanning finds nothing" bug.
  for (const [, group] of byDir) {
    if (binary.system === "ps3") {
      games.push(...applyPs3Rules(group));
    } else if (binary.system === "ps2") {
      games.push(...applyPairedRules(group, PS2_PRIMARY_EXTS, PS2_PAIR_RULES));
    } else if (binary.system === "ps1") {
      games.push(...applyPairedRules(group, PS1_PRIMARY_EXTS, PS1_PAIR_RULES));
    } else {
      // Single-file systems: one game per ROM file.
      for (const f of group) games.push({ primary: f, sidecars: [] });
    }
  }
  return games;
};

const collectEntry = (
  entry: Dirent,
  dir: string,
  binary: KnownBinary,
  scanSubfolders: boolean,
  candidates: Candidate[],
  queue: string[]
): void => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) {
    // Never recurse into Cemu's own data dirs — their installed titles /
    // graphic packs / BCML output masquerade as code/content/meta games.
    if (CEMU_INTERNAL_DIRS.has(entry.name.toLowerCase())) return;
    if (isDirectoryMarker(entry.name, binary.romDirectoryMarkers)) {
      candidates.push({ fullPath: full, name: entry.name, isMarkerDir: true });
    } else if (scanSubfolders) {
      queue.push(full);
    }
    return;
  }
  if (!entry.isFile()) return;
  if (matchesExtension(entry.name, binary.romExtensions)) {
    candidates.push({ fullPath: full, name: entry.name, isMarkerDir: false });
  }
};

const collectCandidates = async (
  rootPath: string,
  binary: KnownBinary,
  scanSubfolders: boolean
): Promise<Candidate[]> => {
  const candidates: Candidate[] = [];
  const queue: string[] = [rootPath];
  const seen = new Set<string>();

  for (let dir = queue.shift(); dir !== undefined; dir = queue.shift()) {
    const real = await safeRealpath(dir);
    if (real === null || seen.has(real)) continue;
    seen.add(real);

    const entries = await safeReaddirTypes(dir);
    if (!entries || entries.length > MAX_ENTRIES_PER_DIR) continue;

    for (const entry of entries) {
      collectEntry(entry, dir, binary, scanSubfolders, candidates, queue);
    }
  }

  return candidates;
};

const sizeGame = async (
  game: GameGroup
): Promise<{ countedFiles: number; sizeBytes: number }> => {
  let gameSize = 0;
  let countedFiles = 0;

  if (game.primary.isMarkerDir) {
    gameSize += await computeDirSize(game.primary.fullPath);
    countedFiles = 1;
  } else {
    const size = await safeStatSize(game.primary.fullPath);
    if (size !== null) {
      countedFiles = 1;
      gameSize += size;
    }
  }

  for (const sidecar of game.sidecars) {
    gameSize += await safeFileSize(sidecar.fullPath);
  }

  return { countedFiles, sizeBytes: gameSize };
};

export const scanRomFolder = async (
  rootPath: string,
  binary: KnownBinary,
  scanSubfolders: boolean,
  options?: ScanOptions
): Promise<ScanResult> => {
  const raw = await collectCandidates(rootPath, binary, scanSubfolders);
  const games = dedupGames(binary, raw);
  const total = games.length;

  let fileCount = 0;
  let sizeBytes = 0;
  let processed = 0;
  const scannedGames: ScannedGame[] = [];

  options?.onProgress?.({ processed: 0, total, currentFile: null, kept: 0 });

  for (const game of games) {
    if (options?.signal?.cancelled) break;

    const classification = await classifyForSystem(game.primary, binary.system);
    if (classification !== "skip") {
      const sized = await sizeGame(game);
      if (classification === "ok") {
        fileCount += sized.countedFiles;
        sizeBytes += sized.sizeBytes;
      }
      scannedGames.push({
        primaryPath: game.primary.fullPath,
        name: game.primary.name,
        sizeBytes: sized.sizeBytes,
        wrongPlatform: classification === "wrong-platform",
      });
    }

    processed += 1;
    options?.onProgress?.({
      processed,
      total,
      currentFile: game.primary.name,
      kept: scannedGames.length,
    });
  }

  return { fileCount, sizeBytes, games: scannedGames };
};

export const countRomGroups = async (
  rootPath: string,
  binary: KnownBinary,
  scanSubfolders: boolean
): Promise<number> => {
  const raw = await collectCandidates(rootPath, binary, scanSubfolders);
  return dedupGames(binary, raw).length;
};
