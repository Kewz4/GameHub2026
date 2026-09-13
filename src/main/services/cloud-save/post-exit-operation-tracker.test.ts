import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CloudSavePostExitOperationTracker,
  runAfterCloudSavePostExitDrain,
} from "./post-exit-operation-tracker.js";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe("Cloud Save V2 post-exit operation drain", () => {
  it("keeps normal quit waiting while an upload is in flight", async () => {
    const tracker = new CloudSavePostExitOperationTracker();
    const upload = deferred();
    tracker.track(upload.promise);

    let drained = false;
    const quitDrain = tracker.drain(1_000).then((result) => {
      drained = true;
      return result;
    });
    await Promise.resolve();
    assert.equal(drained, false);
    assert.equal(tracker.pendingCount, 1);

    upload.resolve();
    assert.deepEqual(await quitDrain, { drained: true, pending: 0 });
  });

  it("does not apply an update until the bounded upload drain settles", async () => {
    const tracker = new CloudSavePostExitOperationTracker();
    const upload = deferred();
    tracker.track(upload.promise);
    const events: string[] = [];

    const apply = runAfterCloudSavePostExitDrain(tracker, 1_000, () => {
      events.push("apply-update");
    });
    await Promise.resolve();
    assert.deepEqual(events, []);

    upload.resolve();
    const outcome = await apply;
    assert.equal(outcome.drain.drained, true);
    assert.deepEqual(events, ["apply-update"]);
  });
});
