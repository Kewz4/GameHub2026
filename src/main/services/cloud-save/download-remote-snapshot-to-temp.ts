import path from "node:path";

import { SystemPath } from "@main/services/system-path";
import type {
  CloudSaveGameId,
  DownloadedRestoreFile,
  RestoreManifestFile,
} from "@types";

import { cloudSaveFileKey, validateSnapshotFile } from "./cloud-save-contract";
import {
  mapWithConcurrency,
  MAX_CONCURRENT_RESTORE_OPERATIONS,
} from "./map-with-concurrency";
import {
  downloadR2CloudSaveBlob,
  getR2CloudSaveSnapshot,
} from "./r2-snapshot-store";

export const downloadRemoteSnapshotToTemp = async (
  snapshotId: string,
  snapshotVersion: number,
  gameId: CloudSaveGameId,
  requestedFiles?: RestoreManifestFile[],
  onProgress?: (processedFiles: number, totalFiles: number) => void
): Promise<DownloadedRestoreFile[]> => {
  if (requestedFiles?.length === 0) return [];
  const document = await getR2CloudSaveSnapshot(
    gameId.objectId,
    gameId.shop,
    snapshotId,
    snapshotVersion
  );
  if (!document) throw new Error("cloud_save_restore_snapshot_not_found");
  const files = document.files.map(validateSnapshotFile);
  const requestedById = requestedFiles
    ? new Map(
        requestedFiles.map((file) => [cloudSaveFileKey(file), file] as const)
      )
    : null;
  const selectedFiles = requestedById
    ? files.filter((file) => requestedById.has(cloudSaveFileKey(file)))
    : files;
  if (requestedById) {
    if (selectedFiles.length !== requestedById.size) {
      throw new Error("Missing restore blob for requested file");
    }
    for (const file of selectedFiles) {
      const requested = requestedById.get(cloudSaveFileKey(file));
      if (
        requested?.hash !== file.hash ||
        requested?.sizeBytes !== file.sizeBytes ||
        requested.lastModifiedAt !== file.lastModifiedAt
      ) {
        throw new Error("Restore blob does not match manifest");
      }
    }
  }

  const tempRoot = SystemPath.getPath("temp");
  const tempSnapshotId = `${snapshotId}-${snapshotVersion}`;
  const filesByBlob = new Map<string, RestoreManifestFile[]>();
  for (const file of selectedFiles) {
    const key = JSON.stringify([file.hash, file.sizeBytes]);
    filesByBlob.set(key, [...(filesByBlob.get(key) ?? []), file]);
  }

  const groups = [...filesByBlob.values()];
  let processedFiles = 0;
  const downloadedGroups = await mapWithConcurrency(
    groups,
    MAX_CONCURRENT_RESTORE_OPERATIONS,
    async (group) => {
      const [file] = group;
      const tempPath = path.join(
        tempRoot,
        "hydra-cloud-saves",
        tempSnapshotId,
        `${file.hash}.blob`
      );
      await downloadR2CloudSaveBlob(
        gameId.objectId,
        gameId.shop,
        file.hash,
        tempPath
      );
      return { key: JSON.stringify([file.hash, file.sizeBytes]), tempPath };
    },
    (_result, group) => {
      processedFiles += group.length;
      onProgress?.(processedFiles, selectedFiles.length);
    }
  );
  const tempPathByBlob = new Map(
    downloadedGroups.map(({ key, tempPath }) => [key, tempPath])
  );

  return selectedFiles.map((file) => {
    const tempPath = tempPathByBlob.get(
      JSON.stringify([file.hash, file.sizeBytes])
    );
    if (!tempPath) throw new Error("Missing downloaded restore blob");
    return { ...file, tempPath };
  });
};
