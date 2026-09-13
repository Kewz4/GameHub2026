import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CloudSaveOperationGate } from "./operation-gate";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

describe("cloud save operation gate", () => {
  it("prevents deletion and synchronization from overlapping", async () => {
    const gate = new CloudSaveOperationGate();
    const syncRun = deferred<string>();
    const sync = gate.runSync("game", "sync", () => syncRun.promise);

    await assert.rejects(
      gate.runDeletion("game", "delete", () => Promise.resolve("deleted")),
      /cloud_save_operation_active/
    );

    syncRun.resolve("synced");
    assert.equal(await sync, "synced");

    const deleteRun = deferred<string>();
    const deletion = gate.runDeletion(
      "game",
      "delete",
      () => deleteRun.promise
    );
    assert.equal(gate.isDeletionActive("game"), true);
    await assert.rejects(
      gate.runSync("game", "sync", () => Promise.resolve("synced")),
      /cloud_save_operation_active/
    );

    deleteRun.resolve("deleted");
    assert.equal(await deletion, "deleted");
    assert.equal(gate.isDeletionActive("game"), false);
  });

  it("coalesces duplicate deletions for the same game", async () => {
    const gate = new CloudSaveOperationGate();
    const deleteRun = deferred<string>();
    let runs = 0;

    const first = gate.runDeletion("game", "delete", () => {
      runs += 1;
      return deleteRun.promise;
    });
    const duplicate = gate.runDeletion("game", "delete", () => {
      runs += 1;
      return Promise.resolve("unexpected");
    });

    assert.equal(first, duplicate);
    deleteRun.resolve("deleted");
    assert.equal(await duplicate, "deleted");
    assert.equal(runs, 1);
  });

  it("checks a persistent sync guard inside the operation reservation", async () => {
    const gate = new CloudSaveOperationGate();
    let operationCalled = false;

    await assert.rejects(
      gate.runSync(
        "game",
        "sync",
        async () => {
          operationCalled = true;
          return "synced";
        },
        async () => {
          throw new Error("cloud_save_delete_pending");
        }
      ),
      /cloud_save_delete_pending/
    );

    assert.equal(operationCalled, false);
    assert.equal(
      await gate.runDeletion("game", "delete", () =>
        Promise.resolve("deleted")
      ),
      "deleted"
    );
  });

  it("allows only the owning pre-launch sync and keeps mutations blocked for the session", async () => {
    const gate = new CloudSaveOperationGate();
    const launchRun = deferred<string>();
    const launch = gate.runLaunch("game", async () => {
      gate.reserveLaunchSession("game", "launch-token");
      assert.equal(
        await gate.runSync(
          "game",
          "pre-launch",
          () => Promise.resolve("synced"),
          undefined,
          "launch-token"
        ),
        "synced"
      );
      return launchRun.promise;
    });

    await assert.rejects(
      gate.runSync("game", "manual", () => Promise.resolve("synced")),
      /cloud_save_launch_active/
    );
    await assert.rejects(
      gate.runDeletion("game", "delete", () => Promise.resolve("deleted")),
      /cloud_save_operation_active/
    );
    await assert.rejects(
      gate.runLaunch("game", () => Promise.resolve("duplicate")),
      /cloud_save_launch_active/
    );

    launchRun.resolve("launched");
    assert.equal(await launch, "launched");

    await assert.rejects(
      gate.runSync("game", "manual", () => Promise.resolve("synced")),
      /cloud_save_launch_active/
    );
    await assert.rejects(
      gate.runDeletion("game", "delete", () => Promise.resolve("deleted")),
      /cloud_save_operation_active/
    );
    await assert.rejects(
      gate.runLaunch("game", () => Promise.resolve("duplicate")),
      /cloud_save_launch_active/
    );

    assert.equal(gate.releaseLaunchSession("game", "wrong-token"), false);
    assert.equal(gate.releaseLaunchSession("game", "launch-token"), true);

    const deleteRun = deferred<string>();
    const deletion = gate.runDeletion(
      "game",
      "delete",
      () => deleteRun.promise
    );
    await assert.rejects(
      gate.runLaunch("game", () => Promise.resolve("launched")),
      /cloud_save_delete_active/
    );
    deleteRun.resolve("deleted");
    assert.equal(await deletion, "deleted");
  });

  it("keeps operations for different games independent", async () => {
    const gate = new CloudSaveOperationGate();

    const [first, second] = await Promise.all([
      gate.runDeletion("first", "delete", () => Promise.resolve("first")),
      gate.runSync("second", "sync", () => Promise.resolve("second")),
    ]);

    assert.equal(first, "first");
    assert.equal(second, "second");
  });
});
