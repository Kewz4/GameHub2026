import type { SyncGameCloudSaveResult } from "@types";

import {
  parseCloudSavePendingPostExitStorageKey,
  resolveCloudSavePendingPostExit,
  type StoredCloudSavePendingPostExit,
} from "./pending-post-exit-state";

export interface PendingPostExitRecordStore {
  get(key: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

export const isConfirmedCloudSavePostExitResult = (
  result: SyncGameCloudSaveResult | null
) =>
  result !== null &&
  (result.action === "upload" || result.action === "none") &&
  result.finalState !== "partial" &&
  result.finalState !== "conflict";

export const clearPendingPostExitIfConfirmed = async (
  store: PendingPostExitRecordStore,
  key: string,
  expectedToken: string,
  result: SyncGameCloudSaveResult | null,
  assertCurrent: () => void = () => undefined
) => {
  if (!isConfirmedCloudSavePostExitResult(result)) return false;
  const current = resolveCloudSavePendingPostExit(await store.get(key));
  assertCurrent();
  if (current?.session.token !== expectedToken) return false;
  await store.del(key);
  assertCurrent();
  return true;
};

export const selectPendingPostExitReplayEntries = (
  userId: string,
  entries: Iterable<[string, unknown]>
) => {
  const selected: Array<[string, StoredCloudSavePendingPostExit]> = [];
  const malformedKeys: string[] = [];
  for (const [key, value] of entries) {
    const parsedKey = parseCloudSavePendingPostExitStorageKey(key);
    if (parsedKey?.[0] !== userId) continue;
    const record = resolveCloudSavePendingPostExit(value);
    if (
      !record ||
      parsedKey[1] !== record.shop ||
      parsedKey[2] !== record.objectId
    ) {
      malformedKeys.push(key);
      continue;
    }
    selected.push([key, record]);
  }
  return { selected, malformedKeys };
};
