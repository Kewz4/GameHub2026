import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertR2CloudSaveV2HeadConsistency,
  serializeCanonicalR2CloudSaveJson,
  validateR2CloudSaveV2ControlDocument,
  validateR2CloudSaveV2SnapshotDocument,
} from "./r2-snapshot-contract";

const hash = "a".repeat(64);
const variantId = "b".repeat(64);
const snapshot = {
  schemaVersion: 1 as const,
  snapshot: {
    id: "snapshot-id",
    version: 1,
    shop: "steam" as const,
    objectId: "123",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    fileCount: 1,
    totalSizeBytes: 4,
    aggregateHash: hash,
    epoch: 0,
  },
  variants: [{ variantId, kind: "default" as const }],
  files: [
    {
      variantId,
      rawPath: "<home>/Game",
      relativePath: "save.dat",
      hash,
      sizeBytes: 4,
      lastModifiedAt: "2026-08-01T00:00:00.000Z",
    },
  ],
};

describe("R2 Cloud Saves V2 snapshot contract", () => {
  it("validates a canonical manifest and matching active control", () => {
    const document = validateR2CloudSaveV2SnapshotDocument(
      snapshot,
      { shop: "steam", objectId: "123", snapshotId: "snapshot-id", version: 1 },
      () => hash
    );
    const control = validateR2CloudSaveV2ControlDocument(
      {
        schemaVersion: 1,
        revision: 1,
        epoch: 0,
        status: "active",
        deleteOperationId: null,
        snapshot: snapshot.snapshot,
        updatedAt: snapshot.snapshot.updatedAt,
      },
      { shop: "steam", objectId: "123" }
    );
    assert.doesNotThrow(() =>
      assertR2CloudSaveV2HeadConsistency(control, document)
    );
  });

  it("accepts an empty active deletion tombstone but rejects a deleting pointer", () => {
    assert.doesNotThrow(() =>
      validateR2CloudSaveV2ControlDocument(
        {
          schemaVersion: 1,
          revision: 3,
          epoch: 1,
          status: "active",
          deleteOperationId: null,
          snapshot: null,
          updatedAt: "2026-08-01T00:01:00.000Z",
        },
        { shop: "steam", objectId: "123" }
      )
    );
    assert.throws(() =>
      validateR2CloudSaveV2ControlDocument(
        {
          schemaVersion: 1,
          revision: 2,
          epoch: 0,
          status: "deleting",
          deleteOperationId: "delete-id",
          snapshot: snapshot.snapshot,
          updatedAt: snapshot.snapshot.updatedAt,
        },
        { shop: "steam", objectId: "123" }
      )
    );
  });

  it("rejects unknown fields, bad aggregates, and divergent head pointers", () => {
    assert.throws(() =>
      validateR2CloudSaveV2SnapshotDocument(
        { ...snapshot, unexpected: true },
        { shop: "steam", objectId: "123" },
        () => hash
      )
    );
    assert.throws(() =>
      validateR2CloudSaveV2SnapshotDocument(
        snapshot,
        { shop: "steam", objectId: "123" },
        () => "c".repeat(64)
      )
    );
    const control = validateR2CloudSaveV2ControlDocument(
      {
        schemaVersion: 1,
        revision: 1,
        epoch: 0,
        status: "active",
        deleteOperationId: null,
        snapshot: snapshot.snapshot,
        updatedAt: snapshot.snapshot.updatedAt,
      },
      { shop: "steam", objectId: "123" }
    );
    assert.throws(() =>
      assertR2CloudSaveV2HeadConsistency(control, {
        ...snapshot,
        snapshot: { ...snapshot.snapshot, id: "other" },
      })
    );
  });

  it("serializes objects with stable lexical keys", () => {
    assert.equal(
      serializeCanonicalR2CloudSaveJson({ z: 1, a: { y: 2, b: 3 } }),
      '{"a":{"b":3,"y":2},"z":1}'
    );
  });
});
