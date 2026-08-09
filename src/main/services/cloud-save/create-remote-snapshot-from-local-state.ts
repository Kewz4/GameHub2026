import type { R2CloudSaveV2SnapshotDocument } from "@main/services/r2-sync";
import type {
  CloudSaveUploadProgress,
  GameShop,
  LocalGameSnapshotContext,
  RemoteGameSnapshot,
  SnapshotFile,
} from "@types";

import { NativeAddon } from "../native-addon";
import { buildLocalGameSnapshotContext } from "./build-local-game-snapshot";
import { cloudSaveFileKey } from "./cloud-save-contract";
import {
  commitR2CloudSaveSnapshot,
  getR2ActiveCloudSaveSnapshot,
  uploadR2CloudSaveBlob,
} from "./r2-snapshot-store";
import { createCloudSaveSnapshotProposalId } from "./r2-snapshot-publication";
import { saveCloudSaveSyncAnchor } from "./sync-anchor";
import { shouldCreateRemoteCloudSaveSnapshot } from "./snapshot-creation-policy";
import { assertCloudSaveUploadWithinLimits } from "./upload-limits";
import type { PrepareLocalSnapshotOptions } from "./upload-local-game-snapshot";

type ProgressCallback = (progress: CloudSaveUploadProgress) => void;

export interface CreateRemoteSnapshotOptions
  extends PrepareLocalSnapshotOptions {
  expectedSnapshotId?: string | null;
  unresolvedRemoteEntryIds?: string[];
  updateAnchor?: boolean;
  assertEnvironmentCurrent?: () => Promise<void>;
}

const blobKey = (file: Pick<SnapshotFile, "hash" | "sizeBytes">) =>
  JSON.stringify([file.hash, file.sizeBytes]);

const validateBaseHead = (
  current: Awaited<ReturnType<typeof getR2ActiveCloudSaveSnapshot>>,
  baseVersion: number,
  expectedSnapshotId?: string | null
) => {
  if (current?.control.status === "deleting") {
    throw new Error("cloud_save_deletion_pending");
  }
  const currentVersion = current?.document?.snapshot.version ?? 0;
  if (currentVersion !== baseVersion) {
    const error = new Error("cloud_save_remote_head_conflict") as Error & {
      code?: string;
    };
    error.code = "cloud_save_remote_head_conflict";
    throw error;
  }
  if (
    expectedSnapshotId &&
    current?.document?.snapshot.id !== expectedSnapshotId
  ) {
    throw new Error("cloud_save_remote_head_conflict");
  }
};

const uploadProposalBlobs = async (
  objectId: string,
  shop: GameShop,
  context: LocalGameSnapshotContext,
  files: SnapshotFile[],
  currentDocument: R2CloudSaveV2SnapshotDocument | null,
  expectedEpoch: number,
  onProgress?: ProgressCallback
) => {
  const sourceByIdentity = new Map(
    context.sourceFiles.map((file) => [cloudSaveFileKey(file), file] as const)
  );
  const sourceByBlob = new Map(
    context.sourceFiles.map((file) => [blobKey(file), file] as const)
  );
  const currentBlobs = new Set(
    (currentDocument?.files ?? []).map((file) => blobKey(file))
  );
  const filesByBlob = new Map<string, SnapshotFile[]>();
  for (const file of files) {
    const key = blobKey(file);
    filesByBlob.set(key, [...(filesByBlob.get(key) ?? []), file]);
  }

  const totalBytes = files.reduce((total, file) => total + file.sizeBytes, 0);
  let completedFiles = 0;
  let completedBytes = 0;
  const emit = (currentFile: string | null) =>
    onProgress?.({
      completedFiles,
      totalFiles: files.length,
      completedBytes,
      totalBytes,
      currentFile,
    });
  emit(null);

  const groups = [...filesByBlob.values()];
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(8, groups.length) },
    async () => {
      for (;;) {
        const index = nextIndex;
        nextIndex += 1;
        const group = groups[index];
        if (!group) return;
        const representative = group[0];
        const source =
          group
            .map((file) => sourceByIdentity.get(cloudSaveFileKey(file)))
            .find(Boolean) ?? sourceByBlob.get(blobKey(representative));
        if (source) {
          emit(source.relativePath);
          await uploadR2CloudSaveBlob(
            objectId,
            shop,
            source.absolutePath,
            representative.hash,
            representative.sizeBytes,
            expectedEpoch
          );
        } else if (!currentBlobs.has(blobKey(representative))) {
          throw new Error("cloud_save_missing_local_upload_source");
        }
        completedFiles += group.length;
        completedBytes += group.reduce(
          (total, file) => total + file.sizeBytes,
          0
        );
        emit(null);
      }
    }
  );
  await Promise.all(workers);
};

export const createRemoteSnapshotFromLocalState = async (
  objectId: string,
  shop: GameShop,
  onProgress?: ProgressCallback,
  localSnapshotContext?: LocalGameSnapshotContext,
  options: CreateRemoteSnapshotOptions = { baseVersion: 0 }
): Promise<RemoteGameSnapshot | null> => {
  const context =
    localSnapshotContext ??
    (await buildLocalGameSnapshotContext(objectId, shop));
  const variants = options.variants ?? context.variants;
  const files = options.files ?? context.files;
  const customPathRawPaths =
    options.customPathRawPaths ?? context.customPathRawPaths;
  // An empty first upload is a no-op, but an empty successor is meaningful: it
  // is the tombstone-like snapshot that propagates deletion of the last save
  // file or removal of the last tracked custom path.
  if (
    !shouldCreateRemoteCloudSaveSnapshot(
      files.length,
      customPathRawPaths.length,
      options.baseVersion
    )
  ) {
    return null;
  }
  assertCloudSaveUploadWithinLimits(files);
  const aggregateHash =
    options.aggregateHash ??
    NativeAddon.buildSnapshotAggregateHash({ variants, files });

  await options.assertEnvironmentCurrent?.();
  const current = await getR2ActiveCloudSaveSnapshot(objectId, shop);
  validateBaseHead(current, options.baseVersion, options.expectedSnapshotId);
  await uploadProposalBlobs(
    objectId,
    shop,
    context,
    files,
    current?.document ?? null,
    current?.control.epoch ?? 0,
    onProgress
  );
  await options.assertEnvironmentCurrent?.();

  // Re-read immediately before the conditional commit. This gives a clearer
  // local conflict and the If-Match/If-None-Match write remains authoritative.
  const beforeCommit = await getR2ActiveCloudSaveSnapshot(objectId, shop);
  validateBaseHead(
    beforeCommit,
    options.baseVersion,
    options.expectedSnapshotId
  );
  const now = new Date().toISOString();
  // A snapshot id identifies this immutable proposal, not the game's save
  // lineage. Reusing the active id would make every N+1 proposal target the
  // same object key. An orphaned manifest (for example, when the control write
  // fails) or a concurrent client could then make all later retries collide
  // with immutable data. A fresh UUID keeps those proposals independent; the
  // conditional control write below remains the authority on which one wins.
  const snapshotId = createCloudSaveSnapshotProposalId();
  const version = options.baseVersion + 1;
  const totalSizeBytes = files.reduce(
    (total, file) => total + file.sizeBytes,
    0
  );
  const document: R2CloudSaveV2SnapshotDocument = {
    schemaVersion: 1,
    snapshot: {
      id: snapshotId,
      version,
      shop,
      objectId,
      createdAt: beforeCommit?.document?.snapshot.createdAt ?? now,
      updatedAt: now,
      fileCount: files.length,
      totalSizeBytes,
      aggregateHash,
      epoch: beforeCommit?.control.epoch ?? 0,
    },
    customPathRawPaths,
    variants,
    files,
  };
  await commitR2CloudSaveSnapshot(
    document,
    beforeCommit?.control ?? null,
    beforeCommit?.etag ?? null
  );

  if (options.updateAnchor !== false) {
    await options.assertEnvironmentCurrent?.();
    await saveCloudSaveSyncAnchor(shop, objectId, context.environmentId, {
      schemaVersion: 4,
      environmentId: context.environmentId,
      baseSnapshotId: snapshotId,
      baseVersion: version,
      baseAggregateHash: aggregateHash,
      entries: files.map((file) => ({
        variantId: file.variantId,
        rawPath: file.rawPath,
        relativePath: file.relativePath,
        hash: file.hash,
        sizeBytes: file.sizeBytes,
      })),
      unresolvedRemoteEntryIds: (options.unresolvedRemoteEntryIds ?? []).filter(
        (entryId) => files.some((file) => cloudSaveFileKey(file) === entryId)
      ),
      updatedAt: now,
    });
  }

  return {
    id: snapshotId,
    version,
    fileCount: files.length,
    totalSizeBytes,
    aggregateHash,
  };
};
