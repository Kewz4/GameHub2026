import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  clearPendingPostExitIfConfirmed,
  selectPendingPostExitReplayEntries,
} from "./pending-post-exit-policy.js";
import {
  cloudSavePendingPostExitStorageKey,
  type StoredCloudSavePendingPostExit,
} from "./pending-post-exit-state.js";

const record = (token = "launch-token"): StoredCloudSavePendingPostExit => ({
  schemaVersion: 1,
  objectId: "2651280",
  shop: "steam",
  session: {
    token,
    environmentId: "windows:game-dir",
    baseRemoteHash: "base-remote-hash",
    uploadAllowed: true,
    createdAt: "2026-08-13T00:00:00.000Z",
  },
  queuedAt: "2026-08-13T00:10:00.000Z",
});

const completed = (action: "upload" | "none" = "upload") => ({
  trigger: "post-exit" as const,
  action,
  initialState: "local-ahead" as const,
  finalState: "synced" as const,
  environmentId: "windows:game-dir",
});

describe("Cloud Save V2 pending post-exit policy", () => {
  it("keeps a failed upload for startup retry, then clears it on confirmation", async () => {
    const userId = "account-a";
    const key = cloudSavePendingPostExitStorageKey(userId, "steam", "2651280");
    const values = new Map<string, unknown>([[key, record()]]);
    const store = {
      get: async (storageKey: string) => values.get(storageKey),
      del: async (storageKey: string) => values.delete(storageKey),
    };

    // Process one failed; the durable record survives process teardown.
    assert.equal(
      await clearPendingPostExitIfConfirmed(store, key, "launch-token", null),
      false
    );
    assert.equal(values.has(key), true);

    // A fresh process selects only its account's record and retries it.
    const startup = selectPendingPostExitReplayEntries(
      userId,
      values.entries()
    );
    assert.equal(startup.selected.length, 1);
    assert.equal(
      startup.selected[0][1].session.baseRemoteHash,
      "base-remote-hash"
    );
    assert.equal(
      await clearPendingPostExitIfConfirmed(
        store,
        key,
        startup.selected[0][1].session.token,
        completed()
      ),
      true
    );
    assert.equal(values.has(key), false);
  });

  it("clears a confirmed no-op but never clears a replacement session", async () => {
    const key = cloudSavePendingPostExitStorageKey(
      "account-a",
      "steam",
      "2651280"
    );
    const values = new Map<string, unknown>([[key, record("new-token")]]);
    const store = {
      get: async (storageKey: string) => values.get(storageKey),
      del: async (storageKey: string) => values.delete(storageKey),
    };

    assert.equal(
      await clearPendingPostExitIfConfirmed(
        store,
        key,
        "old-token",
        completed("none")
      ),
      false
    );
    assert.equal(values.has(key), true);
    assert.equal(
      await clearPendingPostExitIfConfirmed(
        store,
        key,
        "new-token",
        completed("none")
      ),
      true
    );
  });

  it("fences startup replay to the active account", () => {
    const accountA = cloudSavePendingPostExitStorageKey(
      "account-a",
      "steam",
      "2651280"
    );
    const accountB = cloudSavePendingPostExitStorageKey(
      "account-b",
      "steam",
      "2651280"
    );
    const selected = selectPendingPostExitReplayEntries("account-a", [
      [accountA, record("a")],
      [accountB, record("b")],
    ]);

    assert.deepEqual(
      selected.selected.map(([key]) => key),
      [accountA]
    );
  });
});
