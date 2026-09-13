import assert from "node:assert/strict";
import test from "node:test";

import {
  observeMissingDownload,
  ownsDownloadSession,
  type DownloadSessionIdentity,
} from "./download-session-ownership";

const session = (
  downloadKey = "steam:2651280",
  generation = 4
): DownloadSessionIdentity => ({ downloadKey, generation });

test("an orphan requires two consecutive observations of one generation", () => {
  const first = observeMissingDownload(null, session());
  assert.equal(first.shouldCancel, false);
  assert.deepEqual(first.candidate, session());

  const second = observeMissingDownload(first.candidate, session());
  assert.equal(second.shouldCancel, true);
  assert.equal(second.candidate, null);
});

test("a same-game restart invalidates the stale orphan observation", () => {
  const oldCandidate = observeMissingDownload(null, session()).candidate;
  const restarted = observeMissingDownload(oldCandidate, session(undefined, 5));

  assert.equal(restarted.shouldCancel, false);
  assert.deepEqual(restarted.candidate, session(undefined, 5));
});

test("session ownership requires both key and generation", () => {
  assert.equal(ownsDownloadSession("steam:2651280", 4, session()), true);
  assert.equal(ownsDownloadSession("steam:2651280", 5, session()), false);
  assert.equal(ownsDownloadSession("steam:999", 4, session()), false);
  assert.equal(ownsDownloadSession(null, 4, session()), false);
});
