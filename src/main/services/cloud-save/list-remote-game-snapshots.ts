import type { GameShop, RemoteSnapshotSummary } from "@types";

import { validateRemoteSnapshotSummary } from "./cloud-save-contract";
import { getR2ActiveCloudSaveSnapshot } from "./r2-snapshot-store";

export const listRemoteGameSnapshots = async (
  objectId: string,
  shop: GameShop
): Promise<RemoteSnapshotSummary[]> =>
  (await getRemoteGameSnapshotState(objectId, shop)).snapshots;

export const getRemoteGameSnapshotState = async (
  objectId: string,
  shop: GameShop
): Promise<{
  snapshots: RemoteSnapshotSummary[];
  deletionTombstone: boolean;
}> => {
  const head = await getR2ActiveCloudSaveSnapshot(objectId, shop);
  if (!head) return { snapshots: [], deletionTombstone: false };
  if (head.control.status === "deleting") {
    throw new Error("cloud_save_deletion_pending");
  }
  const { document } = head;
  if (!document) {
    return {
      snapshots: [],
      deletionTombstone: head.control.epoch > 0,
    };
  }
  if (
    document.schemaVersion !== 1 ||
    document.snapshot.shop !== shop ||
    document.snapshot.objectId !== objectId
  ) {
    throw new Error("Invalid R2 Cloud Save head");
  }
  return {
    deletionTombstone: false,
    snapshots: [
      validateRemoteSnapshotSummary({
        id: document.snapshot.id,
        version: document.snapshot.version,
        createdAt: document.snapshot.createdAt,
        updatedAt: document.snapshot.updatedAt,
        fileCount: document.snapshot.fileCount,
        totalSizeBytes: document.snapshot.totalSizeBytes,
        aggregateHash: document.snapshot.aggregateHash,
      }),
    ],
  };
};
