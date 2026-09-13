import assert from "node:assert/strict";
import test from "node:test";

import { DownloadRecordMutationCoordinator } from "./download-record-mutation-coordinator";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

for (const runtime of ["js", "python"] as const) {
  test(`same-key ${runtime} replacement cannot be overwritten by the old runtime`, async () => {
    const coordinator = new DownloadRecordMutationCoordinator();
    const oldPollEntered = deferred();
    const releaseOldPoll = deferred();
    const operations: string[] = [];
    let generation = 1;
    let persisted = "old-active";

    const oldPoll = coordinator.runOwned(
      () => generation === 1,
      async () => {
        operations.push(`${runtime}:old-poll-entered`);
        oldPollEntered.resolve();
        await releaseOldPoll.promise;
        persisted = "old-progress";
        operations.push(`${runtime}:old-poll-written`);
      }
    );

    await oldPollEntered.promise;

    // This is the ordering used by addGameToQueue/startGameDownload: cancel
    // and invalidate the owner before the queued replacement is persisted.
    const replacement = coordinator.replace(
      async () => {
        generation += 1;
        operations.push(`${runtime}:cancelled`);
      },
      async () => {
        persisted = "replacement-queued";
        operations.push(`${runtime}:replacement-written`);
      }
    );

    releaseOldPoll.resolve();
    await Promise.all([oldPoll, replacement]);

    // A callback that was already queued behind replacement re-checks the old
    // generation when it reaches the mutation boundary and becomes a no-op.
    const staleResult = await coordinator.runOwned(
      () => generation === 1,
      async () => {
        persisted = "late-old-progress";
      }
    );

    assert.equal(staleResult, null);
    assert.equal(persisted, "replacement-queued");
    assert.deepEqual(operations, [
      `${runtime}:old-poll-entered`,
      `${runtime}:old-poll-written`,
      `${runtime}:cancelled`,
      `${runtime}:replacement-written`,
    ]);
  });
}
