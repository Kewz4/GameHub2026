import assert from "node:assert/strict";
import test from "node:test";

import { AppQuitCleanupCoordinator } from "./app-quit-cleanup";

test("normal quit is cancelled synchronously and cleanup is coalesced", async () => {
  const order: string[] = [];
  let releaseCleanup!: () => void;
  const cleanupWait = new Promise<void>((resolve) => {
    releaseCleanup = resolve;
  });
  const coordinator = new AppQuitCleanupCoordinator(
    async () => {
      order.push("cleanup-start");
      await cleanupWait;
      order.push("cleanup-end");
    },
    () => order.push("quit"),
    () => order.push("error")
  );
  const event = { preventDefault: () => order.push("prevent") };

  coordinator.handleBeforeQuit(event);
  coordinator.handleBeforeQuit(event);
  assert.deepEqual(order, ["prevent", "cleanup-start", "prevent"]);

  releaseCleanup();
  await cleanupWait;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, [
    "prevent",
    "cleanup-start",
    "prevent",
    "cleanup-end",
    "quit",
  ]);
});

test("update quit bypasses asynchronous cleanup", () => {
  const order: string[] = [];
  const coordinator = new AppQuitCleanupCoordinator(
    async () => {
      order.push("cleanup");
    },
    () => order.push("quit"),
    () => order.push("error")
  );

  coordinator.handleBeforeQuit(
    { preventDefault: () => order.push("prevent") },
    true
  );
  assert.deepEqual(order, []);
});
