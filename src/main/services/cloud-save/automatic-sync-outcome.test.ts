import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyAutomaticCloudSaveFailure,
  getPendingDeletionAutomaticSyncOutcome,
  shouldSkipAutomaticCloudSaveDuringLaunch,
} from "./automatic-sync-outcome.js";

describe("automatic cloud save sync outcome", () => {
  it("cancels automatic sync while deletion is pending", () => {
    assert.deepEqual(getPendingDeletionAutomaticSyncOutcome(true), {
      status: "cancelled",
      result: null,
      errorCode: "cloud_save_delete_pending",
    });
    assert.equal(getPendingDeletionAutomaticSyncOutcome(false), null);
  });

  it("allows pre-launch failures before restore to continue offline", () => {
    assert.equal(classifyAutomaticCloudSaveFailure("pre-launch"), "offline");
    assert.equal(
      classifyAutomaticCloudSaveFailure("pre-launch", "analyzing"),
      "offline"
    );
  });

  it("blocks only after a necessary pre-launch restore starts", () => {
    assert.equal(
      classifyAutomaticCloudSaveFailure("pre-launch", "restoring"),
      "failed"
    );
    assert.equal(
      classifyAutomaticCloudSaveFailure("post-exit", "analyzing"),
      "failed"
    );
  });

  it("skips passive game-page refreshes while a launch owns the save", () => {
    assert.equal(
      shouldSkipAutomaticCloudSaveDuringLaunch("game-page-open", true),
      true
    );
    assert.equal(
      shouldSkipAutomaticCloudSaveDuringLaunch("pre-launch", true),
      false
    );
    assert.equal(
      shouldSkipAutomaticCloudSaveDuringLaunch("game-page-open", false),
      false
    );
  });
});
