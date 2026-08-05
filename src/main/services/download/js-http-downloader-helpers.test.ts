import assert from "node:assert/strict";
import test from "node:test";
import {
  applySkip,
  resolveResumeAction,
  shouldResetRetryBudget,
} from "./js-http-downloader-helpers";

test("rejects an ignored Range response without scheduling prefix discard", () => {
  const action = resolveResumeAction({
    startByte: 51_765_362_182,
    status: 200,
    partialStart: null,
  });

  assert.equal(action.flags, "a");
  assert.equal(action.skipBytes, 0);
  assert.equal(action.rangeIgnored, true);
  assert.equal(action.rejectReason, "range-ignored");
});

test("accepts an exact 206 resume boundary", () => {
  assert.deepEqual(
    resolveResumeAction({
      startByte: 10_000,
      status: 206,
      partialStart: 10_000,
    }),
    {
      flags: "a",
      skipBytes: 0,
      rangeIgnored: false,
      rejectReason: null,
    }
  );
});

test("never truncates a partial for missing or unsafe Content-Range", () => {
  for (const input of [
    {
      startByte: 10_000,
      status: 206,
      partialStart: null,
      reason: "missing-content-range",
    },
    {
      startByte: 10_000,
      status: 206,
      partialStart: 20_000,
      reason: "range-gap",
    },
    {
      startByte: 2_000_000,
      status: 206,
      partialStart: 1,
      reason: "excessive-overlap",
    },
  ] as const) {
    const action = resolveResumeAction({
      startByte: input.startByte,
      status: input.status,
      partialStart: input.partialStart,
    });
    assert.equal(action.flags, "a");
    assert.equal(action.skipBytes, 0);
    assert.equal(action.rejectReason, input.reason);
  }
});

test("allows only a small 206 overlap", () => {
  const action = resolveResumeAction({
    startByte: 1_000_000,
    status: 206,
    partialStart: 999_000,
  });
  assert.equal(action.rejectReason, null);
  assert.equal(action.skipBytes, 1_000);
  assert.deepEqual(applySkip(1_000, 1_500), {
    newRemainingToSkip: 0,
    writeOffset: 1_000,
    shouldWrite: true,
  });
});

test("discarded network bytes cannot reset the retry budget", () => {
  assert.equal(shouldResetRetryBudget(0, 0, 16 * 1024 * 1024, 50), false);
  assert.equal(
    shouldResetRetryBudget(16 * 1024 * 1024, 0, 16 * 1024 * 1024, 50),
    true
  );
});
