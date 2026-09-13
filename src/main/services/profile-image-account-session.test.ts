import assert from "node:assert/strict";
import test from "node:test";
import { ProfileImageAccountSessionFence } from "./profile-image-account-session";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
};

test("an account A mutation cannot write after credential session B starts", async () => {
  const fence = new ProfileImageAccountSessionFence();
  const generation = fence.captureGeneration();
  const scope = fence.createScope("account-a", generation);
  const paused = deferred();
  const writes: string[] = [];

  const mutation = (async () => {
    fence.assertCurrent(scope);
    await paused.promise;
    fence.assertCurrent(scope);
    writes.push(scope.ownerId);
  })();

  fence.invalidate();
  paused.resolve();

  await assert.rejects(mutation, /profile_image_account_session_changed/);
  assert.equal(writes.length, 0);

  const nextGeneration = fence.captureGeneration();
  const nextScope = fence.createScope("account-b", nextGeneration);
  fence.assertCurrent(nextScope);
  writes.push(nextScope.ownerId);
  assert.deepEqual(writes, ["account-b"]);
});
