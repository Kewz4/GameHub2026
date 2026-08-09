import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  achievementSyncAttemptCount,
  achievementSyncRetryDelay,
  isRetryableAchievementSyncError,
} from "./achievement-cloud-retry-policy";

describe("achievement cloud retry policy", () => {
  it("uses a small bounded backoff budget", () => {
    assert.equal(achievementSyncAttemptCount, 3);
    assert.deepEqual([0, 1, 2].map(achievementSyncRetryDelay), [0, 250, 1_000]);
  });

  it("retries network, rate-limit, and server failures", () => {
    assert.equal(isRetryableAchievementSyncError({ code: "ETIMEDOUT" }), true);
    assert.equal(
      isRetryableAchievementSyncError({ response: { status: 429 } }),
      true
    );
    assert.equal(
      isRetryableAchievementSyncError({ response: { status: 503 } }),
      true
    );
  });

  it("does not retry permanent client failures", () => {
    assert.equal(
      isRetryableAchievementSyncError({ response: { status: 400 } }),
      false
    );
    assert.equal(
      isRetryableAchievementSyncError({ response: { status: 403 } }),
      false
    );
  });
});
