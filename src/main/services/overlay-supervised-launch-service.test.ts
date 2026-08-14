import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  OverlayQaSupervisedTargetIdentity,
  OverlaySupervisedLaunchPlan,
  OverlaySupervisedQaRuntime,
} from "./overlay-supervised-launch-contract";
import { OverlayQaAuthorizationRegistry } from "./overlay-qa-authorization";
import { evaluateOverlaySupervisedLaunchPolicy } from "./overlay-supervised-launch-policy";
import {
  OVERLAY_SUPERVISOR_DECISION_TIMEOUT_MS,
  OVERLAY_SUPERVISOR_HELPER_ARGS,
  parseOverlaySupervisorCommandLine,
} from "./overlay-supervised-launch-protocol";
import {
  OverlaySupervisedLaunchService,
  OverlaySupervisedLaunchServiceError,
  type OverlaySupervisorHelperAdapter,
  type OverlaySupervisorHelperExit,
  type OverlaySupervisorTimerAdapter,
} from "./overlay-supervised-launch-service";

const sessionId = "supervised_qa_session_000000000001";
const executable = String.raw`C:\Games\Spider Man 2\Spider-Man2.exe`;
const runtime: OverlaySupervisedQaRuntime = {
  platform: "win32",
  isPackaged: false,
  environment: {
    GAMEHUB_READ_ONLY_VISUAL_QA: "true",
    GAMEHUB_OVERLAY_SUPERVISED_LAUNCH_QA: "true",
  },
};

const identity: OverlayQaSupervisedTargetIdentity = {
  sessionId,
  pid: 42,
  creationTicks: "133700000000000000",
  canonicalExecutablePath: executable,
};

const makePlan = (id = sessionId): OverlaySupervisedLaunchPlan => {
  const result = evaluateOverlaySupervisedLaunchPolicy({
    runtime,
    sessionId: id,
    game: { libraryOrigin: "custom", executablePath: executable },
    executablePath: executable,
    canonicalExecutablePath: executable,
    resolvedCommand: { command: executable, args: ["-windowed"], env: {} },
    workingDirectory: String.raw`C:\Games\Spider Man 2`,
  });
  assert.equal(result.allowed, true);
  return result.plan;
};

type VoidListener = () => void;

class FakeHelper implements OverlaySupervisorHelperAdapter {
  public readonly writes: string[] = [];
  public terminated = false;
  public writeResult: boolean | void | Promise<boolean | void> = true;
  private readonly stdoutData = new Set<(chunk: Uint8Array) => void>();
  private readonly stdoutEnd = new Set<VoidListener>();
  private readonly stdinError = new Set<(error: Error) => void>();
  private readonly stdinEof = new Set<VoidListener>();
  private readonly exits = new Set<
    (exit: OverlaySupervisorHelperExit) => void
  >();

  public writeStdin(line: string) {
    this.writes.push(line);
    return this.writeResult;
  }

  public onStdoutData(listener: (chunk: Uint8Array) => void) {
    this.stdoutData.add(listener);
    return () => this.stdoutData.delete(listener);
  }

  public onStdoutEnd(listener: VoidListener) {
    this.stdoutEnd.add(listener);
    return () => this.stdoutEnd.delete(listener);
  }

  public onStdinError(listener: (error: Error) => void) {
    this.stdinError.add(listener);
    return () => this.stdinError.delete(listener);
  }

  public onStdinEof(listener: VoidListener) {
    this.stdinEof.add(listener);
    return () => this.stdinEof.delete(listener);
  }

  public onExit(listener: (exit: OverlaySupervisorHelperExit) => void) {
    this.exits.add(listener);
    return () => this.exits.delete(listener);
  }

  public terminate() {
    this.terminated = true;
  }

  public emitEvent(
    type: "suspended" | "resumed" | "aborted",
    target: OverlayQaSupervisedTargetIdentity = identity
  ) {
    this.emitData(`${JSON.stringify({ version: 1, type, ...target })}\n`);
  }

  public emitData(chunk: string | Uint8Array) {
    const bytes =
      typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
    for (const listener of [...this.stdoutData]) listener(bytes);
  }

  public emitStdoutEnd() {
    for (const listener of [...this.stdoutEnd]) listener();
  }

  public emitStdinError(error = new Error("broken pipe")) {
    for (const listener of [...this.stdinError]) listener(error);
  }

  public emitStdinEof() {
    for (const listener of [...this.stdinEof]) listener();
  }

  public emitExit(
    code: number | null = 0,
    signal: string | null = null,
    drainStdout = true
  ) {
    for (const listener of [...this.exits]) listener({ code, signal });
    if (drainStdout) this.emitStdoutEnd();
  }
}

class FakeTimers implements OverlaySupervisorTimerAdapter {
  private nextId = 1;
  private readonly tasks = new Map<number, () => void>();

  public set(callback: () => void) {
    const id = this.nextId++;
    this.tasks.set(id, callback);
    return id;
  }

  public clear(handle: unknown) {
    this.tasks.delete(handle as number);
  }

  public fire() {
    const first = [...this.tasks.entries()].sort(
      ([left], [right]) => left - right
    )[0];
    assert.ok(first, "expected an armed timeout");
    this.tasks.delete(first[0]);
    first[1]();
  }
}

const flushWrites = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const assertServiceError = (
  error: unknown,
  code: OverlaySupervisedLaunchServiceError["code"]
) => {
  assert.ok(error instanceof OverlaySupervisedLaunchServiceError);
  assert.equal(error.code, code);
  return true;
};

const makeFixture = (
  options: {
    helper?: FakeHelper;
    registry?: OverlayQaAuthorizationRegistry;
    allowed?: boolean;
  } = {}
) => {
  const helper = options.helper ?? new FakeHelper();
  const timer = new FakeTimers();
  const args: readonly string[][] = [];
  const registry =
    options.registry ??
    new OverlayQaAuthorizationRegistry(() =>
      options.allowed === false ? { ...runtime, isPackaged: true } : runtime
    );
  const service = new OverlaySupervisedLaunchService({
    helperFactory: {
      start(helperArgs) {
        (args as string[][]).push([...helperArgs]);
        return helper;
      },
    },
    authorizationRegistry: registry,
    targetVerifier: {
      verify(plan) {
        return {
          canonicalExecutablePath: plan.canonicalExecutablePath,
          canonicalGameRoot: String.raw`C:\Games\Spider Man 2`,
          volumeSerial: "A1",
          fileId: "B2",
        };
      },
    },
    timers: timer,
    timeouts: {
      suspendedMs: 10,
      preparedMs: 11,
      commitMs: 12,
      abortMs: 13,
      exitMs: 14,
    },
  });
  return { service, helper, timer, registry, args };
};

const suspend = async (fixture: ReturnType<typeof makeFixture>) => {
  const pending = fixture.service.start(makePlan());
  await flushWrites();
  fixture.helper.emitEvent("suspended");
  return pending;
};

describe("overlay supervised launch service", () => {
  it("completes the exact suspended, prepared, resumed, interactive sequence", async () => {
    const fixture = makeFixture();
    const pendingStart = fixture.service.start(makePlan());
    await flushWrites();

    assert.deepEqual(fixture.args, [[...OVERLAY_SUPERVISOR_HELPER_ARGS]]);
    assert.equal(
      (fixture.args[0] as readonly string[]).includes(executable),
      false
    );
    assert.equal(
      (fixture.args[0] as readonly string[]).includes(sessionId),
      false
    );
    assert.deepEqual(
      parseOverlaySupervisorCommandLine(fixture.helper.writes[0].trimEnd()),
      {
        version: 1,
        type: "launch",
        sessionId,
        executablePath: executable,
        args: ["-windowed"],
        workingDirectory: String.raw`C:\Games\Spider Man 2`,
        decisionTimeoutMs: OVERLAY_SUPERVISOR_DECISION_TIMEOUT_MS,
      }
    );

    fixture.helper.emitEvent("suspended");
    const target = await pendingStart;
    assert.deepEqual(target, identity);
    assert.equal(fixture.registry.canPrepare(target), true);

    fixture.service.markPrepared(target);
    const pendingCommit = fixture.service.commit(target);
    await flushWrites();
    assert.equal(
      parseOverlaySupervisorCommandLine(fixture.helper.writes[1].trimEnd())
        .type,
      "commit"
    );

    fixture.helper.emitEvent("resumed");
    assert.equal(fixture.service.getState(), "resume-exit");
    fixture.helper.emitExit();
    await pendingCommit;
    assert.equal(fixture.service.getState(), "resumed");

    fixture.service.markInteractive(target);
    assert.equal(fixture.service.getState(), "interactive");
    assert.equal(fixture.registry.canInteract(target), true);
  });

  it("fails before helper creation when either QA runtime gate is unavailable", async () => {
    const fixture = makeFixture({ allowed: false });
    await assert.rejects(fixture.service.start(makePlan()), (error) =>
      assertServiceError(error, "qa-disabled")
    );
    assert.deepEqual(fixture.args, []);
  });

  it("requires independent native game-root and file-identity verification", async () => {
    for (const trustedTarget of [
      null,
      {
        canonicalExecutablePath: executable,
        canonicalGameRoot: String.raw`C:\Windows\System32`,
        volumeSerial: "A1",
        fileId: "B2",
      },
      {
        canonicalExecutablePath: executable,
        canonicalGameRoot: String.raw`C:\Games\Other`,
        volumeSerial: "A1",
        fileId: "B2",
      },
      {
        canonicalExecutablePath: executable,
        canonicalGameRoot: String.raw`C:\Games\Spider Man 2`,
        volumeSerial: "",
        fileId: "B2",
      },
    ]) {
      const helper = new FakeHelper();
      const registry = new OverlayQaAuthorizationRegistry(() => runtime);
      let helperStarts = 0;
      const service = new OverlaySupervisedLaunchService({
        helperFactory: {
          start() {
            helperStarts += 1;
            return helper;
          },
        },
        authorizationRegistry: registry,
        targetVerifier: { verify: () => trustedTarget },
      });
      await assert.rejects(service.start(makePlan()), (error) =>
        assertServiceError(error, "invalid-plan")
      );
      assert.equal(helperStarts, 0);
    }
  });

  it("rejects timeout configurations without a strict native margin", () => {
    const fixture = makeFixture();
    assert.throws(
      () =>
        new OverlaySupervisedLaunchService({
          helperFactory: { start: () => fixture.helper },
          authorizationRegistry: fixture.registry,
          targetVerifier: {
            verify: (plan) => ({
              canonicalExecutablePath: plan.canonicalExecutablePath,
              canonicalGameRoot: String.raw`C:\Games\Spider Man 2`,
              volumeSerial: "A1",
              fileId: "B2",
            }),
          },
          timeouts: { preparedMs: 5_001, commitMs: 5_000 },
        }),
      (error) => assertServiceError(error, "invalid-plan")
    );
  });

  it("allows only one session per service and keeps the active attempt intact", async () => {
    const fixture = makeFixture();
    const first = fixture.service.start(makePlan());
    await assert.rejects(
      fixture.service.start(makePlan("another_supervised_qa_session_00001")),
      (error) => assertServiceError(error, "busy")
    );
    fixture.helper.emitEvent("suspended");
    assert.deepEqual(await first, identity);
    assert.equal(fixture.service.getState(), "suspended");
  });

  it("rejects events that are duplicated, unknown, or out of order", async () => {
    for (const payload of [
      `${JSON.stringify({ version: 1, type: "ready", ...identity })}\n`,
      `{"version":1,"type":"suspended","type":"resumed","sessionId":"${sessionId}","pid":42,"creationTicks":"1","canonicalExecutablePath":"C:\\\\Games\\\\Game.exe"}\n`,
      `${JSON.stringify({ version: 1, type: "resumed", ...identity })}\n`,
    ]) {
      const fixture = makeFixture();
      const pending = fixture.service.start(makePlan());
      fixture.helper.emitData(payload);
      await assert.rejects(pending, (error) =>
        assertServiceError(
          error,
          payload.includes('"ready"') ||
            payload.includes('"type":"suspended","type"')
            ? "protocol"
            : "out-of-order"
        )
      );
      assert.equal(fixture.helper.terminated, true);
      assert.equal(fixture.registry.getState(), null);
    }
  });

  it("rejects mismatched session/path and malformed PID/FILETIME identities", async () => {
    const targets: Array<OverlayQaSupervisedTargetIdentity> = [
      { ...identity, sessionId: "different_supervised_session_0000001" },
      {
        ...identity,
        canonicalExecutablePath: String.raw`C:\Games\Other\Game.exe`,
      },
      { ...identity, pid: 4 },
      { ...identity, creationTicks: "0" },
    ];
    for (const target of targets) {
      const fixture = makeFixture();
      const pending = fixture.service.start(makePlan());
      fixture.helper.emitEvent("suspended", target);
      await assert.rejects(pending, (error) =>
        assertServiceError(
          error,
          target.pid === 4 || target.creationTicks === "0"
            ? "protocol"
            : "identity-mismatch"
        )
      );
      assert.equal(fixture.helper.terminated, true);
    }
  });

  it("fails closed on stale identities and external authorization revocation", async () => {
    for (const stale of [
      { ...identity, pid: 43 },
      { ...identity, creationTicks: "133700000000000001" },
      {
        ...identity,
        canonicalExecutablePath: String.raw`C:\Games\Other\Game.exe`,
      },
    ]) {
      const fixture = makeFixture();
      await suspend(fixture);
      assert.throws(
        () => fixture.service.markPrepared(stale),
        (error) => assertServiceError(error, "identity-mismatch")
      );
      assert.equal(fixture.registry.getState(), null);
    }

    const fixture = makeFixture();
    const target = await suspend(fixture);
    assert.equal(fixture.registry.revoke(target), true);
    assert.throws(
      () => fixture.service.markPrepared(target),
      (error) => assertServiceError(error, "authorization-revoked")
    );
    assert.equal(fixture.helper.terminated, true);
  });

  it("rejects a changed identity in the resumed event", async () => {
    const fixture = makeFixture();
    const target = await suspend(fixture);
    fixture.service.markPrepared(target);
    const pendingCommit = fixture.service.commit(target);
    fixture.helper.emitEvent("resumed", { ...target, pid: target.pid + 1 });
    await assert.rejects(pendingCommit, (error) =>
      assertServiceError(error, "launch-outcome-unknown")
    );
    assert.equal(fixture.service.getState(), "launch-outcome-unknown");
    assert.equal(fixture.registry.getState(), null);
  });

  it("requires exact canonical path echo without case or Unicode aliases", async () => {
    for (const canonicalExecutablePath of [
      executable.toUpperCase(),
      executable.replace("Spider Man 2", "K"),
      executable.replace("Spider Man 2", "ﬀ"),
    ]) {
      const fixture = makeFixture();
      const pending = fixture.service.start(makePlan());
      fixture.helper.emitEvent("suspended", {
        ...identity,
        canonicalExecutablePath,
      });
      await assert.rejects(pending, (error) =>
        assertServiceError(error, "identity-mismatch")
      );
      assert.equal(fixture.registry.getState(), null);
    }
  });

  it("handles an explicit abort and waits for a clean helper exit", async () => {
    const fixture = makeFixture();
    const target = await suspend(fixture);
    const pendingAbort = fixture.service.abort(target, "qa-preparation-failed");
    await flushWrites();
    assert.deepEqual(
      parseOverlaySupervisorCommandLine(fixture.helper.writes[1].trimEnd()),
      {
        version: 1,
        type: "abort",
        ...identity,
        reason: "qa-preparation-failed",
      }
    );
    assert.equal(fixture.registry.getState(), null);

    fixture.helper.emitEvent("aborted");
    fixture.helper.emitExit();
    await pendingAbort;
    assert.equal(fixture.service.getState(), "aborted");
  });

  it("accepts stdout EOF only after the resume/abort acknowledgement", async () => {
    for (const outcome of ["resume", "abort"] as const) {
      const fixture = makeFixture();
      const target = await suspend(fixture);
      if (outcome === "resume") {
        fixture.service.markPrepared(target);
        const pending = fixture.service.commit(target);
        fixture.helper.emitEvent("resumed");
        fixture.helper.emitStdoutEnd();
        assert.equal(fixture.service.getState(), "resume-exit");
        fixture.helper.emitExit();
        await pending;
        assert.equal(fixture.service.getState(), "resumed");
      } else {
        const pending = fixture.service.abort(target, "expected-eof-test");
        fixture.helper.emitEvent("aborted");
        fixture.helper.emitStdoutEnd();
        assert.equal(fixture.service.getState(), "abort-exit");
        fixture.helper.emitExit();
        await pending;
        assert.equal(fixture.service.getState(), "aborted");
      }
    }
  });

  it("rejects a clean exit when stdout has a truncated trailing frame", async () => {
    const fixture = makeFixture();
    const target = await suspend(fixture);
    fixture.service.markPrepared(target);
    const pending = fixture.service.commit(target);
    fixture.helper.emitEvent("resumed");
    fixture.helper.emitData('{"version":1');
    fixture.helper.emitExit(0, null, false);
    assert.equal(fixture.service.getState(), "resume-exit");
    fixture.helper.emitStdoutEnd();
    await assert.rejects(pending, (error) =>
      assertServiceError(error, "launch-outcome-unknown")
    );
    assert.equal(fixture.service.getState(), "launch-outcome-unknown");
    assert.equal(fixture.registry.getState(), null);
    assert.equal(fixture.helper.terminated, true);
  });

  it("waits for drained stdout when exit precedes buffered output", async () => {
    const fixture = makeFixture();
    const target = await suspend(fixture);
    fixture.service.markPrepared(target);
    const pending = fixture.service.commit(target);
    fixture.helper.emitExit(0, null, false);
    assert.equal(fixture.service.getState(), "commit-sent");
    fixture.helper.emitEvent("resumed");
    assert.equal(fixture.service.getState(), "resume-exit");
    fixture.helper.emitStdoutEnd();
    await pending;
    assert.equal(fixture.service.getState(), "resumed");
  });

  it("rejects invalid UTF-8 bytes from the helper adapter", async () => {
    const fixture = makeFixture();
    const pending = fixture.service.start(makePlan());
    fixture.helper.emitData(Uint8Array.from([0xc3, 0x28]));
    await assert.rejects(pending, (error) =>
      assertServiceError(error, "protocol")
    );
    assert.equal(fixture.helper.terminated, true);
  });

  it("ignores a late stdin rejection after a clean committed helper exit", async () => {
    let rejectLaunchWrite!: (error: Error) => void;
    const helper = new FakeHelper();
    helper.writeResult = new Promise((_resolve, reject) => {
      rejectLaunchWrite = reject;
    });
    const fixture = makeFixture({ helper });
    const pendingStart = fixture.service.start(makePlan());
    await flushWrites();
    fixture.helper.emitEvent("suspended");
    const target = await pendingStart;

    helper.writeResult = true;
    fixture.service.markPrepared(target);
    const pendingCommit = fixture.service.commit(target);
    await flushWrites();
    fixture.helper.emitEvent("resumed");
    fixture.helper.emitExit();
    await pendingCommit;

    rejectLaunchWrite(new Error("late overlapped write completion"));
    await flushWrites();
    assert.equal(fixture.service.getState(), "resumed");
    assert.equal(fixture.registry.getState()?.phase, "resumed");
  });

  it("bounds suspended, prepared, commit, abort, and exit phases", async () => {
    {
      const fixture = makeFixture();
      const pending = fixture.service.start(makePlan());
      fixture.timer.fire();
      await assert.rejects(pending, (error) =>
        assertServiceError(error, "timeout")
      );
    }
    {
      const fixture = makeFixture();
      await suspend(fixture);
      fixture.timer.fire();
      assert.equal(fixture.service.getLastError()?.code, "timeout");
      assert.equal(fixture.registry.getState(), null);
    }
    {
      const fixture = makeFixture();
      const target = await suspend(fixture);
      fixture.service.markPrepared(target);
      fixture.timer.fire();
      assert.equal(fixture.service.getLastError()?.code, "timeout");
    }
    {
      const fixture = makeFixture();
      const target = await suspend(fixture);
      fixture.service.markPrepared(target);
      const pending = fixture.service.commit(target);
      fixture.timer.fire();
      await assert.rejects(pending, (error) =>
        assertServiceError(error, "launch-outcome-unknown")
      );
      assert.equal(fixture.service.getState(), "launch-outcome-unknown");
    }
    {
      const fixture = makeFixture();
      const target = await suspend(fixture);
      const pending = fixture.service.abort(target, "timeout-test");
      fixture.timer.fire();
      await assert.rejects(pending, (error) =>
        assertServiceError(error, "timeout")
      );
    }
    {
      const fixture = makeFixture();
      const target = await suspend(fixture);
      fixture.service.markPrepared(target);
      const pending = fixture.service.commit(target);
      fixture.helper.emitEvent("resumed");
      fixture.timer.fire();
      await assert.rejects(pending, (error) =>
        assertServiceError(error, "launch-outcome-unknown")
      );
      assert.equal(fixture.service.getState(), "launch-outcome-unknown");
    }
    {
      const fixture = makeFixture();
      const target = await suspend(fixture);
      const pending = fixture.service.abort(target, "exit-timeout-test");
      fixture.helper.emitEvent("aborted");
      fixture.timer.fire();
      await assert.rejects(pending, (error) =>
        assertServiceError(error, "timeout")
      );
    }
  });

  it("revokes on stdin errors, stdin EOF, stdout EOF, and rejected writes", async () => {
    for (const close of [
      (helper: FakeHelper) => helper.emitStdinError(),
      (helper: FakeHelper) => helper.emitStdinEof(),
      (helper: FakeHelper) => helper.emitStdoutEnd(),
    ]) {
      const fixture = makeFixture();
      await suspend(fixture);
      close(fixture.helper);
      assert.equal(fixture.service.getState(), "failed");
      assert.equal(fixture.registry.getState(), null);
      assert.equal(fixture.helper.terminated, true);
    }

    for (const writeResult of [
      false,
      Promise.reject(new Error("pipe closed")),
    ]) {
      const helper = new FakeHelper();
      helper.writeResult = writeResult;
      const fixture = makeFixture({ helper });
      const pending = fixture.service.start(makePlan());
      await assert.rejects(pending, (error) =>
        assertServiceError(
          error,
          writeResult === false ? "stdin-eof" : "stdin-write"
        )
      );
    }
  });

  it("revokes on helper errors and unexpected or non-zero exits", async () => {
    {
      const fixture = makeFixture();
      const pending = fixture.service.start(makePlan());
      fixture.helper.emitData(
        `${JSON.stringify({
          version: 1,
          type: "error",
          sessionId,
          stage: "create-process",
          code: 740,
          message: "elevation required",
        })}\n`
      );
      await assert.rejects(pending, (error) =>
        assertServiceError(error, "helper-error")
      );
    }
    {
      const fixture = makeFixture();
      const pending = fixture.service.start(makePlan());
      fixture.helper.emitExit();
      await assert.rejects(pending, (error) =>
        assertServiceError(error, "helper-exit")
      );
    }
    {
      const fixture = makeFixture();
      await suspend(fixture);
      fixture.helper.emitExit(1);
      assert.equal(fixture.service.getLastError()?.code, "helper-exit");
      assert.equal(fixture.registry.getState(), null);
    }
  });

  it("keeps session IDs one-shot after revocation", async () => {
    const registry = new OverlayQaAuthorizationRegistry(() => runtime);
    const first = makeFixture({ registry });
    const target = await suspend(first);
    assert.equal(
      first.service.revoke(target),
      false,
      "pre-resume revocation must use the supervised abort handshake"
    );
    assert.equal(first.service.getState(), "suspended");
    assert.equal(registry.isCurrent(target), true);
    const pendingAbort = first.service.abort(target, "replay-test-cleanup");
    first.helper.emitEvent("aborted");
    first.helper.emitExit();
    await pendingAbort;

    const replay = makeFixture({ registry });
    const pendingReplay = replay.service.start(makePlan());
    replay.helper.emitEvent("suspended");
    await assert.rejects(pendingReplay, (error) =>
      assertServiceError(error, "authorization-revoked")
    );
    assert.equal(replay.helper.terminated, true);
  });
});
