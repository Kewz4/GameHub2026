import crypto from "node:crypto";
import path from "node:path";

import type {
  CloudSavePathContext,
  CloudSaveRule,
  GameShop,
  RestoreManifestFile,
} from "../../../types/index";

const HAS_GLOB = /[*?]/;
const MAX_EMULATOR_RULE_SLOTS = 20_000;

export const gameHubLegacyEmulatorRawPath = (
  shop: GameShop,
  objectId: string,
  index: number
) => {
  const digest = crypto
    .createHash("sha256")
    .update(JSON.stringify([shop, objectId, index]))
    .digest("hex");
  return `<gamehubEmulator>/${shop}/${digest}`;
};

export type EmulatorRemoteFile = Pick<
  RestoreManifestFile,
  "rawPath" | "relativePath"
>;

export interface BuildGameHubEmulatorRulesInput {
  shop: GameShop;
  objectId: string;
  platform: CloudSavePathContext["platform"];
  binary: string;
  system: string;
  emulatorInstallDir: string;
  saveRoots: readonly string[];
  backupPaths: readonly string[];
  restorePatterns: readonly string[];
  remoteFiles?: readonly EmulatorRemoteFile[];
}

const pathApiFor = (
  platform: CloudSavePathContext["platform"]
): typeof path.win32 | typeof path.posix =>
  platform === "windows" ? path.win32 : path.posix;

const comparablePath = (
  candidate: string,
  platform: CloudSavePathContext["platform"]
) => {
  const api = pathApiFor(platform);
  const normalized = api.resolve(candidate).replace(/[\\/]+$/, "");
  return platform === "windows" ? normalized.toLowerCase() : normalized;
};

const sortedUniquePaths = (
  paths: readonly string[],
  platform: CloudSavePathContext["platform"]
) => {
  const unique = new Map<string, string>();
  for (const candidate of paths) {
    unique.set(comparablePath(candidate, platform), candidate);
  }
  return [...unique.values()].sort((left, right) =>
    left.localeCompare(right, undefined, {
      sensitivity: platform === "windows" ? "base" : "variant",
    })
  );
};

const relativeWithin = (
  root: string,
  candidate: string,
  platform: CloudSavePathContext["platform"]
): string | null => {
  const api = pathApiFor(platform);
  const relative = api.relative(api.resolve(root), api.resolve(candidate));
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${api.sep}`) ||
    api.isAbsolute(relative)
  ) {
    return null;
  }
  return relative.replaceAll("\\", "/").toLowerCase();
};

const stableDescriptor = (
  input: BuildGameHubEmulatorRulesInput,
  preferredPath: string,
  kind: "file" | "dir"
): readonly string[] | null => {
  const matchingRoots = input.saveRoots
    .map((root) => ({
      root,
      relativeTarget: relativeWithin(root, preferredPath, input.platform),
    }))
    .filter(
      (entry): entry is { root: string; relativeTarget: string } =>
        entry.relativeTarget !== null
    );
  if (matchingRoots.length !== 1) return null;

  const rootDescriptor = relativeWithin(
    input.emulatorInstallDir,
    matchingRoots[0].root,
    input.platform
  );
  if (!rootDescriptor) return null;

  // RALibretro's portable Saves root is stable but an optional core
  // subdirectory is not. Its exact remote filename is the per-ROM identity.
  const targetDescriptor =
    input.binary === "ralibretro" && kind === "file"
      ? pathApiFor(input.platform).basename(preferredPath).toLowerCase()
      : matchingRoots[0].relativeTarget;

  return [
    "gamehub-emulator-v2",
    input.binary.toLowerCase(),
    input.system.toLowerCase(),
    rootDescriptor,
    kind,
    targetDescriptor,
  ];
};

export const gameHubStableEmulatorRawPath = (
  input: BuildGameHubEmulatorRulesInput,
  preferredPath: string,
  kind: "file" | "dir"
): string | null => {
  const descriptor = stableDescriptor(input, preferredPath, kind);
  if (!descriptor) return null;
  const digest = crypto
    .createHash("sha256")
    .update(JSON.stringify([input.shop, input.objectId, ...descriptor]))
    .digest("hex");
  return `<gamehubEmulator>/${input.shop}/v2-${digest}`;
};

const ruleForPath = (
  rawPath: string,
  preferredPath: string,
  platform: CloudSavePathContext["platform"],
  kind: "file" | "dir"
): CloudSaveRule => ({
  ruleId: `gamehub-emulator-${crypto
    .createHash("sha256")
    .update(rawPath)
    .digest("hex")}`,
  kind,
  rawPath,
  source: "gamehub-emulator",
  tags: ["save"],
  when: [{ os: platform }],
  preferredPath,
});

const stableRulesForPaths = (
  input: BuildGameHubEmulatorRulesInput,
  candidates: readonly string[],
  kind: "file" | "dir"
): CloudSaveRule[] => {
  const byRawPath = new Map<string, CloudSaveRule>();
  for (const preferredPath of sortedUniquePaths(candidates, input.platform)) {
    const rawPath = gameHubStableEmulatorRawPath(input, preferredPath, kind);
    if (!rawPath) continue;
    const existing = byRawPath.get(rawPath);
    if (
      existing &&
      comparablePath(existing.preferredPath!, input.platform) !==
        comparablePath(preferredPath, input.platform)
    ) {
      return [];
    }
    byRawPath.set(
      rawPath,
      ruleForPath(rawPath, preferredPath, input.platform, kind)
    );
  }
  return [...byRawPath.values()];
};

type RemoteIdentityKind = "stable" | "legacy" | "unknown";

interface EmulatorRemoteFileGroup {
  rawPath: string;
  files: EmulatorRemoteFile[];
  kind: RemoteIdentityKind;
}

const emulatorRemoteFileGroups = (
  files: readonly EmulatorRemoteFile[] | undefined,
  shop: GameShop
): EmulatorRemoteFileGroup[] => {
  const prefix = `<gamehubEmulator>/${shop}/`;
  const groups = new Map<string, EmulatorRemoteFile[]>();
  for (const file of files ?? []) {
    if (!file.rawPath.startsWith(prefix)) continue;
    const group = groups.get(file.rawPath) ?? [];
    group.push(file);
    groups.set(file.rawPath, group);
  }
  return [...groups].map(([rawPath, groupFiles]) => {
    const suffix = rawPath.slice(prefix.length);
    const kind: RemoteIdentityKind = /^v2-[0-9a-f]{64}$/.test(suffix)
      ? "stable"
      : /^[0-9a-f]{64}$/.test(suffix)
        ? "legacy"
        : "unknown";
    return { rawPath, files: groupFiles, kind };
  });
};

const isKnownLegacyRawPath = (
  rawPath: string,
  shop: GameShop,
  objectId: string
) => {
  for (let index = 0; index < MAX_EMULATOR_RULE_SLOTS; index++) {
    if (rawPath === gameHubLegacyEmulatorRawPath(shop, objectId, index)) {
      return true;
    }
  }
  return false;
};

const wildcardSegmentMatches = (pattern: string, value: string) => {
  let source = "^";
  for (const character of pattern) {
    if (character === "*") source += ".*";
    else if (character === "?") source += ".";
    else source += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  return new RegExp(`${source}$`, "i").test(value);
};

/** Bind a RALibretro glob to the exact per-ROM filename carried remotely. */
const ralibretroCandidateForFile = (
  pattern: string,
  relativePath: string,
  platform: CloudSavePathContext["platform"]
): string | null => {
  const portableRelativePath = relativePath.replaceAll("\\", "/");
  if (
    portableRelativePath.includes("/") ||
    portableRelativePath === "." ||
    portableRelativePath === ".."
  ) {
    return null;
  }

  const marker = /[\\/]\*\*[\\/]/.exec(pattern);
  if (!marker || marker.index === 0) return null;
  const root = pattern.slice(0, marker.index);
  const filenamePattern = pattern.slice(marker.index + marker[0].length);
  if (
    !filenamePattern ||
    filenamePattern.includes("/") ||
    filenamePattern.includes("\\") ||
    !wildcardSegmentMatches(filenamePattern, portableRelativePath)
  ) {
    return null;
  }
  return pathApiFor(platform).join(root, portableRelativePath);
};

const buildRalibretroRules = (
  input: BuildGameHubEmulatorRulesInput
): CloudSaveRule[] => {
  const backupPaths = sortedUniquePaths(input.backupPaths, input.platform);
  if (input.remoteFiles === undefined) {
    return stableRulesForPaths(input, backupPaths, "file");
  }

  const groups = emulatorRemoteFileGroups(input.remoteFiles, input.shop);
  if (groups.some((group) => group.kind === "unknown")) return [];
  const rules: CloudSaveRule[] = [];

  for (const group of groups) {
    if (group.files.length !== 1) return [];
    const relativePath = group.files[0].relativePath.replaceAll("\\", "/");
    const comparableRelativePath =
      input.platform === "windows" ? relativePath.toLowerCase() : relativePath;
    const localMatches = backupPaths.filter(
      (candidate) =>
        (input.platform === "windows"
          ? pathApiFor(input.platform).basename(candidate).toLowerCase()
          : pathApiFor(input.platform).basename(candidate)) ===
        comparableRelativePath
    );
    if (localMatches.length > 1) return [];

    const prospectiveMatches = input.restorePatterns
      .map((pattern) =>
        ralibretroCandidateForFile(pattern, relativePath, input.platform)
      )
      .filter((candidate): candidate is string => Boolean(candidate));
    const candidates = sortedUniquePaths(
      localMatches.length === 1 ? localMatches : prospectiveMatches,
      input.platform
    );

    if (group.kind === "legacy") {
      if (
        candidates.length !== 1 ||
        !isKnownLegacyRawPath(group.rawPath, input.shop, input.objectId)
      ) {
        return [];
      }
      rules.push(
        ruleForPath(group.rawPath, candidates[0], input.platform, "file")
      );
      continue;
    }

    const matches = stableRulesForPaths(input, candidates, "file").filter(
      (rule) => rule.rawPath === group.rawPath
    );
    if (matches.length > 1) return [];
    if (matches.length === 1) rules.push(matches[0]);
  }
  return rules;
};

const isProfileBased = (input: BuildGameHubEmulatorRulesInput) =>
  input.system === "switch" ||
  input.system === "n3ds" ||
  input.system === "ps3" ||
  input.binary === "rpcs3";

/**
 * Build locally bound V2 rules for isolated emulator title roots. New rules
 * use stable, non-positional descriptors. Legacy positional rules are accepted
 * only for a single deterministic, profile-free destination.
 */
export const buildGameHubEmulatorRules = (
  input: BuildGameHubEmulatorRulesInput
): CloudSaveRule[] => {
  if (input.binary === "ralibretro") return buildRalibretroRules(input);

  const candidates = sortedUniquePaths(
    [
      ...input.backupPaths,
      ...input.restorePatterns.filter((candidate) => !HAS_GLOB.test(candidate)),
    ],
    input.platform
  );
  const stableRules = stableRulesForPaths(input, candidates, "dir");
  if (input.remoteFiles === undefined) return stableRules;

  const groups = emulatorRemoteFileGroups(input.remoteFiles, input.shop);
  if (groups.some((group) => group.kind === "unknown")) return [];
  const stableRawPaths = new Set(
    groups
      .filter((group) => group.kind === "stable")
      .map((group) => group.rawPath)
  );
  const result = stableRules.filter((rule) => stableRawPaths.has(rule.rawPath));

  const legacyGroups = groups.filter((group) => group.kind === "legacy");
  if (legacyGroups.length === 0) return result;
  if (
    isProfileBased(input) ||
    legacyGroups.length !== 1 ||
    candidates.length !== 1 ||
    legacyGroups[0].rawPath !==
      gameHubLegacyEmulatorRawPath(input.shop, input.objectId, 0)
  ) {
    return result;
  }

  result.push(
    ruleForPath(legacyGroups[0].rawPath, candidates[0], input.platform, "dir")
  );
  return result;
};
