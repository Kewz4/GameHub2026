import type { GameShop } from "@types";

import type { CloudSaveLaunchSession } from "./launch-guard";

export interface StoredCloudSavePendingPostExit {
  schemaVersion: 1;
  objectId: string;
  shop: GameShop;
  session: Pick<
    CloudSaveLaunchSession,
    "token" | "environmentId" | "baseRemoteHash" | "uploadAllowed" | "createdAt"
  >;
  queuedAt: string;
}

export const cloudSavePendingPostExitStorageKey = (
  userId: string,
  shop: GameShop,
  objectId: string
) => JSON.stringify([userId, shop, objectId]);

export const parseCloudSavePendingPostExitStorageKey = (key: string) => {
  try {
    const value: unknown = JSON.parse(key);
    if (
      Array.isArray(value) &&
      value.length === 3 &&
      value.every((part) => typeof part === "string" && part.length > 0)
    ) {
      return value as [userId: string, shop: GameShop, objectId: string];
    }
  } catch {
    // Invalid records are ignored rather than crossing an account fence.
  }
  return null;
};

export const resolveCloudSavePendingPostExit = (
  value: unknown
): StoredCloudSavePendingPostExit | null => {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<StoredCloudSavePendingPostExit>;
  const session = record.session as
    | Partial<StoredCloudSavePendingPostExit["session"]>
    | undefined;
  if (
    record.schemaVersion !== 1 ||
    typeof record.objectId !== "string" ||
    record.objectId.length === 0 ||
    typeof record.shop !== "string" ||
    record.shop.length === 0 ||
    typeof record.queuedAt !== "string" ||
    !Number.isFinite(Date.parse(record.queuedAt)) ||
    !session ||
    typeof session.token !== "string" ||
    session.token.length === 0 ||
    typeof session.environmentId !== "string" ||
    session.environmentId.length === 0 ||
    (session.baseRemoteHash !== null &&
      typeof session.baseRemoteHash !== "string") ||
    session.uploadAllowed !== true ||
    typeof session.createdAt !== "string" ||
    !Number.isFinite(Date.parse(session.createdAt))
  ) {
    return null;
  }
  return record as StoredCloudSavePendingPostExit;
};

export const createCloudSavePendingPostExit = (
  session: CloudSaveLaunchSession,
  queuedAt = new Date().toISOString()
): StoredCloudSavePendingPostExit => ({
  schemaVersion: 1,
  objectId: session.objectId,
  shop: session.shop,
  session: {
    token: session.token,
    environmentId: session.environmentId,
    baseRemoteHash: session.baseRemoteHash,
    uploadAllowed: session.uploadAllowed,
    createdAt: session.createdAt,
  },
  queuedAt,
});
