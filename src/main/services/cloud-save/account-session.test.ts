import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CloudSaveAccountSessionManager } from "./account-session-manager.js";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
};

describe("Cloud Save account session fence", () => {
  it("aborts a paused A head operation before any B R2, anchor, or path mutation", async () => {
    let activeUser = "account-a";
    const manager = new CloudSaveAccountSessionManager(async () => activeUser);
    const paused = deferred();
    const r2Writes: string[] = [];
    const anchorWrites: string[] = [];
    const customPathWrites: string[] = [];

    const operationA = manager.run(async () => {
      assert.equal(await manager.getUserId(), "account-a");
      await paused.promise;
      manager.assertCurrent();
      const userId = await manager.getUserId();
      r2Writes.push(userId);
      anchorWrites.push(userId);
      customPathWrites.push(userId);
    });

    activeUser = "account-b";
    manager.invalidate();
    paused.resolve();
    await assert.rejects(operationA, /cloud_save_account_session_changed/);
    assert.deepEqual(
      { r2Writes, anchorWrites, customPathWrites },
      { r2Writes: [], anchorWrites: [], customPathWrites: [] }
    );

    await manager.run(async () => {
      manager.assertCurrent();
      const userId = await manager.getUserId();
      r2Writes.push(userId);
      anchorWrites.push(userId);
      customPathWrites.push(userId);
    });
    assert.deepEqual(
      { r2Writes, anchorWrites, customPathWrites },
      {
        r2Writes: ["account-b"],
        anchorWrites: ["account-b"],
        customPathWrites: ["account-b"],
      }
    );
  });

  it("keeps nested operations in the same account-scoped coalescing key", async () => {
    const manager = new CloudSaveAccountSessionManager(async () => "account-a");
    await manager.run(async () => {
      const outer = manager.getScopeKey();
      await manager.run(async () => assert.equal(manager.getScopeKey(), outer));
    });
  });

  it("never coalesces deferred migration work across A to B to A sessions", async () => {
    let activeUser = "account-a";
    const manager = new CloudSaveAccountSessionManager(async () => activeUser);
    const pausedA = deferred();
    const active = new Map<string, Promise<string>>();

    const run = (value: string, pause?: Promise<void>) =>
      manager.run(async () => {
        const key = manager.getScopeKey();
        const existing = active.get(key);
        if (existing) return existing;
        const operation = (async () => {
          await pause;
          manager.assertCurrent();
          return value;
        })();
        active.set(key, operation);
        return operation.finally(() => active.delete(key));
      });

    const originalA = run("old-a", pausedA.promise);
    activeUser = "account-b";
    manager.invalidate();
    assert.equal(await run("b"), "b");

    activeUser = "account-a";
    manager.invalidate();
    assert.equal(await run("new-a"), "new-a");

    pausedA.resolve();
    await assert.rejects(originalA, /cloud_save_account_session_changed/);
  });
});
