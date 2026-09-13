import fs from "node:fs";
import path from "node:path";

const normalizeForComparison = (value: string): string => {
  const normalized = path.normalize(value).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
};

const isSamePath = (left: string, right: string): boolean =>
  normalizeForComparison(left) === normalizeForComparison(right);

/** True when `candidate` is the protected directory itself or contains it. */
const containsProtectedRoot = (candidate: string, protectedRoot: string) => {
  if (isSamePath(candidate, protectedRoot)) return true;
  const relative = path.relative(candidate, protectedRoot);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
};

const canonicalizeExistingDirectory = (candidate: string): string => {
  if (!path.isAbsolute(candidate)) {
    throw new Error("The save folder must be an absolute path.");
  }

  const resolved = path.resolve(candidate);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new Error("The selected save folder does not exist.");
  }
  if (!stat.isDirectory()) {
    throw new Error("The selected save path must be a folder.");
  }

  return fs.realpathSync(resolved);
};

/**
 * Validate a manual save mapping at the trusted main-process boundary.
 * Descendant save folders remain valid (including portable emulator saves),
 * while filesystem roots and broad folders containing GameHub itself do not.
 */
export const validateManualSavePath = (
  candidate: string,
  protectedRoots: readonly string[]
): string => {
  const trimmed = candidate.trim();
  if (!trimmed) throw new Error("Select a save folder.");

  const resolved = canonicalizeExistingDirectory(trimmed);
  if (isSamePath(resolved, path.parse(resolved).root)) {
    throw new Error("Choose a specific save folder, not a filesystem root.");
  }

  for (const protectedRoot of protectedRoots) {
    if (!protectedRoot) continue;

    let canonicalProtectedRoot: string;
    try {
      canonicalProtectedRoot = fs.realpathSync(path.resolve(protectedRoot));
    } catch {
      canonicalProtectedRoot = path.resolve(protectedRoot);
    }

    if (containsProtectedRoot(resolved, canonicalProtectedRoot)) {
      throw new Error(
        "Choose the game's save folder, not the GameHub application or data folder."
      );
    }
  }

  return resolved;
};
