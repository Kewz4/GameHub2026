import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  planCloudSaveLocalNamespaceMigration,
  type CloudSaveLocalNamespaceEntry,
} from "./cloud-save-local-namespace-migration";

const legacyId = "6ce66cac-e77d-4c40-95c2-13954092fe15";
const accountId = "account-123";

describe("local Cloud Save namespace migration", () => {
  it("moves every durable Cloud Save V2 account-scoped record", () => {
    const entries: CloudSaveLocalNamespaceEntry[] = [
      {
        store: "custom-paths",
        key: JSON.stringify([legacyId, "steam", "1"]),
        value: [{ rawPath: "<custom><windows><home>/Game" }],
      },
      {
        store: "sync-anchors",
        key: JSON.stringify([
          legacyId,
          "steam",
          "1",
          "environment",
          "windows-native",
        ]),
        value: { schemaVersion: 4, baseSnapshotId: "snapshot" },
      },
      {
        store: "pending-deletions",
        key: JSON.stringify([legacyId, "steam", "1"]),
        value: {
          schemaVersion: 1,
          phase: "remote-started",
          operationId: "same-r2-fence-operation",
        },
      },
      {
        store: "pending-post-exit",
        key: JSON.stringify([legacyId, "steam", "1"]),
        value: {
          schemaVersion: 1,
          objectId: "1",
          shop: "steam",
          session: { token: "launch-session" },
        },
      },
    ];

    const operations = planCloudSaveLocalNamespaceMigration(
      entries,
      [legacyId],
      accountId
    );

    assert.equal(operations.filter(({ type }) => type === "put").length, 4);
    assert.equal(operations.filter(({ type }) => type === "del").length, 4);
    assert.ok(
      operations.some(
        (operation) =>
          operation.type === "put" &&
          operation.store === "pending-deletions" &&
          operation.key === JSON.stringify([accountId, "steam", "1"]) &&
          (operation.value as { operationId: string }).operationId ===
            "same-r2-fence-operation"
      )
    );
    assert.ok(
      operations.some(
        (operation) =>
          operation.type === "put" &&
          operation.store === "pending-post-exit" &&
          operation.key === JSON.stringify([accountId, "steam", "1"])
      )
    );
  });

  it("deduplicates equal destination state", () => {
    const oldKey = JSON.stringify([legacyId, "steam", "1"]);
    const newKey = JSON.stringify([accountId, "steam", "1"]);
    const value = [{ rawPath: "<custom><windows><home>/Game" }];
    const operations = planCloudSaveLocalNamespaceMigration(
      [
        { store: "custom-paths", key: oldKey, value },
        { store: "custom-paths", key: newKey, value: structuredClone(value) },
      ],
      [legacyId],
      accountId
    );

    assert.deepEqual(operations, [
      { type: "del", store: "custom-paths", key: oldKey },
    ]);
  });

  it("fails before overwriting conflicting account state", () => {
    assert.throws(
      () =>
        planCloudSaveLocalNamespaceMigration(
          [
            {
              store: "pending-deletions",
              key: JSON.stringify([legacyId, "steam", "1"]),
              value: { operationId: "legacy-operation" },
            },
            {
              store: "pending-deletions",
              key: JSON.stringify([accountId, "steam", "1"]),
              value: { operationId: "different-account-operation" },
            },
          ],
          [legacyId],
          accountId
        ),
      /cloud_save_local_namespace_conflict/
    );
  });
});
