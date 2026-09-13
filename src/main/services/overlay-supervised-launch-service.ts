import path from "node:path";
import { TextDecoder } from "node:util";

import type {
  OverlayQaSupervisedTargetIdentity,
  OverlaySupervisedLaunchPlan,
} from "./overlay-supervised-launch-contract";
import { OverlayQaAuthorizationRegistry } from "./overlay-qa-authorization";
import { normalizeOverlayQaExecutablePath } from "./overlay-supervised-launch-policy";
import {
  OVERLAY_SUPERVISOR_HELPER_ARGS,
  OVERLAY_SUPERVISOR_DECISION_TIMEOUT_MS,
  OVERLAY_SUPERVISOR_PROTOCOL_VERSION,
  OverlaySupervisorEventDecoder,
  encodeOverlaySupervisorCommand,
  type OverlaySupervisorCommand,
  type OverlaySupervisorEvent,
} from "./overlay-supervised-launch-protocol";

/** This service is deliberately not wired into any production launch path. */
export const OVERLAY_SUPERVISED_LAUNCH_PRODUCTION_ENABLED = false;

export interface OverlaySupervisorHelperExit {
  code: number | null;
  signal: string | null;
}

/**
 * Narrow ChildProcess-like boundary owned by a future unpackaged QA adapter.
 * The service itself never resolves or spawns a helper executable.
 */
export interface OverlaySupervisorHelperAdapter {
  writeStdin(line: string): boolean | void | Promise<boolean | void>;
  /** Raw bytes are fatal UTF-8 decoded by this service, never by the adapter. */
  onStdoutData(listener: (chunk: Uint8Array) => void): () => void;
  onStdoutEnd(listener: () => void): () => void;
  onStdinError(listener: (error: Error) => void): () => void;
  onStdinEof(listener: () => void): () => void;
  onExit(listener: (exit: OverlaySupervisorHelperExit) => void): () => void;
  terminate(): void;
}

export interface OverlaySupervisorHelperFactory {
  /** `args` is always the fixed protocol flag; launch data travels over stdin. */
  start(args: readonly string[]): OverlaySupervisorHelperAdapter;
}

export interface OverlaySupervisorTimerAdapter {
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}

export interface OverlaySupervisedLaunchTimeouts {
  suspendedMs: number;
  preparedMs: number;
  commitMs: number;
  abortMs: number;
  exitMs: number;
}

export const DEFAULT_OVERLAY_SUPERVISED_LAUNCH_TIMEOUTS = Object.freeze({
  suspendedMs: 5_000,
  preparedMs: 5_000,
  commitMs: 4_000,
  abortMs: 5_000,
  exitMs: 2_000,
} satisfies OverlaySupervisedLaunchTimeouts);

export type OverlaySupervisedLaunchServiceState =
  | "idle"
  | "launch-sent"
  | "suspended"
  | "prepared"
  | "commit-sent"
  | "resume-exit"
  | "abort-sent"
  | "abort-exit"
  | "resumed"
  | "interactive"
  | "aborted"
  | "revoked"
  | "launch-outcome-unknown"
  | "failed";

export type OverlaySupervisedLaunchServiceErrorCode =
  | "busy"
  | "qa-disabled"
  | "invalid-plan"
  | "helper-start"
  | "stdin-write"
  | "stdin-eof"
  | "stdout-eof"
  | "protocol"
  | "out-of-order"
  | "identity-mismatch"
  | "authorization-revoked"
  | "helper-error"
  | "helper-exit"
  | "launch-outcome-unknown"
  | "timeout";

export class OverlaySupervisedLaunchServiceError extends Error {
  public constructor(
    public readonly code: OverlaySupervisedLaunchServiceErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "OverlaySupervisedLaunchServiceError";
  }
}

export interface OverlaySupervisedLaunchServiceOptions {
  helperFactory: OverlaySupervisorHelperFactory;
  authorizationRegistry: OverlayQaAuthorizationRegistry;
  targetVerifier: OverlaySupervisorTargetVerifier;
  timers?: OverlaySupervisorTimerAdapter;
  timeouts?: Partial<OverlaySupervisedLaunchTimeouts>;
}

/**
 * Evidence produced by a future native open-handle verifier. This is still a
 * TS prefilter only: generic integration stays blocked until the protocol and
 * native helper revalidate and hold this exact file identity themselves.
 */
export interface OverlayNativeVerifiedTarget {
  canonicalExecutablePath: string;
  canonicalGameRoot: string;
  volumeSerial: string;
  fileId: string;
  /** SHA-256 recomputed from the retained native target file handle. */
  contentSha256: string;
}

/** Must verify an open file handle/file ID against the trusted local game DB. */
export interface OverlaySupervisorTargetVerifier {
  verify(plan: OverlaySupervisedLaunchPlan): OverlayNativeVerifiedTarget | null;
}

class Deferred<T> {
  public readonly promise: Promise<T>;
  public settled = false;
  private resolvePromise!: (value: T | PromiseLike<T>) => void;
  private rejectPromise!: (reason?: unknown) => void;

  public constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolvePromise = resolve;
      this.rejectPromise = reject;
    });
  }

  public resolve(value: T) {
    if (this.settled) return;
    this.settled = true;
    this.resolvePromise(value);
  }

  public reject(reason: unknown) {
    if (this.settled) return;
    this.settled = true;
    this.rejectPromise(reason);
  }
}

const nodeTimers: OverlaySupervisorTimerAdapter = {
  set(callback, delayMs) {
    const handle = setTimeout(callback, delayMs);
    handle.unref();
    return handle;
  },
  clear(handle) {
    clearTimeout(handle as NodeJS.Timeout);
  },
};

/** Prefilter only; native canonical identity transitions use exact echo below. */
const samePlanPath = (left: string, right: string) =>
  path.win32.normalize(left).toLowerCase() ===
  path.win32.normalize(right).toLowerCase();

const sameIdentity = (
  left: OverlayQaSupervisedTargetIdentity,
  right: OverlayQaSupervisedTargetIdentity
) =>
  left.sessionId === right.sessionId &&
  left.pid === right.pid &&
  left.creationTicks === right.creationTicks &&
  left.canonicalExecutablePath === right.canonicalExecutablePath &&
  left.volumeSerial === right.volumeSerial &&
  left.fileId === right.fileId;

const VOLUME_SERIAL = /^(?!0{16}$)[0-9A-F]{16}$/u;
const FILE_ID = /^(?!0{32}$)[0-9A-F]{32}$/u;
const LOWERCASE_SHA256 = /^[0-9a-f]{64}$/u;

const serviceError = (
  code: OverlaySupervisedLaunchServiceErrorCode,
  message: string,
  cause?: unknown
) =>
  new OverlaySupervisedLaunchServiceError(code, message, {
    cause,
  });

const normalizeTimeouts = (
  configured: Partial<OverlaySupervisedLaunchTimeouts> | undefined
) => {
  const timeouts = {
    ...DEFAULT_OVERLAY_SUPERVISED_LAUNCH_TIMEOUTS,
    ...configured,
  };
  for (const [name, value] of Object.entries(timeouts)) {
    if (!Number.isInteger(value) || value < 1 || value > 60_000) {
      throw serviceError("invalid-plan", `Invalid ${name} supervisor timeout.`);
    }
  }
  if (
    timeouts.preparedMs * 2 + timeouts.commitMs >
    OVERLAY_SUPERVISOR_DECISION_TIMEOUT_MS - 5_000
  ) {
    throw serviceError(
      "invalid-plan",
      "Preparation and commit budgets exceed the helper hard-stop margin."
    );
  }
  return Object.freeze(timeouts);
};

const normalizePlan = (
  plan: OverlaySupervisedLaunchPlan,
  trustedTarget: OverlayNativeVerifiedTarget
): Readonly<{
  plan: OverlaySupervisedLaunchPlan;
  trustedTarget: OverlayNativeVerifiedTarget;
}> => {
  const executablePath = normalizeOverlayQaExecutablePath(plan.executablePath);
  const canonicalExecutablePath = normalizeOverlayQaExecutablePath(
    plan.canonicalExecutablePath
  );
  const command = normalizeOverlayQaExecutablePath(plan.command);
  const canonicalGameRoot = path.win32.normalize(
    trustedTarget.canonicalGameRoot
  );
  const relativeToRoot = canonicalExecutablePath
    ? path.win32.relative(canonicalGameRoot, canonicalExecutablePath)
    : "..";
  if (
    !executablePath ||
    !canonicalExecutablePath ||
    !command ||
    !samePlanPath(executablePath, canonicalExecutablePath) ||
    !samePlanPath(command, canonicalExecutablePath) ||
    !samePlanPath(
      plan.workingDirectory,
      path.win32.dirname(canonicalExecutablePath)
    ) ||
    Object.keys(plan.env).length !== 0
  ) {
    throw serviceError(
      "invalid-plan",
      "Supervisor plan failed exact-path validation."
    );
  }
  if (
    trustedTarget.canonicalExecutablePath !== canonicalExecutablePath ||
    !VOLUME_SERIAL.test(trustedTarget.volumeSerial) ||
    !FILE_ID.test(trustedTarget.fileId) ||
    !LOWERCASE_SHA256.test(trustedTarget.contentSha256) ||
    !path.win32.isAbsolute(canonicalGameRoot) ||
    relativeToRoot === "" ||
    relativeToRoot === ".." ||
    relativeToRoot.startsWith(`..${path.win32.sep}`) ||
    path.win32.isAbsolute(relativeToRoot) ||
    path.win32.parse(canonicalGameRoot).root.toLowerCase() ===
      canonicalGameRoot.toLowerCase() ||
    /^(?:[a-z]:\\windows|[a-z]:\\program files(?: \(x86\))?|[a-z]:\\users)(?:\\|$)/iu.test(
      canonicalGameRoot
    )
  ) {
    throw serviceError(
      "invalid-plan",
      "Supervisor target lacks trusted native game-root/file identity proof."
    );
  }

  const launchLine = encodeOverlaySupervisorCommand({
    version: OVERLAY_SUPERVISOR_PROTOCOL_VERSION,
    type: "launch",
    sessionId: plan.sessionId,
    executablePath,
    args: [...plan.args],
    workingDirectory: path.win32.dirname(canonicalExecutablePath),
    decisionTimeoutMs: OVERLAY_SUPERVISOR_DECISION_TIMEOUT_MS,
  });
  const parsed = JSON.parse(launchLine) as {
    args: string[];
    sessionId: string;
  };

  return Object.freeze({
    plan: Object.freeze({
      sessionId: parsed.sessionId,
      executablePath,
      canonicalExecutablePath,
      command,
      args: Object.freeze([...parsed.args]),
      workingDirectory: path.win32.dirname(canonicalExecutablePath),
      env: Object.freeze({}),
    }),
    trustedTarget: Object.freeze({
      canonicalExecutablePath,
      canonicalGameRoot,
      volumeSerial: trustedTarget.volumeSerial,
      fileId: trustedTarget.fileId,
      contentSha256: trustedTarget.contentSha256,
    }),
  });
};

/**
 * One-attempt, fail-closed coordinator for the QA-only suspended helper.
 * It is intentionally adapter-only: no executable path, shell command or
 * target arguments can be placed on the helper command line.
 */
export class OverlaySupervisedLaunchService {
  private readonly timers: OverlaySupervisorTimerAdapter;
  private readonly timeouts: Readonly<OverlaySupervisedLaunchTimeouts>;
  private readonly decoder = new OverlaySupervisorEventDecoder();
  private readonly stdoutTextDecoder = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: true,
  });
  private state: OverlaySupervisedLaunchServiceState = "idle";
  private plan: OverlaySupervisedLaunchPlan | null = null;
  private trustedTarget: OverlayNativeVerifiedTarget | null = null;
  private identity: OverlayQaSupervisedTargetIdentity | null = null;
  private helper: OverlaySupervisorHelperAdapter | null = null;
  private timeoutHandle: unknown = null;
  private listenerDisposers: Array<() => void> = [];
  private startDeferred: Deferred<OverlayQaSupervisedTargetIdentity> | null =
    null;
  private commitDeferred: Deferred<void> | null = null;
  private abortDeferred: Deferred<void> | null = null;
  private lastError: OverlaySupervisedLaunchServiceError | null = null;
  private stdoutValidated = false;
  private helperExit: OverlaySupervisorHelperExit | null = null;

  public constructor(
    private readonly options: OverlaySupervisedLaunchServiceOptions
  ) {
    this.timers = options.timers ?? nodeTimers;
    this.timeouts = normalizeTimeouts(options.timeouts);
  }

  public getState(): OverlaySupervisedLaunchServiceState {
    return this.state;
  }

  public getLastError(): OverlaySupervisedLaunchServiceError | null {
    return this.lastError;
  }

  public start(
    unsafePlan: OverlaySupervisedLaunchPlan
  ): Promise<OverlayQaSupervisedTargetIdentity> {
    if (this.state !== "idle") {
      return Promise.reject(
        serviceError("busy", "Supervisor already owns a session.")
      );
    }
    if (!this.options.authorizationRegistry.isRuntimeAllowed()) {
      return Promise.reject(
        serviceError("qa-disabled", "Supervisor QA gates are disabled.")
      );
    }

    try {
      const trustedTarget = this.options.targetVerifier.verify(unsafePlan);
      if (!trustedTarget) {
        throw serviceError(
          "invalid-plan",
          "Native target verifier rejected the requested game executable."
        );
      }
      const normalized = normalizePlan(unsafePlan, trustedTarget);
      this.plan = normalized.plan;
      this.trustedTarget = normalized.trustedTarget;
      this.helper = this.options.helperFactory.start(
        OVERLAY_SUPERVISOR_HELPER_ARGS
      );
      this.attachHelper(this.helper);
    } catch (error) {
      const failure =
        error instanceof OverlaySupervisedLaunchServiceError
          ? error
          : serviceError(
              "helper-start",
              "Unable to start supervisor helper.",
              error
            );
      this.fail(failure);
      return Promise.reject(failure);
    }

    this.state = "launch-sent";
    this.startDeferred = new Deferred<OverlayQaSupervisedTargetIdentity>();
    this.armTimeout(
      "launch-sent",
      this.timeouts.suspendedMs,
      "Timed out waiting for a suspended process identity."
    );
    this.send({
      version: OVERLAY_SUPERVISOR_PROTOCOL_VERSION,
      type: "launch",
      sessionId: this.plan.sessionId,
      executablePath: this.plan.executablePath,
      args: this.plan.args,
      workingDirectory: this.plan.workingDirectory,
      decisionTimeoutMs: OVERLAY_SUPERVISOR_DECISION_TIMEOUT_MS,
    });
    return this.startDeferred.promise;
  }

  public markPrepared(identity: OverlayQaSupervisedTargetIdentity): void {
    this.requireState("suspended");
    this.requireIdentity(identity);
    if (!this.options.authorizationRegistry.markPrepared(identity)) {
      this.throwFailure(
        "authorization-revoked",
        "Suspended process authorization was revoked before preparation."
      );
    }
    this.state = "prepared";
    this.armTimeout(
      "prepared",
      this.timeouts.preparedMs,
      "Timed out waiting to commit the prepared process."
    );
  }

  public commit(identity: OverlayQaSupervisedTargetIdentity): Promise<void> {
    try {
      this.requireState("prepared");
      this.requireIdentity(identity);
      if (!this.options.authorizationRegistry.isCurrent(identity)) {
        this.throwFailure(
          "authorization-revoked",
          "Prepared process authorization was revoked before commit."
        );
      }
    } catch (error) {
      return Promise.reject(error);
    }

    this.state = "commit-sent";
    this.commitDeferred = new Deferred<void>();
    this.armTimeout(
      "commit-sent",
      this.timeouts.commitMs,
      "Timed out waiting for the process to resume."
    );
    this.send({
      version: OVERLAY_SUPERVISOR_PROTOCOL_VERSION,
      type: "commit",
      ...this.identity!,
    });
    return this.commitDeferred.promise;
  }

  public abort(
    identity: OverlayQaSupervisedTargetIdentity,
    reason: string
  ): Promise<void> {
    try {
      if (this.state !== "suspended" && this.state !== "prepared") {
        this.throwFailure("out-of-order", "Abort was requested out of order.");
      }
      this.requireIdentity(identity);
      if (!this.options.authorizationRegistry.revoke(identity)) {
        this.throwFailure(
          "authorization-revoked",
          "Process authorization was stale before abort."
        );
      }
    } catch (error) {
      return Promise.reject(error);
    }

    this.state = "abort-sent";
    this.abortDeferred = new Deferred<void>();
    this.armTimeout(
      "abort-sent",
      this.timeouts.abortMs,
      "Timed out waiting for the helper to abort the process."
    );
    this.send({
      version: OVERLAY_SUPERVISOR_PROTOCOL_VERSION,
      type: "abort",
      ...this.identity!,
      reason,
    });
    return this.abortDeferred.promise;
  }

  public markInteractive(identity: OverlayQaSupervisedTargetIdentity): void {
    this.requireState("resumed");
    this.requireIdentity(identity);
    if (!this.options.authorizationRegistry.markInteractive(identity)) {
      this.throwFailure(
        "authorization-revoked",
        "Resumed process authorization was revoked before interaction."
      );
    }
    this.state = "interactive";
  }

  public revoke(identity: OverlayQaSupervisedTargetIdentity): boolean {
    // A suspended/prepared process must go through abort() so it cannot be
    // stranded while the helper still owns its primary thread.
    if (this.state !== "resumed" && this.state !== "interactive") {
      return false;
    }
    if (!this.identity || !sameIdentity(this.identity, identity)) return false;
    const revoked = this.options.authorizationRegistry.revoke(identity);
    if (revoked) {
      this.clearTimeout();
      this.state = "revoked";
    }
    return revoked;
  }

  private attachHelper(helper: OverlaySupervisorHelperAdapter) {
    const dispose = [
      helper.onStdoutData((chunk) => this.onStdoutData(chunk)),
      helper.onStdoutEnd(() => this.onStdoutEnd()),
      helper.onStdinError((error) =>
        this.fail(
          serviceError("stdin-write", "Supervisor stdin failed.", error)
        )
      ),
      helper.onStdinEof(() =>
        this.fail(serviceError("stdin-eof", "Supervisor stdin closed early."))
      ),
      helper.onExit((exit) => this.onExit(exit)),
    ];
    if (dispose.some((candidate) => typeof candidate !== "function")) {
      throw new TypeError(
        "Supervisor helper listener did not return a disposer."
      );
    }
    this.listenerDisposers.push(...dispose);
  }

  private onStdoutData(chunk: Uint8Array) {
    if (this.isTerminal()) return;
    if (this.stdoutValidated) {
      this.fail(serviceError("protocol", "Supervisor wrote after stdout EOF."));
      return;
    }
    try {
      if (!(chunk instanceof Uint8Array)) {
        throw new TypeError("Supervisor adapter returned a non-byte chunk.");
      }
      const decoded = this.stdoutTextDecoder.decode(chunk, { stream: true });
      for (const event of this.decoder.push(decoded)) this.onEvent(event);
    } catch (error) {
      this.fail(
        serviceError(
          "protocol",
          "Supervisor output violated the newline JSON protocol.",
          error
        )
      );
    }
  }

  private onStdoutEnd() {
    if (this.isTerminal()) return;
    if (this.stdoutValidated) return;
    try {
      const trailingText = this.stdoutTextDecoder.decode();
      if (trailingText) {
        for (const event of this.decoder.push(trailingText))
          this.onEvent(event);
      }
      if (this.isTerminal()) return;
      this.decoder.finish();
      this.stdoutValidated = true;
    } catch (error) {
      this.fail(
        serviceError("protocol", "Supervisor output ended mid-message.", error)
      );
      return;
    }
    if (this.helperExit) {
      this.finalizeCleanExit();
    } else if (this.state !== "resume-exit" && this.state !== "abort-exit") {
      this.fail(
        serviceError("stdout-eof", "Supervisor output closed before exit.")
      );
    }
  }

  private onEvent(event: OverlaySupervisorEvent) {
    if (this.isTerminal()) return;
    if (!this.plan || event.sessionId !== this.plan.sessionId) {
      this.fail(
        serviceError(
          "identity-mismatch",
          "Supervisor event session did not match."
        )
      );
      return;
    }
    if (event.type === "error") {
      this.fail(
        serviceError(
          "helper-error",
          `Supervisor helper failed during ${event.stage} (code ${event.code}).`
        )
      );
      return;
    }

    if (event.type === "suspended") {
      if (this.state !== "launch-sent") {
        this.fail(
          serviceError("out-of-order", "Suspended event arrived out of order.")
        );
        return;
      }
      if (
        event.canonicalExecutablePath !== this.plan.canonicalExecutablePath ||
        event.volumeSerial !== this.trustedTarget?.volumeSerial ||
        event.fileId !== this.trustedTarget?.fileId
      ) {
        this.fail(
          serviceError(
            "identity-mismatch",
            "Suspended executable path or pinned file identity did not match."
          )
        );
        return;
      }
      if (!this.options.authorizationRegistry.beginSuspended(event)) {
        this.fail(
          serviceError(
            "authorization-revoked",
            "Suspended identity was not authorized."
          )
        );
        return;
      }
      this.identity = Object.freeze({
        sessionId: event.sessionId,
        pid: event.pid,
        creationTicks: event.creationTicks,
        canonicalExecutablePath: event.canonicalExecutablePath,
        volumeSerial: event.volumeSerial,
        fileId: event.fileId,
      });
      this.state = "suspended";
      this.armTimeout(
        "suspended",
        this.timeouts.preparedMs,
        "Timed out preparing the suspended process."
      );
      this.startDeferred?.resolve(this.identity);
      return;
    }

    if (event.type === "resumed") {
      if (this.state !== "commit-sent") {
        this.fail(
          serviceError("out-of-order", "Resumed event arrived out of order.")
        );
        return;
      }
      if (!this.requireEventIdentity(event)) return;
      if (!this.options.authorizationRegistry.markResumed(event)) {
        this.fail(
          serviceError(
            "authorization-revoked",
            "Prepared identity was revoked."
          )
        );
        return;
      }
      this.state = "resume-exit";
      this.armTimeout(
        "resume-exit",
        this.timeouts.exitMs,
        "Timed out waiting for the helper to exit after resume."
      );
      return;
    }

    if (this.state !== "abort-sent") {
      this.fail(
        serviceError("out-of-order", "Aborted event arrived out of order.")
      );
      return;
    }
    if (!this.requireEventIdentity(event)) return;
    this.state = "abort-exit";
    this.armTimeout(
      "abort-exit",
      this.timeouts.exitMs,
      "Timed out waiting for the helper to exit after abort."
    );
  }

  private requireEventIdentity(event: OverlayQaSupervisedTargetIdentity) {
    if (!this.identity || !sameIdentity(this.identity, event)) {
      this.fail(
        serviceError(
          "identity-mismatch",
          "Supervisor process identity changed."
        )
      );
      return false;
    }
    return true;
  }

  private onExit(exit: OverlaySupervisorHelperExit) {
    if (this.isTerminal()) return;
    if (this.helperExit) {
      this.fail(serviceError("helper-exit", "Supervisor emitted exit twice."));
      return;
    }
    if (exit.code !== 0 || exit.signal !== null) {
      this.fail(
        serviceError("helper-exit", "Supervisor helper did not exit cleanly.")
      );
      return;
    }

    this.helperExit = { ...exit };
    if (this.stdoutValidated) this.finalizeCleanExit();
  }

  private finalizeCleanExit() {
    if (!this.helperExit || !this.stdoutValidated || this.isTerminal()) return;
    if (this.state === "resume-exit") {
      this.clearTimeout();
      this.state = "resumed";
      this.detachHelper();
      this.helper = null;
      this.commitDeferred?.resolve(undefined);
      return;
    }
    if (this.state === "abort-exit") {
      this.clearTimeout();
      this.state = "aborted";
      this.detachHelper();
      this.helper = null;
      this.abortDeferred?.resolve(undefined);
      return;
    }
    this.fail(
      serviceError("helper-exit", "Supervisor helper exited out of order.")
    );
  }

  private send(command: OverlaySupervisorCommand) {
    let line: string;
    try {
      line = encodeOverlaySupervisorCommand(command);
    } catch (error) {
      this.fail(
        serviceError("protocol", "Refused to encode supervisor command.", error)
      );
      return;
    }
    const helper = this.helper;
    if (!helper) {
      this.fail(
        serviceError("stdin-write", "Supervisor stdin was unavailable.")
      );
      return;
    }
    void Promise.resolve()
      .then(() => helper.writeStdin(line))
      .then((accepted) => {
        if (accepted === false) {
          this.fail(
            serviceError("stdin-eof", "Supervisor stdin rejected the command.")
          );
        }
      })
      .catch((error) =>
        this.fail(
          serviceError(
            "stdin-write",
            "Unable to write supervisor command.",
            error
          )
        )
      );
  }

  private requireState(expected: OverlaySupervisedLaunchServiceState) {
    if (this.state !== expected) {
      this.throwFailure(
        "out-of-order",
        `Expected supervisor state ${expected}; received ${this.state}.`
      );
    }
  }

  private requireIdentity(identity: OverlayQaSupervisedTargetIdentity) {
    if (!this.identity || !sameIdentity(this.identity, identity)) {
      this.throwFailure(
        "identity-mismatch",
        "Supervised process identity did not match."
      );
    }
  }

  private throwFailure(
    code: OverlaySupervisedLaunchServiceErrorCode,
    message: string
  ): never {
    const error = serviceError(code, message);
    this.fail(error);
    throw error;
  }

  private armTimeout(
    expectedState: OverlaySupervisedLaunchServiceState,
    delayMs: number,
    message: string
  ) {
    this.clearTimeout();
    this.timeoutHandle = this.timers.set(() => {
      this.timeoutHandle = null;
      if (this.state === expectedState) {
        this.fail(serviceError("timeout", message));
      }
    }, delayMs);
  }

  private clearTimeout() {
    if (this.timeoutHandle === null) return;
    this.timers.clear(this.timeoutHandle);
    this.timeoutHandle = null;
  }

  private fail(error: OverlaySupervisedLaunchServiceError) {
    if (this.isTerminal()) return;
    // Once a launch command may have reached the native helper, a Node-side
    // terminate() call cannot prove that no target was created (or that an
    // already-created target was killed). Until the native bootstrap returns
    // a kill-on-close/absence receipt, every such failure forbids a second,
    // normal launch attempt.
    const targetOutcomeUnknown =
      this.state === "launch-sent" ||
      this.state === "suspended" ||
      this.state === "prepared" ||
      this.state === "commit-sent" ||
      this.state === "resume-exit" ||
      this.state === "abort-sent" ||
      this.state === "abort-exit";
    const commitMayHaveResumed =
      this.state === "commit-sent" || this.state === "resume-exit";
    this.clearTimeout();
    if (this.identity) this.options.authorizationRegistry.revoke(this.identity);
    const helper = this.helper;
    this.helper = null;
    this.detachHelper();
    try {
      helper?.terminate();
    } catch {
      // Authorization is already revoked; helper termination is best effort.
    }
    const terminalError = commitMayHaveResumed
      ? serviceError(
          "launch-outcome-unknown",
          "The helper did not prove an exact never-created or terminated target outcome; the game must never be launched again as a fallback.",
          error
        )
      : error;
    this.lastError = terminalError;
    this.state = targetOutcomeUnknown ? "launch-outcome-unknown" : "failed";
    this.startDeferred?.reject(terminalError);
    this.commitDeferred?.reject(terminalError);
    this.abortDeferred?.reject(terminalError);
  }

  private detachHelper() {
    for (const dispose of this.listenerDisposers.splice(0)) {
      try {
        dispose();
      } catch {
        // Listener cleanup cannot restore authorization and is best effort.
      }
    }
  }

  private isTerminal() {
    return (
      this.state === "failed" ||
      this.state === "launch-outcome-unknown" ||
      this.state === "aborted" ||
      this.state === "revoked" ||
      this.state === "resumed" ||
      this.state === "interactive"
    );
  }
}
