import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getFirstSyncState } from "./first-sync-state.js";

const analysis = (localPaths: string[], remotePaths: string[] | null) =>
  ({
    localSnapshot: { files: [], aggregateHash: "a".repeat(64) },
    localSnapshotContext: { customPathRawPaths: localPaths },
    state: {
      activeRemoteSnapshot:
        remotePaths === null ? null : { aggregateHash: "a".repeat(64) },
    },
    remoteManifest:
      remotePaths === null ? null : { customPathRawPaths: remotePaths },
  }) as unknown as Parameters<typeof getFirstSyncState>[0];

describe("first Cloud Save sync state", () => {
  it("publishes a newly tracked empty custom directory", () => {
    assert.equal(
      getFirstSyncState(
        analysis(["<custom><windows><winDocuments>/Empty"], null)
      ),
      "local-ahead"
    );
  });

  it("compares authoritative custom paths even when file hashes match", () => {
    const path = "<custom><windows><winDocuments>/Empty";
    assert.equal(getFirstSyncState(analysis([path], [path])), "synced");
    assert.equal(getFirstSyncState(analysis([path], [])), "conflict");
  });
});
