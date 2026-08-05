import path from "node:path";

import {
  R2Sync,
  type R2CloudSaveV2ControlDocument,
  type R2CloudSaveV2SnapshotDocument,
} from "@main/services/r2-sync";
import { CloudSync } from "@main/services/cloud-sync";
import type { GameShop } from "@types";

export const getCloudSaveR2UserId = () => CloudSync.getOrCreateUserId();

export const getR2ActiveCloudSaveSnapshot = async (
  objectId: string,
  shop: GameShop
) =>
  R2Sync.getCloudSaveV2Head(
    await getCloudSaveR2UserId(),
    shop,
    objectId
  );

export const getR2CloudSaveSnapshot = async (
  objectId: string,
  shop: GameShop,
  snapshotId: string,
  version: number
) =>
  R2Sync.getCloudSaveV2Snapshot(
    await getCloudSaveR2UserId(),
    shop,
    objectId,
    snapshotId,
    version
  );

export const commitR2CloudSaveSnapshot = async (
  document: R2CloudSaveV2SnapshotDocument,
  expectedControl: R2CloudSaveV2ControlDocument | null,
  expectedHeadEtag: string | null
) =>
  R2Sync.commitCloudSaveV2Snapshot(
    await getCloudSaveR2UserId(),
    document,
    expectedControl,
    expectedHeadEtag
  );

export const uploadR2CloudSaveBlob = async (
  objectId: string,
  shop: GameShop,
  absolutePath: string,
  hash: string,
  sizeBytes: number,
  expectedEpoch: number
) =>
  R2Sync.uploadCloudSaveV2Blob(
    await getCloudSaveR2UserId(),
    shop,
    objectId,
    absolutePath,
    hash,
    sizeBytes,
    expectedEpoch
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
  return R2Sync.downloadCloudSaveV2Blob(
    await getCloudSaveR2UserId(),
    shop,
    objectId,
    hash,
    destinationPath
  );
};

export const beginR2CloudSaveGameDeletion = async (
  objectId: string,
  shop: GameShop,
  operationId: string
) =>
  R2Sync.beginCloudSaveV2Deletion(
    await getCloudSaveR2UserId(),
    shop,
    objectId,
    operationId
  );

export const deleteR2CloudSaveGameObjects = async (
  objectId: string,
  shop: GameShop,
  operationId: string
) =>
  R2Sync.deleteCloudSaveV2GameObjects(
    await getCloudSaveR2UserId(),
    shop,
    objectId,
    operationId
  );

export const finishR2CloudSaveGameDeletion = async (
  objectId: string,
  shop: GameShop,
  operationId: string
) =>
  R2Sync.finishCloudSaveV2Deletion(
    await getCloudSaveR2UserId(),
    shop,
    objectId,
    operationId
  );
