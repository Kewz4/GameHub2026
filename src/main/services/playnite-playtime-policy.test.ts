import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decidePlaynitePlaytimeImport,
  PLAYNITE_CATALOGUE_SEARCH_TAKE,
  PLAYNITE_PLAYTIME_REPLACE_THRESHOLD_MS,
  reconcilePlayniteAbsolutePlaytimeAcknowledgement,
} from "./playnite-playtime-policy";

const hour = 60 * 60 * 1000;

describe("Playnite playtime import policy", () => {
  it("searches deeply enough for exact catalogue matches found by the live audit", () => {
    assert.equal(PLAYNITE_CATALOGUE_SEARCH_TAKE, 50);
  });

  it("replaces a missing or sub-five-hour GameHub value", () => {
    assert.deepEqual(decidePlaynitePlaytimeImport(0, 12 * hour), {
      action: "replace",
      previousPlaytimeMs: 0,
      nextPlaytimeMs: 12 * hour,
      deltaMs: 12 * hour,
      reason: "below-five-hours",
    });

    assert.equal(
      decidePlaynitePlaytimeImport(
        PLAYNITE_PLAYTIME_REPLACE_THRESHOLD_MS - 1,
        hour
      ).action,
      "replace"
    );
  });

  it("uses the Playnite value exactly below the threshold, even when lower", () => {
    const decision = decidePlaynitePlaytimeImport(4 * hour, 2 * hour);
    assert.equal(decision.action, "replace");
    assert.equal(decision.nextPlaytimeMs, 2 * hour);
    assert.equal(decision.deltaMs, -2 * hour);
  });

  it("protects GameHub playtime at and above five hours", () => {
    for (const existing of [
      PLAYNITE_PLAYTIME_REPLACE_THRESHOLD_MS,
      100 * hour,
    ]) {
      const decision = decidePlaynitePlaytimeImport(existing, 500 * hour);
      assert.equal(decision.action, "preserve");
      assert.equal(decision.nextPlaytimeMs, existing);
      assert.equal(decision.reason, "protected-existing-playtime");
    }
  });

  it("never replaces a valid value with an empty or invalid import", () => {
    for (const imported of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const decision = decidePlaynitePlaytimeImport(hour, imported);
      assert.equal(decision.action, "preserve");
      assert.equal(decision.nextPlaytimeMs, hour);
      assert.equal(decision.reason, "invalid-import");
    }
  });

  it("clears an acknowledged absolute value only when it is still current", () => {
    assert.deepEqual(
      reconcilePlayniteAbsolutePlaytimeAcknowledgement(
        2 * hour,
        2 * hour,
        2 * hour
      ),
      {
        action: "clear",
        pendingAbsolutePlayTimeInMilliseconds: null,
        unsyncedDeltaPlayTimeInMilliseconds: 0,
      }
    );
  });

  it("requeues playtime accrued while an absolute request is in flight", () => {
    assert.deepEqual(
      reconcilePlayniteAbsolutePlaytimeAcknowledgement(
        2 * hour + 15_000,
        2 * hour,
        2 * hour
      ),
      {
        action: "requeue",
        pendingAbsolutePlayTimeInMilliseconds: 2 * hour + 15_000,
        unsyncedDeltaPlayTimeInMilliseconds: 0,
      }
    );
  });

  it("ignores a stale acknowledgement after a newer import replaced the marker", () => {
    assert.deepEqual(
      reconcilePlayniteAbsolutePlaytimeAcknowledgement(
        3 * hour,
        3 * hour,
        2 * hour
      ),
      { action: "ignore" }
    );
  });
});
