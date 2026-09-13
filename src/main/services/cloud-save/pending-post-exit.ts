import { cloudSavePendingPostExitSublevel } from "@main/level";
import type { GameShop } from "@types";

import { logger } from "../logger";
import {
  assertCloudSaveAccountSessionCurrent,
  getCloudSaveAccountUserId,
  runWithCloudSaveAccountSession,
} from "./account-session";
import { runAutomaticCloudSavePostExit } from "./automatic-sync";
import type { CloudSaveLaunchSession } from "./launch-guard";
import {
  cloudSavePendingPostExitStorageKey,
  createCloudSavePendingPostExit,
  parseCloudSavePendingPostExitStorageKey,
  resolveCloudSavePendingPostExit,
  type StoredCloudSavePendingPostExit,
} from "./pending-post-exit-state";
import {
  clearPendingPostExitIfConfirmed,
  selectPendingPostExitReplayEntries,
} from "./pending-post-exit-policy";
import { CloudSavePostExitOperationTracker } from "./post-exit-operation-tracker";

export const CLOUD_SAVE_POST_EXIT_DRAIN_TIMEOUT_MS = 8_000;

const operations = new CloudSavePostExitOperationTracker();
const retries = new Map<string, Promise<boolean>>();
let replayPromise: Promise<void> | null = null;

const getStorageKey = (
  userId: string,
  record: StoredCloudSavePendingPostExit
) => cloudSavePendingPostExitStorageKey(userId, record.shop, record.objectId);

export const persistPendingCloudSavePostExit = async (
  session: CloudSaveLaunchSession
) => {
  if (
    session.mode !== "v2" ||
    !session.uploadAllowed ||
    !session.environmentId
  ) {
    return null;
  }
  const userId = await getCloudSaveAccountUserId();
  const record = createCloudSavePendingPostExit(session);
  const key = getStorageKey(userId, record);
  assertCloudSaveAccountSessionCurrent();
  await cloudSavePendingPostExitSublevel.put(key, record);
  assertCloudSaveAccountSessionCurrent();
  return { key, record };
};

/** A user-confirmed V2 deletion must not be resurrected by an older exit. */
export const clearPendingCloudSavePostExitForGame = async (
  objectId: string,
  shop: GameShop
) => {
  const userId = await getCloudSaveAccountUserId();
  const key = cloudSavePendingPostExitStorageKey(userId, shop, objectId);
  assertCloudSaveAccountSessionCurrent();
  await cloudSavePendingPostExitSublevel.del(key);
  assertCloudSaveAccountSessionCurrent();
};

const executePendingRecord = async (
  key: string,
  record: StoredCloudSavePendingPostExit
) => {
  // Coalesce the same durable continuation, not merely the same game. A newer
  // launch can replace an older pending token while its retry is settling; it
  // must still get its own serialized attempt rather than inheriting `false`.
  const retryKey = JSON.stringify([key, record.session.token]);
  const active = retries.get(retryKey);
  if (active) return active;

  const retry = runWithCloudSaveAccountSession(async () => {
    const userId = await getCloudSaveAccountUserId();
    const parsedKey = parseCloudSavePendingPostExitStorageKey(key);
    if (
      !parsedKey ||
      parsedKey[0] !== userId ||
      parsedKey[1] !== record.shop ||
      parsedKey[2] !== record.objectId
    ) {
      return false;
    }

    const current = resolveCloudSavePendingPostExit(
      await cloudSavePendingPostExitSublevel.get(key)
    );
    assertCloudSaveAccountSessionCurrent();
    if (current?.session.token !== record.session.token) return false;

    const result = await runAutomaticCloudSavePostExit(
      record.objectId,
      record.shop,
      {
        token: record.session.token,
        objectId: record.objectId,
        shop: record.shop,
        mode: "v2",
        phase: "finalizing",
        environmentId: record.session.environmentId,
        baseRemoteHash: record.session.baseRemoteHash,
        uploadAllowed: record.session.uploadAllowed,
        createdAt: record.session.createdAt,
      }
    );
    return clearPendingPostExitIfConfirmed(
      cloudSavePendingPostExitSublevel,
      key,
      record.session.token,
      result,
      assertCloudSaveAccountSessionCurrent
    );
  }).finally(() => {
    if (retries.get(retryKey) === retry) retries.delete(retryKey);
  });
  retries.set(retryKey, retry);
  return retry;
};

export const runPersistedCloudSavePostExit = (
  key: string,
  record: StoredCloudSavePendingPostExit
) => operations.track(executePendingRecord(key, record));

export const replayPendingCloudSavePostExit = () => {
  if (replayPromise) return replayPromise;
  replayPromise = runWithCloudSaveAccountSession(async () => {
    const userId = await getCloudSaveAccountUserId();
    const entries: Array<[string, unknown]> = [];
    for await (const [
      key,
      value,
    ] of cloudSavePendingPostExitSublevel.iterator()) {
      assertCloudSaveAccountSessionCurrent();
      entries.push([key, value]);
    }
    const { selected, malformedKeys } = selectPendingPostExitReplayEntries(
      userId,
      entries
    );
    for (const key of malformedKeys) {
      logger.warn("[Cloud Save] Ignoring malformed pending post-exit record", {
        key,
      });
    }
    await Promise.allSettled(
      selected.map(([key, record]) =>
        runPersistedCloudSavePostExit(key, record)
      )
    );
  })
    .catch((error: unknown) => {
      logger.error("[Cloud Save] Pending post-exit replay failed", {
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => {
      replayPromise = null;
    });
  return replayPromise;
};

export const trackCloudSavePostExitOperation = <T>(operation: Promise<T>) =>
  operations.track(operation);

export const drainCloudSavePostExitOperations = (timeoutMs: number) =>
  operations.drain(timeoutMs);

export const retryPendingCloudSavePostExitOnNetworkReconnect = (
  online: boolean,
  switched = false
) => {
  if (!online || !switched) return;
  void replayPendingCloudSavePostExit();
};

export const pendingCloudSavePostExitStorageKeyForTest = (
  userId: string,
  shop: GameShop,
  objectId: string
) => cloudSavePendingPostExitStorageKey(userId, shop, objectId);
