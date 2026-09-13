import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface UnplannedSaveRestoreJob {
  sourcePath: string;
  destinationPath: string;
}

/** Legacy/imported artifacts may contain registry.reg, which is unsupported. */
export const assertNoRegistryRestorePayload = (
  gameBackupPath: string,
  backups: readonly { registry?: unknown }[]
): void => {
  if (
    backups.some((backup) => backup.registry != null) ||
    fs.existsSync(path.join(gameBackupPath, "registry.reg"))
  ) {
    throw new Error(
      "This backup contains Windows Registry save data, which GameHub cannot restore safely yet. No files were changed."
    );
  }
};

export interface SaveRestoreJob extends UnplannedSaveRestoreJob {
  /** True when an artifact path was rebased onto this machine's mapper root. */
  rebased: boolean;
}

const HAS_GLOB = /[*?]/;
const WINDOWS_ABSOLUTE = /^[a-zA-Z]:[\\/]/;

const pathApiFor = (value: string): typeof path.win32 | typeof path.posix =>
  WINDOWS_ABSOLUTE.test(value) ? path.win32 : path.posix;

const comparable = (value: string): string => {
  const api = pathApiFor(value);
  const normalized = api
    .normalize(api.resolve(value))
    .replace(api === path.win32 ? /[\\/]+$/ : /\/+$/, "");
  return api === path.win32 ? normalized.toLowerCase() : normalized;
};

const escapeRegex = (value: string) =>
  value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");

/** Compile the small glob dialect emitted by Ludusavi (`*`, `?`, and `**`). */
const globRegex = (pattern: string, includeDescendants: boolean): RegExp => {
  const api = pathApiFor(pattern);
  const normalized = api.normalize(pattern);
  const root = api.parse(normalized).root;
  const relative = normalized.slice(root.length);
  const windows = api === path.win32;
  const patternSegments = relative
    .split(windows ? /[\\/]+/ : /\/+/)
    .filter(Boolean);
  const separator = windows ? "[\\\\/]" : "/";
  const segmentCharacter = windows ? "[^\\\\/]" : "[^/]";
  const segmentRegex = (segment: string): string => {
    let result = "";
    for (let index = 0; index < segment.length; index++) {
      const char = segment[index];
      if (char === "*" && segment[index + 1] === "*") {
        result += ".*";
        index++;
      } else if (char === "*") {
        result += segmentCharacter + "*";
      } else if (char === "?") {
        result += segmentCharacter;
      } else {
        result += escapeRegex(char);
      }
    }
    return result;
  };

  let source = [...root]
    .map((char) =>
      char === "\\" || char === "/" ? separator : escapeRegex(char)
    )
    .join("");
  for (let index = 0; index < patternSegments.length; index++) {
    const segment = patternSegments[index];
    if (segment === "**") {
      // A whole globstar segment consumes zero or more complete directories.
      source += "(?:" + segmentCharacter + "+" + separator + ")*";
      continue;
    }
    source += segmentRegex(segment);
    if (index < patternSegments.length - 1) source += separator;
  }

  return new RegExp(
    "^" + source + (includeDescendants ? "(?:" + separator + ".*)?" : "") + "$",
    WINDOWS_ABSOLUTE.test(pattern) ? "i" : undefined
  );
};

const statKind = (candidate: string): "file" | "directory" | "missing" => {
  if (HAS_GLOB.test(candidate)) return "missing";
  try {
    return fs.statSync(candidate).isFile() ? "file" : "directory";
  } catch {
    return "missing";
  }
};

const pathBeforeGlob = (pattern: string): string | null => {
  const api = pathApiFor(pattern);
  const patternSegments = segments(pattern);
  const firstGlob = patternSegments.findIndex((part) => HAS_GLOB.test(part));
  if (firstGlob <= 0) return null;

  const root = api.parse(pattern).root;
  const rootSegments = segments(root).length;
  const relativeSegments = patternSegments.slice(rootSegments, firstGlob);
  return relativeSegments.length ? api.join(root, ...relativeSegments) : null;
};

/** Resolve existing junctions/symlinks while preserving a not-yet-created tail. */
const projectThroughExistingAncestor = (value: string): string | null => {
  const api = pathApiFor(value);
  // A foreign snapshot path is only an input for rebasing, never a local destination.
  if ((api === path.win32) !== (process.platform === "win32")) return null;
  if (!api.isAbsolute(value)) return null;
  const target = api.normalize(api.resolve(value));
  let current = target;

  for (;;) {
    try {
      const real = fs.realpathSync(current);
      const tail = api.relative(current, target);
      return comparable(tail ? api.join(real, tail) : real);
    } catch {
      const parent = api.dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
};

const isCanonicallyContained = (
  destinationPath: string,
  scopePath: string,
  exact: boolean
): boolean => {
  const projectedDestination = projectThroughExistingAncestor(destinationPath);
  const projectedScope = projectThroughExistingAncestor(scopePath);
  if (!projectedDestination || !projectedScope) return false;
  if (exact) return projectedDestination === projectedScope;

  const api = pathApiFor(scopePath);
  const relative = api.relative(projectedScope, projectedDestination);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${api.sep}`) &&
      !api.isAbsolute(relative))
  );
};

/** Two lexical names can reference one physical save through a directory
 * symlink/junction. Deduplicate by the same projected canonical path used for
 * containment, including a tail which does not exist before the first restore. */
const canonicalRestoreDestinationKey = (destinationPath: string): string => {
  const key = projectThroughExistingAncestor(destinationPath);
  if (!key) {
    throw new Error(
      `Unsafe or foreign save artifact destination: ${destinationPath}`
    );
  }
  return key;
};

/** Permit an exact mapped file, a mapped glob, or descendants of a save root. */
export const isSaveRestoreDestinationAllowed = (
  destinationPath: string,
  allowedPaths: readonly string[]
): boolean => {
  const normalizedDestination = comparable(destinationPath);

  return allowedPaths.some((allowedPath) => {
    if (!allowedPath) return false;
    if (HAS_GLOB.test(allowedPath)) {
      const scope = pathBeforeGlob(allowedPath);
      return Boolean(
        scope &&
          globRegex(allowedPath, true).test(destinationPath) &&
          isCanonicallyContained(destinationPath, scope, false)
      );
    }

    const normalizedAllowed = comparable(allowedPath);
    if (statKind(allowedPath) === "file") {
      return (
        normalizedDestination === normalizedAllowed &&
        isCanonicallyContained(destinationPath, allowedPath, true)
      );
    }

    const api = pathApiFor(allowedPath);
    const relative = api.relative(normalizedAllowed, normalizedDestination);
    const textuallyContained =
      relative === "" ||
      (relative !== ".." &&
        !relative.startsWith(`..${api.sep}`) &&
        !api.isAbsolute(relative));
    return (
      textuallyContained &&
      isCanonicallyContained(destinationPath, allowedPath, false)
    );
  });
};

const segments = (value: string): string[] => {
  const api = pathApiFor(value);
  return api
    .normalize(value)
    .split(api === path.win32 ? /[\\/]+/ : /\/+/)
    .filter(Boolean);
};

const normalizeSegment = (value: string, windows: boolean) => {
  const normalized = windows ? value.toLowerCase() : value;
  // Portable folders commonly change only spacing/punctuation between installs
  // (for example Neon Abyss -> NeonAbyss). Treat those as the same anchor.
  return normalized.replace(/[^a-z0-9]/gi, "");
};

const segmentEquals = (left: string, right: string, windows: boolean) =>
  normalizeSegment(left, windows) === normalizeSegment(right, windows);

const matchingSuffixLength = (
  currentSegments: string[],
  artifactSegments: string[],
  artifactEndIndex: number,
  windows: boolean
): number => {
  let length = 0;
  for (
    let currentIndex = currentSegments.length - 1,
      artifactIndex = artifactEndIndex;
    currentIndex >= 0 && artifactIndex >= 0;
    currentIndex--, artifactIndex--
  ) {
    if (
      !segmentEquals(
        currentSegments[currentIndex],
        artifactSegments[artifactIndex],
        windows
      )
    ) {
      break;
    }
    length++;
  }
  return length;
};

const isStrongIdentitySegment = (value: string): boolean => {
  const normalized = normalizeSegment(value, true);
  return (
    /^[0-9a-f]{8,16}$/i.test(normalized) ||
    /^[a-z]{4}[0-9]{5}/i.test(normalized) ||
    (normalized.length >= 10 &&
      !/^(?:save|saves|userdata|profile)s?$/i.test(normalized))
  );
};

const candidateFromLiteralRoot = (
  destinationPath: string,
  allowedPath: string
): string[] => {
  const api = pathApiFor(allowedPath);
  const windows = api === path.win32;
  const destinationSegments = segments(destinationPath);
  const allowedSegments = segments(allowedPath);
  const anchor = allowedSegments.at(-1);
  if (!anchor) return [];

  const candidates: string[] = [];
  for (let index = 0; index < destinationSegments.length; index++) {
    if (!segmentEquals(destinationSegments[index], anchor, windows)) continue;
    const suffixLength = matchingSuffixLength(
      allowedSegments,
      destinationSegments,
      index,
      windows
    );
    if (suffixLength < 2 && !isStrongIdentitySegment(anchor)) continue;
    const tail = destinationSegments.slice(index + 1);
    const kind = statKind(allowedPath);
    if (kind === "file" && tail.length > 0) continue;
    candidates.push(tail.length ? api.join(allowedPath, ...tail) : allowedPath);
  }
  return candidates;
};

const candidateFromGlobRoot = (
  destinationPath: string,
  allowedPattern: string
): string[] => {
  const concreteRoot = pathBeforeGlob(allowedPattern);
  if (!concreteRoot) return [];

  const api = pathApiFor(allowedPattern);
  const windows = api === path.win32;
  const destinationSegments = segments(destinationPath);
  const concreteSegments = segments(concreteRoot);
  const anchor = api.basename(concreteRoot);
  const candidates: string[] = [];
  const firstGlob = segments(allowedPattern).findIndex((segment) =>
    HAS_GLOB.test(segment)
  );
  const hasStrongPatternIdentity = segments(allowedPattern)
    .slice(firstGlob + 1)
    .some(
      (segment) => !HAS_GLOB.test(segment) && isStrongIdentitySegment(segment)
    );

  for (let index = 0; index < destinationSegments.length; index++) {
    if (!segmentEquals(destinationSegments[index], anchor, windows)) continue;
    const suffixLength = matchingSuffixLength(
      concreteSegments,
      destinationSegments,
      index,
      windows
    );
    if (suffixLength < 2 && !hasStrongPatternIdentity) continue;
    const tail = destinationSegments.slice(index + 1);
    const candidate = tail.length
      ? api.join(concreteRoot, ...tail)
      : concreteRoot;
    if (globRegex(allowedPattern, true).test(candidate))
      candidates.push(candidate);
  }
  return candidates;
};

/**
 * Rebase one source-machine artifact destination onto the current mapper.
 * A result is returned only when exactly one current destination is possible;
 * moved portable installs work on the same drive, while multi-profile or
 * otherwise ambiguous mappings fail closed.
 */
export const rebaseSaveRestoreDestination = (
  destinationPath: string,
  allowedPaths: readonly string[]
): string | null => {
  if (isSaveRestoreDestinationAllowed(destinationPath, allowedPaths)) {
    return destinationPath;
  }

  const candidates = allowedPaths.flatMap((allowedPath) =>
    HAS_GLOB.test(allowedPath)
      ? candidateFromGlobRoot(destinationPath, allowedPath)
      : candidateFromLiteralRoot(destinationPath, allowedPath)
  );
  const unique = new Map<string, string>();
  for (const candidate of candidates) {
    if (isSaveRestoreDestinationAllowed(candidate, allowedPaths)) {
      unique.set(comparable(candidate), candidate);
    }
  }

  return unique.size === 1 ? [...unique.values()][0] : null;
};

/**
 * Resolve every restore job before touching disk. One contaminated path makes
 * the entire artifact fail; an empty artifact is never reported as restored.
 */
export const planSaveRestoreJobs = (
  jobs: readonly UnplannedSaveRestoreJob[],
  allowedPaths: readonly string[],
  allowedSourceRoot?: string
): SaveRestoreJob[] => {
  if (allowedPaths.length === 0) {
    throw new Error("No current per-game save destination is available.");
  }
  if (jobs.length === 0) {
    throw new Error("The save artifact does not contain any restorable files.");
  }

  const sourcePaths = new Set<string>();
  const destinationPaths = new Set<string>();

  return jobs.map((job) => {
    if (allowedSourceRoot) {
      let sourceStat: fs.Stats;
      try {
        sourceStat = fs.lstatSync(job.sourcePath);
      } catch {
        throw new Error(`Save artifact source is missing: ${job.sourcePath}`);
      }
      if (!sourceStat.isFile()) {
        throw new Error(
          `Save artifact source is not a regular file: ${job.sourcePath}`
        );
      }
      if (!isCanonicallyContained(job.sourcePath, allowedSourceRoot, false)) {
        throw new Error(
          `Save artifact source escapes its staging folder: ${job.sourcePath}`
        );
      }
    }

    const sourceKey = comparable(job.sourcePath);
    if (sourcePaths.has(sourceKey)) {
      throw new Error(`Duplicate save artifact source: ${job.sourcePath}`);
    }
    sourcePaths.add(sourceKey);

    const destinationPath = rebaseSaveRestoreDestination(
      job.destinationPath,
      allowedPaths
    );
    if (!destinationPath) {
      throw new Error(
        `Unsafe or ambiguous save artifact destination: ${job.destinationPath}`
      );
    }
    const destinationKey = canonicalRestoreDestinationKey(destinationPath);
    if (destinationPaths.has(destinationKey)) {
      throw new Error(
        `Duplicate save artifact destination: ${destinationPath}`
      );
    }
    destinationPaths.add(destinationKey);

    return {
      ...job,
      destinationPath,
      rebased: comparable(destinationPath) !== comparable(job.destinationPath),
    };
  });
};

type MoveSaveFile = (sourcePath: string, destinationPath: string) => void;

const moveSaveFile: MoveSaveFile = (sourcePath, destinationPath) => {
  try {
    fs.renameSync(sourcePath, destinationPath);
  } catch {
    fs.copyFileSync(sourcePath, destinationPath);
    fs.unlinkSync(sourcePath);
  }
};

export interface CommitSaveRestoreOptions {
  /** Test seam used to prove rollback when a later move fails. */
  moveFile?: MoveSaveFile;
  onInstall?: (job: SaveRestoreJob) => void;
  onRollbackError?: (destinationPath: string, error: unknown) => void;
}

/** Commit a prevalidated restore atomically, restoring every old file on error. */
export const commitSaveRestoreJobs = (
  jobs: readonly SaveRestoreJob[],
  options: CommitSaveRestoreOptions = {}
): void => {
  const sourcePaths = new Set<string>();
  const destinationPaths = new Set<string>();
  for (const job of jobs) {
    const sourceKey = comparable(job.sourcePath);
    const destinationKey = canonicalRestoreDestinationKey(job.destinationPath);
    if (sourcePaths.has(sourceKey)) {
      throw new Error(`Duplicate save artifact source: ${job.sourcePath}`);
    }
    if (destinationPaths.has(destinationKey)) {
      throw new Error(
        `Duplicate save artifact destination: ${job.destinationPath}`
      );
    }
    sourcePaths.add(sourceKey);
    destinationPaths.add(destinationKey);
  }

  const moveFile = options.moveFile ?? moveSaveFile;
  const records: {
    destinationPath: string;
    backup: string | null;
    installed: boolean;
  }[] = [];
  const suffix = `gamehub-${crypto.randomUUID()}`;

  try {
    for (const job of jobs) {
      fs.mkdirSync(path.dirname(job.destinationPath), { recursive: true });

      let backup: string | null = null;
      if (fs.existsSync(job.destinationPath)) {
        backup = `${job.destinationPath}.${suffix}.bak`;
        moveFile(job.destinationPath, backup);
      }

      const record = {
        destinationPath: job.destinationPath,
        backup,
        installed: false,
      };
      records.push(record);
      options.onInstall?.(job);
      moveFile(job.sourcePath, job.destinationPath);
      record.installed = true;
    }
  } catch (error) {
    for (const { destinationPath, backup } of records.reverse()) {
      try {
        // A move implementation may copy the replacement successfully and
        // then fail while removing its source. Once the old file has been
        // moved aside, anything now at the destination is part of this failed
        // transaction and must be removed even if `moveFile` threw early.
        if (fs.existsSync(destinationPath)) {
          fs.rmSync(destinationPath);
        }
        if (backup && fs.existsSync(backup)) moveFile(backup, destinationPath);
      } catch (rollbackError) {
        options.onRollbackError?.(destinationPath, rollbackError);
      }
    }
    throw error;
  }

  for (const { backup } of records) {
    if (!backup || !fs.existsSync(backup)) continue;
    try {
      fs.rmSync(backup);
    } catch {
      // The restore is committed; stale backup cleanup is best effort.
    }
  }
};
