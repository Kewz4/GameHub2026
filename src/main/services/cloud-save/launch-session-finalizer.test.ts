import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CloudSaveLaunchSessionStore } from "./launch-guard.js";
import { finalizeCloudSaveLaunchSession } from "./launch-session-finalizer.js";

describe("cloud save launch session finalizer", () => {
  it("retires a pre-V2 legacy session without running a backend", async () => {
    const store = new CloudSaveLaunchSessionStore();
    const session = store.start("game", "steam", "legacy");
    store.markPending("game", "steam", session.token);
    store.markRunning("game", "steam", session.token);
    let v2Runs = 0;

    const finalized = await finalizeCloudSaveLaunchSession(
      store,
      "game",
      "steam",
      {
        v2: async () => {
          v2Runs += 1;
        },
      },
      session.token
    );

    assert.equal(finalized?.mode, "legacy");
    assert.equal(v2Runs, 0);
    assert.equal(store.get("game", "steam"), null);
  });

  it("coalesces duplicate exits into exactly one backend invocation", async () => {
    const store = new CloudSaveLaunchSessionStore();
    const session = store.start("game", "launchbox", "v2");
    store.markPending("game", "launchbox", session.token);
    let releaseBackend!: () => void;
    const backendPending = new Promise<void>((resolve) => {
      releaseBackend = resolve;
    });
    let v2Runs = 0;
    const backends = {
      v2: async () => {
        v2Runs += 1;
        await backendPending;
      },
    };

    const firstExit = finalizeCloudSaveLaunchSession(
      store,
      "game",
      "launchbox",
      backends,
      session.token
    );
    const duplicateExit = await finalizeCloudSaveLaunchSession(
      store,
      "game",
      "launchbox",
      backends,
      session.token
    );

    assert.equal(duplicateExit, null);
    assert.equal(v2Runs, 1);
    releaseBackend();
    assert.equal((await firstExit)?.token, session.token);
    assert.equal(v2Runs, 1);
    assert.equal(store.get("game", "launchbox"), null);
  });

  it("runs no backend for a disabled launch session", async () => {
    const store = new CloudSaveLaunchSessionStore();
    const session = store.start("game", "custom", "disabled");
    store.markPending("game", "custom", session.token);
    let runs = 0;

    await finalizeCloudSaveLaunchSession(
      store,
      "game",
      "custom",
      {
        v2: async () => {
          runs += 1;
        },
      },
      session.token
    );

    assert.equal(runs, 0);
    assert.equal(store.get("game", "custom"), null);
  });

  it("does not let a late exit consume a newer launch session", async () => {
    const store = new CloudSaveLaunchSessionStore();
    const oldSession = store.start("game", "steam", "disabled");
    store.markPending("game", "steam", oldSession.token);
    await finalizeCloudSaveLaunchSession(
      store,
      "game",
      "steam",
      { v2: async () => undefined },
      oldSession.token
    );

    const newSession = store.start("game", "steam", "v2");
    store.markPending("game", "steam", newSession.token);
    let runs = 0;
    const staleExit = await finalizeCloudSaveLaunchSession(
      store,
      "game",
      "steam",
      {
        v2: async () => {
          runs += 1;
        },
      },
      oldSession.token
    );

    assert.equal(staleExit, null);
    assert.equal(runs, 0);
    assert.equal(store.get("game", "steam")?.token, newSession.token);
    store.abort("game", "steam", newSession.token);
  });
});
