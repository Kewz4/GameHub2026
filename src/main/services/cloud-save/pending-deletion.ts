import crypto from "node:crypto";

import { cloudSavePendingDeletionsSublevel } from "@main/level";
import type { GameShop } from "@types";

import {
  assertCloudSaveAccountSessionCurrent,
  getCloudSaveAccountUserId,
} from "./account-session";
import {
  cloudSavePendingDeletionStorageKey,
  resolveCloudSavePendingDeletion,
  resolveCloudSavePendingDeletionPhase,
  type StoredCloudSavePendingDeletion,
} from "./pending-deletion-state";

const getCurrentUserId = async () => {
  return getCloudSaveAccountUserId();
};

const getStorageKey = async (objectId: string, shop: GameShop) =>
  cloudSavePendingDeletionStorageKey(await getCurrentUserId(), shop, objectId);

export const getCloudSavePendingDeletionPhase = async (
  objectId: string,
  shop: GameShop
) =>
  resolveCloudSavePendingDeletionPhase(
    await cloudSavePendingDeletionsSublevel.get(
      await getStorageKey(objectId, shop)
    )
  );

export const getCloudSavePendingDeletion = async (
  objectId: string,
  shop: GameShop
) => {
  const key = await getStorageKey(objectId, shop);
  const value = await cloudSavePendingDeletionsSublevel.get(key);
  assertCloudSaveAccountSessionCurrent();
  const state = resolveCloudSavePendingDeletion(value);
  if (state) return state;
  if (value === undefined) return null;
  // Older/incomplete records fail closed but receive a stable operation ID so
  // recovery can continue through the R2 deletion fence.
  const migrated: StoredCloudSavePendingDeletion = {
    schemaVersion: 1,
    phase: resolveCloudSavePendingDeletionPhase(value) ?? "remote-started",
    operationId: crypto.randomUUID(),
  };
  assertCloudSaveAccountSessionCurrent();
  await cloudSavePendingDeletionsSublevel.put(key, migrated);
  return migrated;
};

export const isCloudSaveDeletionPending = async (
  objectId: string,
  shop: GameShop
) => (await getCloudSavePendingDeletionPhase(objectId, shop)) !== null;

export const assertCloudSaveDeletionNotPending = async (
  objectId: string,
  shop: GameShop
) => {
  if (await isCloudSaveDeletionPending(objectId, shop)) {
    throw new Error("cloud_save_delete_pending");
  }
};

export const beginCloudSavePendingDeletion = async (
  objectId: string,
  shop: GameShop
) => {
  const key = await getStorageKey(objectId, shop);
  const currentValue = await cloudSavePendingDeletionsSublevel.get(key);
  assertCloudSaveAccountSessionCurrent();
  const current = resolveCloudSavePendingDeletion(currentValue);
  if (current) return current;

  const state: StoredCloudSavePendingDeletion = {
    schemaVersion: 1,
    phase: "prepared",
    operationId: crypto.randomUUID(),
  };
  assertCloudSaveAccountSessionCurrent();
  await cloudSavePendingDeletionsSublevel.put(key, state);
  return state;
};

export const markCloudSaveRemoteDeletionStarted = async (
  objectId: string,
  shop: GameShop
) => {
  const current = await getCloudSavePendingDeletion(objectId, shop);
  if (!current) throw new Error("cloud_save_delete_pending_missing");
  const state: StoredCloudSavePendingDeletion = {
    ...current,
    phase: "remote-started",
  };
  const key = await getStorageKey(objectId, shop);
  assertCloudSaveAccountSessionCurrent();
  await cloudSavePendingDeletionsSublevel.put(key, state);
};

export const clearCloudSavePendingDeletion = async (
  objectId: string,
  shop: GameShop
) => {
  const key = await getStorageKey(objectId, shop);
  assertCloudSaveAccountSessionCurrent();
  return cloudSavePendingDeletionsSublevel.del(key);
};
