import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import {
  createCloudSaveRemoteHeadConflictError,
  createCloudSaveSnapshotProposalId,
  publishCloudSaveSnapshotProposal,
} from "./r2-snapshot-publication";

interface FakeProposal {
  id: string;
  version: number;
  body: string;
}

class FakeSnapshotStore {
  readonly immutable = new Map<string, string>();
  activeId: string | null = null;
  revision = 0;

  publish(proposal: FakeProposal) {
    const key = `${proposal.version}-${proposal.id}`;
    const existing = this.immutable.get(key);
    if (existing === proposal.body) return "already-present" as const;
    if (existing !== undefined) return "collision" as const;
    this.immutable.set(key, proposal.body);
    return "created" as const;
  }

  advance(expectedRevision: number, proposal: FakeProposal) {
    if (this.revision !== expectedRevision) {
      throw createCloudSaveRemoteHeadConflictError();
    }
    this.revision += 1;
    this.activeId = proposal.id;
  }
}

const proposal = (body: string): FakeProposal => ({
  id: createCloudSaveSnapshotProposalId(),
  version: 2,
  body,
});

describe("R2 snapshot proposal publication", () => {
  it("recovers from a post-snapshot/pre-control failure with a fresh UUID", async () => {
    const store = new FakeSnapshotStore();
    const orphan = proposal("orphaned manifest");

    await assert.rejects(
      publishCloudSaveSnapshotProposal({
        publishImmutableSnapshot: async () => store.publish(orphan),
        advanceControl: async () => {
          throw new Error("socket hang up before control response");
        },
      }),
      /socket hang up/
    );

    const retry = proposal("retry manifest");
    assert.notEqual(retry.id, orphan.id);
    await publishCloudSaveSnapshotProposal({
      publishImmutableSnapshot: async () => store.publish(retry),
      advanceControl: async () => store.advance(0, retry),
    });

    assert.equal(store.immutable.size, 2);
    assert.equal(store.activeId, retry.id);
  });

  it("lets two concurrent N+1 manifests coexist while only one control CAS wins", async () => {
    const store = new FakeSnapshotStore();
    const left = proposal("left");
    const right = proposal("right");
    assert.notEqual(left.id, right.id);

    const publish = (candidate: FakeProposal) =>
      publishCloudSaveSnapshotProposal({
        publishImmutableSnapshot: async () => store.publish(candidate),
        advanceControl: async () => store.advance(0, candidate),
      });
    const results = await Promise.allSettled([publish(left), publish(right)]);

    assert.equal(store.immutable.size, 2);
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1
    );
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );
    assert.equal(rejected?.reason?.code, "cloud_save_remote_head_conflict");
    assert.ok(store.activeId === left.id || store.activeId === right.id);
  });

  it("classifies an immutable key collision as a recoverable head conflict", async () => {
    await assert.rejects(
      publishCloudSaveSnapshotProposal({
        publishImmutableSnapshot: async () => "collision",
        advanceControl: async () => assert.fail("control must not advance"),
      }),
      (error: Error & { code?: string }) =>
        error.message === "cloud_save_remote_head_conflict" &&
        error.code === "cloud_save_remote_head_conflict"
    );
  });
});
