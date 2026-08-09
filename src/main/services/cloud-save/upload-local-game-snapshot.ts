import type {
  CloudSaveUploadProgress,
  GameShop,
  LocalGameSnapshotContext,
  SnapshotFile,
  SnapshotVariant,
  UploadLocalGameSnapshotResult,
} from "@types";

import { buildLocalGameSnapshotContext } from "./build-local-game-snapshot";
import { createRemoteSnapshotFromLocalState } from "./create-remote-snapshot-from-local-state";

type ProgressCallback = (progress: CloudSaveUploadProgress) => void;

export interface PrepareLocalSnapshotOptions {
  baseVersion: number;
  customPathRawPaths?: string[];
  variants?: SnapshotVariant[];
  files?: SnapshotFile[];
  aggregateHash?: string;
}

/**
 * Compatibility entry point retained for callers from the original V2 stack.
 * GameHub's R2 adapter uploads immutable blobs and commits the snapshot in one
 * conditionally guarded operation, so there is no server-side pending snapshot.
 */
export const uploadLocalGameSnapshot = async (
  objectId: string,
  shop: GameShop,
  onProgress?: ProgressCallback,
  localSnapshotContext?: LocalGameSnapshotContext,
  options: PrepareLocalSnapshotOptions = { baseVersion: 0 }
): Promise<UploadLocalGameSnapshotResult> => {
  const context =
    localSnapshotContext ??
    (await buildLocalGameSnapshotContext(objectId, shop));
  const files = options.files ?? context.files;

  const snapshot = await createRemoteSnapshotFromLocalState(
    objectId,
    shop,
    onProgress,
    context,
    options
  );
  return {
    pendingSnapshotId: snapshot?.id ?? null,
    uploadedFiles: files.length,
    skippedFiles: 0,
  };
};
