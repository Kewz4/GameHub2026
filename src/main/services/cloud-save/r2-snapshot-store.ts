import path from "node:path";

import {
  R2Sync,
  type R2CloudSaveV2ControlDocument,
  type R2CloudSaveV2SnapshotDocument,
} from "@main/services/r2-sync";
import type { GameShop } from "@types";
import {
  assertCloudSaveAccountSessionCurrent,
  getCloudSaveAccountUserId,
  runWithCloudSaveAccountSession,
} from "./account-session";

export const getCloudSaveR2UserId = () => getCloudSaveAccountUserId();

const withCloudSaveR2Account = async <T>(
  operation: (userId: string) => Promise<T>
) =>
  runWithCloudSaveAccountSession(async () => {
    const userId = await getCloudSaveR2UserId();
    assertCloudSaveAccountSessionCurrent();
    const result = await operation(userId);
    assertCloudSaveAccountSessionCurrent();
    return result;
  });

export const getR2ActiveCloudSaveSnapshot = async (
  objectId: string,
  shop: GameShop
) =>
  withCloudSaveR2Account((userId) =>
    R2Sync.getCloudSaveV2Head(userId, shop, objectId)
  );

export const getR2CloudSaveSnapshot = async (
  objectId: string,
  shop: GameShop,
  snapshotId: string,
  version: number
) =>
  withCloudSaveR2Account((userId) =>
    R2Sync.getCloudSaveV2Snapshot(userId, shop, objectId, snapshotId, version)
  );

export const commitR2CloudSaveSnapshot = async (
  document: R2CloudSaveV2SnapshotDocument,
  expectedControl: R2CloudSaveV2ControlDocument | null,
  expectedHeadEtag: string | null
) =>
  withCloudSaveR2Account((userId) =>
    R2Sync.commitCloudSaveV2Snapshot(
      userId,
      document,
      expectedControl,
      expectedHeadEtag
    )
  );

export const uploadR2CloudSaveBlob = async (
  objectId: string,
  shop: GameShop,
  absolutePath: string,
  hash: string,
  sizeBytes: number,
  expectedEpoch: number
) =>
  withCloudSaveR2Account((userId) =>
    R2Sync.uploadCloudSaveV2Blob(
      userId,
      shop,
      objectId,
      absolutePath,
      hash,
      sizeBytes,
      expectedEpoch
    )
  );

export const downloadR2CloudSaveBlob = async (
  objectId: string,
  shop: GameShop,
  hash: string,
  destinationPath: string
) => {
  if (path.basename(destinationPath) !== `${hash}.blob`) {
    throw new Error("cloud_save_invalid_restore_temp_path");
  }
  return withCloudSaveR2Account((userId) =>
    R2Sync.downloadCloudSaveV2Blob(
      userId,
      shop,
      objectId,
      hash,
      destinationPath
    )
  );
};

export const beginR2CloudSaveGameDeletion = async (
  objectId: string,
  shop: GameShop,
  operationId: string
) =>
  withCloudSaveR2Account((userId) =>
    R2Sync.beginCloudSaveV2Deletion(userId, shop, objectId, operationId)
  );

export const deleteR2CloudSaveGameObjects = async (
  objectId: string,
  shop: GameShop,
  operationId: string
) =>
  withCloudSaveR2Account((userId) =>
    R2Sync.deleteCloudSaveV2GameObjects(userId, shop, objectId, operationId)
  );

export const finishR2CloudSaveGameDeletion = async (
  objectId: string,
  shop: GameShop,
  operationId: string
) =>
  withCloudSaveR2Account((userId) =>
    R2Sync.finishCloudSaveV2Deletion(userId, shop, objectId, operationId)
  );
