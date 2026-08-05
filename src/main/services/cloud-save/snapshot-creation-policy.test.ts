import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { shouldCreateRemoteCloudSaveSnapshot } from "./snapshot-creation-policy";

describe("remote cloud-save snapshot creation policy", () => {
  it("skips a first upload when no save files exist", () => {
    assert.equal(shouldCreateRemoteCloudSaveSnapshot(0, 0), false);
  });

  it("commits an empty successor snapshot after the last file is removed", () => {
    assert.equal(shouldCreateRemoteCloudSaveSnapshot(0, 3), true);
  });

  it("always commits a non-empty snapshot", () => {
    assert.equal(shouldCreateRemoteCloudSaveSnapshot(1, 0), true);
  });
});
