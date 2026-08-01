import assert from "node:assert/strict";
import test from "node:test";

import {
  CloudSyncOperationGuard,
  getCloudSyncGameKey,
} from "../../src/renderer/src/context/cloud-sync/cloud-sync-operation-guard.ts";

test("switching games invalidates every in-flight operation", () => {
  const guard = new CloudSyncOperationGuard(
    getCloudSyncGameKey("steam", "1145350")
  );
  const preview = guard.begin("preview");
  const upload = guard.begin("upload");

  guard.activateGame(getCloudSyncGameKey("steam", "2334730"));

  assert.equal(guard.isOperationCurrent(preview), false);
  assert.equal(guard.isOperationCurrent(upload), false);
});

test("a newer request supersedes only the same operation kind", () => {
  const guard = new CloudSyncOperationGuard(
    getCloudSyncGameKey("steam", "1145350")
  );
  const firstPreview = guard.begin("preview");
  const artifacts = guard.begin("artifacts");
  const secondPreview = guard.begin("preview");

  assert.equal(guard.isOperationCurrent(firstPreview), false);
  assert.equal(guard.isOperationCurrent(secondPreview), true);
  assert.equal(guard.isOperationCurrent(artifacts), true);
});

test("game subscription tokens cannot update a later game", () => {
  const guard = new CloudSyncOperationGuard(
    getCloudSyncGameKey("steam", "1145350")
  );
  const subscription = guard.captureGame();

  assert.equal(guard.isGameCurrent(subscription), true);

  guard.activateGame(getCloudSyncGameKey("gog", "1145350"));

  assert.equal(guard.isGameCurrent(subscription), false);
});

test("unmount invalidation rejects work from the active game", () => {
  const gameKey = getCloudSyncGameKey("steam", "1145350");
  const guard = new CloudSyncOperationGuard(gameKey);
  const preview = guard.begin("preview");

  guard.invalidateGame(gameKey);

  assert.equal(guard.isOperationCurrent(preview), false);
});
