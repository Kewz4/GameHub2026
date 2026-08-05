import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canCreateCloudSaveUploadGuard,
  canUploadCloudSaveAfterLaunch,
  CloudSaveLaunchSessionStore,
  consumeCloudSaveLaunchGuard,
  setCloudSaveLaunchGuard,
  shouldBlockGameLaunchForCloudSave,
} from "./launch-guard";

describe("cloud save launch guard", () => {
  it("is single-use and scoped by game", () => {
    setCloudSaveLaunchGuard("1091500", "steam", {
      environmentId: "environment-a",
      baseRemoteHash: "base",
      uploadAllowed: true,
      createdAt: "2026-07-20T00:00:00.000Z",
    });

    assert.equal(consumeCloudSaveLaunchGuard("other", "steam"), null);
    assert.equal(
      consumeCloudSaveLaunchGuard("1091500", "steam")?.environmentId,
      "environment-a"
    );
    assert.equal(consumeCloudSaveLaunchGuard("1091500", "steam"), null);
  });

  it("rejects double launch without replacing the first session", () => {
    const reservations = new Map<string, string>();
    const store = new CloudSaveLaunchSessionStore(
      (key, token) => reservations.set(key, token),
      (key, token) => {
        if (reservations.get(key) === token) reservations.delete(key);
      }
    );
    const first = store.start("game", "gog", "legacy");

    assert.throws(
      () => store.start("game", "gog", "v2"),
      /cloud_save_launch_active/
    );
    assert.equal(store.get("game", "gog")?.token, first.token);
    assert.equal(store.get("game", "gog")?.mode, "legacy");

    assert.equal(store.abort("game", "gog", "wrong-token"), false);
    assert.equal(store.get("game", "gog")?.token, first.token);
    assert.equal(store.abort("game", "gog", first.token), true);
    assert.equal(store.get("game", "gog"), null);
    assert.equal(reservations.size, 0);
  });

  it("binds environment state to one exactly-once finalization claim", () => {
    const store = new CloudSaveLaunchSessionStore();
    const session = store.start("game", "epic", "v2");
    store.update("game", "epic", session.token, {
      environmentId: "environment-a",
      baseRemoteHash: "base-a",
      uploadAllowed: true,
    });
    store.markPending("game", "epic", session.token);
    store.markRunning("game", "epic", session.token);

    assert.equal(store.claimFinalization("game", "epic", "stale-token"), null);
    const claimed = store.claimFinalization("game", "epic", session.token);
    assert.equal(claimed?.phase, "finalizing");
    assert.equal(claimed?.environmentId, "environment-a");
    assert.equal(claimed?.baseRemoteHash, "base-a");
    assert.equal(store.claimFinalization("game", "epic"), null);
    assert.equal(store.complete("game", "epic", "wrong-token"), false);
    assert.equal(store.complete("game", "epic", session.token), true);
    assert.equal(store.get("game", "epic"), null);
  });

  it("blocks failed pre-launch and environment changes", () => {
    const safeGuard = {
      environmentId: "environment-a",
      baseRemoteHash: null,
      uploadAllowed: true,
      createdAt: "2026-07-20T00:00:00.000Z",
    };

    assert.equal(
      canUploadCloudSaveAfterLaunch(safeGuard, "environment-a"),
      true
    );
    assert.equal(
      canUploadCloudSaveAfterLaunch(safeGuard, "environment-b"),
      false
    );
    assert.equal(
      canUploadCloudSaveAfterLaunch(
        { ...safeGuard, uploadAllowed: false },
        "environment-a"
      ),
      false
    );
    assert.equal(canUploadCloudSaveAfterLaunch(null, "environment-a"), false);
  });

  it("creates an upload guard only from the matching pre-launch result", () => {
    const result = {
      trigger: "pre-launch" as const,
      action: "none" as const,
      initialState: "synced" as const,
      finalState: "synced" as const,
      environmentId: "environment-a",
    };

    assert.equal(
      canCreateCloudSaveUploadGuard(true, "environment-a", result),
      true
    );
    assert.equal(
      canCreateCloudSaveUploadGuard(true, "environment-b", result),
      false
    );
    assert.equal(
      canCreateCloudSaveUploadGuard(true, "environment-a", {
        ...result,
        trigger: "environment-changed",
      }),
      false
    );
    assert.equal(
      canCreateCloudSaveUploadGuard(false, "environment-a", result),
      false
    );
    assert.equal(
      canCreateCloudSaveUploadGuard(true, "environment-a", {
        ...result,
        action: "restore",
        initialState: "remote-ahead",
        finalState: "partial",
      }),
      false
    );
  });

  it("blocks launch only for a pre-launch cloud save conflict", () => {
    const conflict = {
      trigger: "pre-launch" as const,
      action: "conflict" as const,
      initialState: "conflict" as const,
      finalState: "conflict" as const,
    };

    assert.equal(shouldBlockGameLaunchForCloudSave(conflict), true);
    assert.equal(
      shouldBlockGameLaunchForCloudSave({
        ...conflict,
        trigger: "environment-changed",
      }),
      false
    );
    assert.equal(
      shouldBlockGameLaunchForCloudSave({
        ...conflict,
        action: "none",
        initialState: "synced",
        finalState: "synced",
      }),
      false
    );
    assert.equal(shouldBlockGameLaunchForCloudSave(null), false);
    assert.equal(shouldBlockGameLaunchForCloudSave(null, true), true);
  });
});
