import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  OverlayQaSupervisedTargetIdentity,
  OverlaySupervisedQaRuntime,
} from "./overlay-supervised-launch-contract";
import { OverlayQaAuthorizationRegistry } from "./overlay-qa-authorization";

const executable = String.raw`C:\Games\Spider Man 2\Spider-Man2.exe`;
const firstSession = "a".repeat(32);
const secondSession = "b".repeat(32);

const allowedRuntime = (): OverlaySupervisedQaRuntime => ({
  platform: "win32",
  isPackaged: false,
  environment: {
    GAMEHUB_READ_ONLY_VISUAL_QA: "true",
    GAMEHUB_OVERLAY_SUPERVISED_LAUNCH_QA: "true",
  },
});

const identity = (
  overrides: Partial<OverlayQaSupervisedTargetIdentity> = {}
): OverlayQaSupervisedTargetIdentity => ({
  sessionId: firstSession,
  pid: 42,
  creationTicks: "133700000000000000",
  canonicalExecutablePath: executable,
  ...overrides,
});

describe("overlay QA authorization registry", () => {
  it("requires the one-shot suspended to prepared to resumed to interactive sequence", () => {
    const registry = new OverlayQaAuthorizationRegistry(allowedRuntime);
    const target = identity();

    assert.equal(registry.beginSuspended(target), true);
    assert.equal(registry.canPrepare(target), true);
    assert.equal(registry.canInteract(target), false);
    assert.equal(registry.markResumed(target), false, "cannot skip prepared");

    assert.equal(registry.markPrepared(target), true);
    assert.equal(registry.markPrepared(target), false, "prepare is one-shot");
    assert.equal(registry.canPrepare(target), false);
    assert.equal(registry.markInteractive(target), false, "cannot skip resume");

    assert.equal(registry.markResumed(target), true);
    assert.equal(registry.markResumed(target), false, "resume is one-shot");
    assert.equal(registry.canInteract(target), false);

    assert.equal(registry.markInteractive(target), true);
    assert.equal(registry.markInteractive(target), false, "ready is one-shot");
    assert.equal(registry.canInteract(target), true);
    assert.equal(registry.getState()?.phase, "interactive");
  });

  it("allows only one active session", () => {
    const registry = new OverlayQaAuthorizationRegistry(allowedRuntime);
    assert.equal(registry.beginSuspended(identity()), true);
    assert.equal(
      registry.beginSuspended(
        identity({ sessionId: secondSession, pid: 43, creationTicks: "2" })
      ),
      false
    );
    assert.equal(registry.getState()?.sessionId, firstSession);
  });

  it("fences every transition by session, PID, creation time, and canonical path", () => {
    const registry = new OverlayQaAuthorizationRegistry(allowedRuntime);
    const target = identity();
    assert.equal(registry.beginSuspended(target), true);

    for (const stale of [
      identity({ sessionId: secondSession }),
      identity({ pid: 43 }),
      identity({ creationTicks: "133700000000000001" }),
      identity({
        canonicalExecutablePath: String.raw`C:\Games\Other\Other.exe`,
      }),
    ]) {
      assert.equal(registry.isCurrent(stale), false);
      assert.equal(registry.canPrepare(stale), false);
      assert.equal(registry.markPrepared(stale), false);
    }

    assert.equal(registry.getState()?.phase, "suspended");
    assert.equal(
      registry.markPrepared(
        identity({ canonicalExecutablePath: executable.toUpperCase() })
      ),
      false,
      "native transitions must echo the exact canonical path string"
    );
    assert.equal(registry.markPrepared(target), true);
  });

  it("does not use Unicode or linguistic equivalence for canonical identity", () => {
    for (const [canonicalSegment, aliasSegment] of [
      ["ﬀ", "ff"],
      ["K", "k"],
    ]) {
      const registry = new OverlayQaAuthorizationRegistry(allowedRuntime);
      const target = identity({
        canonicalExecutablePath: `C:\\Games\\${canonicalSegment}\\Game.exe`,
      });
      assert.equal(registry.beginSuspended(target), true);
      assert.equal(
        registry.isCurrent(
          identity({
            canonicalExecutablePath: `C:\\Games\\${aliasSegment}\\Game.exe`,
          })
        ),
        false
      );
      assert.equal(registry.isCurrent(target), true);
    }
  });

  it("rejects malformed native identities before consuming a session", () => {
    const invalidTargets = [
      identity({ sessionId: "short" }),
      identity({ pid: 4 }),
      identity({ pid: 4.2 }),
      identity({ creationTicks: "0" }),
      identity({ creationTicks: "not-a-number" }),
      identity({ creationTicks: "18446744073709551616" }),
      identity({ canonicalExecutablePath: "steam://run/2651280" }),
      identity({
        canonicalExecutablePath: String.raw`\\server\games\Game.exe`,
      }),
    ];

    for (const invalid of invalidTargets) {
      const registry = new OverlayQaAuthorizationRegistry(allowedRuntime);
      assert.equal(registry.beginSuspended(invalid), false);
      assert.equal(registry.getState(), null);
      assert.equal(registry.beginSuspended(identity()), true);
    }
  });

  it("fails closed when any runtime gate disappears", () => {
    let runtime = allowedRuntime();
    const registry = new OverlayQaAuthorizationRegistry(() => runtime);
    const target = identity();
    assert.equal(registry.beginSuspended(target), true);

    runtime = {
      ...runtime,
      environment: { GAMEHUB_READ_ONLY_VISUAL_QA: "true" },
    };
    assert.equal(registry.canPrepare(target), false);
    assert.equal(registry.getState(), null, "the active grant is revoked");

    runtime = allowedRuntime();
    assert.equal(
      registry.beginSuspended(target),
      false,
      "restoring the environment cannot replay a consumed session"
    );
  });

  it("fails closed when the runtime provider throws", () => {
    const registry = new OverlayQaAuthorizationRegistry(() => {
      throw new Error("runtime unavailable");
    });
    assert.equal(registry.beginSuspended(identity()), false);
    assert.equal(registry.getState(), null);
  });

  it("requires exact revocation and prevents revoked-session replay", () => {
    const registry = new OverlayQaAuthorizationRegistry(allowedRuntime);
    const target = identity();
    assert.equal(registry.beginSuspended(target), true);

    assert.equal(registry.revoke(identity({ pid: 99 })), false);
    assert.equal(registry.isCurrent(target), true);
    assert.equal(registry.revoke(target), true);
    assert.equal(registry.isCurrent(target), false);
    assert.equal(registry.revoke(target), false);
    assert.equal(registry.beginSuspended(target), false);

    const next = identity({
      sessionId: secondSession,
      pid: 43,
      creationTicks: "133700000000000001",
    });
    assert.equal(registry.beginSuspended(next), true);
    assert.equal(registry.revokeCurrent(), true);
    assert.equal(registry.revokeCurrent(), false);
  });

  it("returns a defensive immutable state snapshot", () => {
    const registry = new OverlayQaAuthorizationRegistry(allowedRuntime);
    assert.equal(registry.beginSuspended(identity()), true);
    const state = registry.getState();
    assert.ok(state);
    assert.equal(Object.isFrozen(state), true);
    assert.throws(() => {
      (state as { pid: number }).pid = 99;
    });
    assert.equal(registry.getState()?.pid, 42);
  });
});
