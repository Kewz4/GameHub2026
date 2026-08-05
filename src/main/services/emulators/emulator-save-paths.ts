import fs from "node:fs";
import path from "node:path";

interface StoredRomGame {
  selectedDiscPath?: string | null;
  discs?: Array<{ path?: string | null }> | null;
  executablePath?: string | null;
}

const isExistingPath = (
  candidate: string | null | undefined
): candidate is string => {
  if (!candidate) return false;
  try {
    return fs.existsSync(candidate);
  } catch {
    return false;
  }
};

/** Resolve the real ROM target using the same priority as the launcher. */
export const resolveStoredGameRomPath = (
  game: StoredRomGame | null | undefined
): string | null => {
  if (!game) return null;
  if (isExistingPath(game.selectedDiscPath)) return game.selectedDiscPath;

  for (const disc of game.discs ?? []) {
    if (isExistingPath(disc.path)) return disc.path;
  }

  return isExistingPath(game.executablePath) ? game.executablePath : null;
};

const RALIBRETRO_SAVE_SUFFIX =
  /^(?:sram|srm|sav|dsv|rtc|eep|fla|sra|mpk|mcd|mcr)(?:\.\d+)?$/i;

const RALIBRETRO_SAVE_EXTENSIONS = [
  "sram",
  "srm",
  "sav",
  "dsv",
  "rtc",
  "eep",
  "fla",
  "sra",
  "mpk",
  "mcd",
  "mcr",
] as const;

interface EmulatorRestorePatternOptions {
  system: string;
  binary: string;
  roots: string[];
  romPath?: string | null;
  /** Exact platform title id/game code resolved from the ROM or emulator DB. */
  identity?: string | null;
}

const findSwitchProfileRoots = (root: string): string[] => {
  const profiles: string[] = [];
  let accounts: fs.Dirent[];
  try {
    accounts = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return profiles;
  }

  for (const account of accounts) {
    if (!account.isDirectory()) continue;
    const accountPath = path.join(root, account.name);
    let users: fs.Dirent[];
    try {
      users = fs.readdirSync(accountPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const user of users) {
      if (user.isDirectory() && /^[0-9a-f]{32}$/i.test(user.name)) {
        profiles.push(path.join(accountPath, user.name));
      }
    }
  }
  return profiles.sort((left, right) => left.localeCompare(right));
};

const findThreeDsTitleRoots = (roots: string[]): string[] => {
  const titleRoots: string[] = [];
  const stack = [...roots];
  let visited = 0;
  while (stack.length > 0 && visited < 20_000) {
    const current = stack.pop()!;
    visited++;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = path.join(current, entry.name);
      if (entry.name.toLowerCase() === "title") titleRoots.push(full);
      else stack.push(full);
    }
  }
  return titleRoots.sort((left, right) => left.localeCompare(right));
};

const findRpcs3TitleSaveRoots = (
  roots: string[],
  identity: string
): string[] => {
  const normalizedIdentity = identity.toLowerCase();
  const matches: string[] = [];

  for (const root of roots) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        entry.name.toLowerCase().startsWith(normalizedIdentity)
      ) {
        matches.push(path.join(root, entry.name));
      }
    }
  }

  return matches.sort((left, right) => left.localeCompare(right));
};

/**
 * Exact, prospective restore destinations for an emulator title. Unlike backup
 * discovery these may contain globs and do not require a save to exist yet, so
 * a clean install can receive a cloud save without ever exposing a shared
 * console root. Known local profiles are emitted separately; the restore job
 * planner rejects the mapping when more than one profile would fit.
 */
export const buildEmulatorRestorePatterns = ({
  system,
  binary,
  roots,
  romPath,
  identity,
}: EmulatorRestorePatternOptions): string[] => {
  if (binary === "ralibretro") {
    if (!romPath) return [];
    const names = [
      path.basename(romPath),
      path.basename(romPath, path.extname(romPath)),
    ].filter(
      (value, index, values) => value && values.indexOf(value) === index
    );

    return roots.flatMap((root) =>
      names.flatMap((name) =>
        RALIBRETRO_SAVE_EXTENSIONS.flatMap((extension) => [
          path.join(root, "**", `${name}.${extension}`),
          path.join(root, "**", `${name}.${extension}.?`),
          path.join(root, "**", `${name}.${extension}.??`),
        ])
      )
    );
  }

  if (!identity) return [];
  const normalizedIdentity = identity.toLowerCase();

  if (system === "wiiu" && /^[0-9a-f]{16}$/.test(normalizedIdentity)) {
    return roots.map((root) =>
      path.join(
        root,
        normalizedIdentity.slice(0, 8),
        normalizedIdentity.slice(8)
      )
    );
  }

  if (system === "switch" && /^[0-9a-f]{16}$/.test(normalizedIdentity)) {
    return roots.flatMap((root) => {
      const profiles = findSwitchProfileRoots(root);
      return profiles.length > 0
        ? profiles.map((profile) => path.join(profile, normalizedIdentity))
        : [path.join(root, "**", normalizedIdentity)];
    });
  }

  if (system === "n3ds" && /^[0-9a-f]{16}$/.test(normalizedIdentity)) {
    const high = normalizedIdentity.slice(0, 8);
    const low = normalizedIdentity.slice(8);
    const titleRoots = findThreeDsTitleRoots(roots);
    return titleRoots.length > 0
      ? titleRoots.map((root) => path.join(root, high, low))
      : roots.map((root) => path.join(root, "**", "title", high, low));
  }

  if (system === "wii" && /^[0-9a-f]{8}$/.test(normalizedIdentity)) {
    return roots.map((root) =>
      path.join(root, "title", "00010000", normalizedIdentity)
    );
  }

  if (binary === "rpcs3" && /^[a-z0-9_-]+$/i.test(identity)) {
    const exactTitleRoots = findRpcs3TitleSaveRoots(roots, identity);
    return exactTitleRoots.length > 0
      ? exactTitleRoots
      : roots.map((root) => path.join(root, `${identity}*`));
  }

  return [];
};

/**
 * Locate only the RALibretro save files belonging to one ROM. RALibretro may
 * use either `<rom filename>.<save ext>` or `<rom stem>.<save ext>`, and cores
 * may put the file in a subdirectory. The full-ROM-name form wins so two ROMs
 * with the same stem but different extensions cannot capture each other.
 */
export const findRalibretroSaveFiles = (
  roots: string[],
  romPath: string
): string[] => {
  const romFile = path.basename(romPath).toLowerCase();
  const romStem = path.basename(romPath, path.extname(romPath)).toLowerCase();
  if (!romFile || !romStem) return [];

  const exact: string[] = [];
  const stemFallback: string[] = [];
  const stack = [...roots];
  const seen = new Set<string>();
  let visited = 0;

  while (stack.length && visited < 20_000) {
    const current = stack.pop()!;
    let real = current;
    try {
      real = fs.realpathSync(current);
    } catch {
      // The configured root may not exist until the first save is written.
    }
    const key = process.platform === "win32" ? real.toLowerCase() : real;
    if (seen.has(key)) continue;
    seen.add(key);
    visited++;

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
        continue;
      }
      if (!entry.isFile()) continue;

      const lower = entry.name.toLowerCase();
      const exactPrefix = `${romFile}.`;
      if (
        lower.startsWith(exactPrefix) &&
        RALIBRETRO_SAVE_SUFFIX.test(lower.slice(exactPrefix.length))
      ) {
        exact.push(full);
        continue;
      }

      const stemPrefix = `${romStem}.`;
      if (
        lower.startsWith(stemPrefix) &&
        RALIBRETRO_SAVE_SUFFIX.test(lower.slice(stemPrefix.length))
      ) {
        stemFallback.push(full);
      }
    }
  }

  return (exact.length > 0 ? exact : stemFallback).sort((a, b) =>
    a.localeCompare(b)
  );
};

/** Existing RPCS3 savedata roots for every local home profile. */
export const findRpcs3ProfileSaveRoots = (installDir: string): string[] => {
  const homeRoot = path.join(installDir, "dev_hdd0", "home");
  let profiles: fs.Dirent[];
  try {
    profiles = fs.readdirSync(homeRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  return profiles
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(homeRoot, entry.name, "savedata"))
    .filter((candidate) => {
      try {
        return fs.statSync(candidate).isDirectory();
      } catch {
        return false;
      }
    })
    .sort((a, b) => a.localeCompare(b));
};

/** True when a file or directory tree contains at least one save payload. */
export const pathContainsFile = (target: string): boolean => {
  const stack = [target];
  const seen = new Set<string>();
  let visited = 0;

  while (stack.length && visited < 20_000) {
    const current = stack.pop()!;
    const key = process.platform === "win32" ? current.toLowerCase() : current;
    if (seen.has(key)) continue;
    seen.add(key);
    visited++;

    let stat: fs.Stats;
    try {
      stat = fs.statSync(current);
    } catch {
      continue;
    }
    if (stat.isFile()) return true;
    if (!stat.isDirectory()) continue;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isFile()) return true;
      if (entry.isDirectory()) stack.push(path.join(current, entry.name));
    }
  }

  return false;
};

/** Fingerprint files and/or directory trees without following duplicate roots. */
export const fingerprintSavePaths = (targets: string[]): string => {
  let files = 0;
  let bytes = 0;
  let newest = 0;
  let visited = 0;
  const stack = [...targets];
  const seen = new Set<string>();

  const addFile = (file: string, stat?: fs.Stats) => {
    try {
      const value = stat ?? fs.statSync(file);
      files += 1;
      bytes += value.size;
      newest = Math.max(newest, value.mtimeMs);
    } catch {
      /* ignore unreadable files */
    }
  };

  while (stack.length && visited < 20_000) {
    const current = stack.pop()!;
    const key = process.platform === "win32" ? current.toLowerCase() : current;
    if (seen.has(key)) continue;
    seen.add(key);
    visited++;

    let currentStat: fs.Stats;
    try {
      currentStat = fs.statSync(current);
    } catch {
      continue;
    }
    if (currentStat.isFile()) {
      addFile(current, currentStat);
      continue;
    }
    if (!currentStat.isDirectory()) continue;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory() || entry.isFile()) stack.push(full);
    }
  }

  return `${files}:${bytes}:${Math.floor(newest)}`;
};
