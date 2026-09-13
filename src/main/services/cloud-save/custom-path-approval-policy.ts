import type { RestoreManifestFile } from "@types";

import { CLOUD_SAVE_CUSTOM_PATH_PREFIX } from "./custom-path.js";

export interface CloudSaveCustomPathRestoreCandidate {
  rawPath: string;
  files: RestoreManifestFile[];
}

export const getUnconfiguredCloudSaveCustomPathCandidates = (
  files: RestoreManifestFile[],
  locallyBoundRawPaths: Iterable<string>
): CloudSaveCustomPathRestoreCandidate[] => {
  const boundPaths = new Set(locallyBoundRawPaths);
  const filesByRawPath = new Map<string, RestoreManifestFile[]>();

  for (const file of files) {
    if (
      !file.rawPath.startsWith(CLOUD_SAVE_CUSTOM_PATH_PREFIX) ||
      boundPaths.has(file.rawPath)
    ) {
      continue;
    }

    const matchingFiles = filesByRawPath.get(file.rawPath) ?? [];
    matchingFiles.push(file);
    filesByRawPath.set(file.rawPath, matchingFiles);
  }

  return [...filesByRawPath.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([rawPath, matchingFiles]) => ({
      rawPath,
      files: matchingFiles,
    }));
};

export const getUnboundCloudSaveCustomPathRestoreCandidates = (
  files: RestoreManifestFile[],
  restoreEntryIds: Iterable<string>,
  locallyBoundRawPaths: Iterable<string>
) => {
  const restoreIds = new Set(restoreEntryIds);
  return getUnconfiguredCloudSaveCustomPathCandidates(
    files.filter((file) =>
      restoreIds.has(
        JSON.stringify([file.variantId, file.rawPath, file.relativePath])
      )
    ),
    locallyBoundRawPaths
  );
};
