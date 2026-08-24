import type {
  OverlayInputCapabilityExpectation,
  OverlayInputCapabilityReport,
  OverlayChildCreationBackend,
} from "./overlay-input-capability-contract";
import { validateOverlayInputCapabilityReport } from "./overlay-input-capability-contract";
import type {
  OverlayControllerMiddlewareCapabilityExpectation,
  OverlayControllerMiddlewareCapabilityReport,
} from "./overlay-controller-middleware-capability-contract";
import { validateOverlayControllerMiddlewareCapabilityReport } from "./overlay-controller-middleware-capability-contract";
import type {
  OverlayRenderArchitecture,
  OverlayRenderBackend,
  OverlayRenderCapabilityExpectation,
  OverlayRenderCapabilityReport,
  OverlayRenderSurface,
} from "./overlay-render-capability-contract";
import { validateOverlayRenderCapabilityReport } from "./overlay-render-capability-contract";
import type {
  OverlayQaSupervisedTargetIdentity,
  OverlaySupervisedLaunchPlan,
} from "./overlay-supervised-launch-contract";
import { OverlayQaAuthorizationRegistry } from "./overlay-qa-authorization";
import { OverlaySupervisedLaunchService } from "./overlay-supervised-launch-service";

/**
 * QA-only composition seam. This module is not imported by a packaged launch
 * path and cannot enable either production overlay switch.
 */

export interface OverlayQaCapabilityBootstrap {
  identity: OverlayQaSupervisedTargetIdentity;
  inputGeneration: number;
  renderGeneration: number;
  topologyEpoch: string;
  nativeCommitSequence: string;
  absenceMonitorEpoch: string;
  requiredChildRoutes: readonly OverlayChildCreationBackend[];
  targetArchitecture: OverlayRenderArchitecture;
  activeBackend: OverlayRenderBackend;
  requiredRenderSurfaces: readonly OverlayRenderSurface[];
  /**
   * Exact native controller-module/interface/ABI expectation retained before
   * resume. Static PE strings are hints only and cannot replace this binding.
   */
  controllerMiddlewareExpectation?: OverlayControllerMiddlewareCapabilityExpectation;
}

export interface OverlayQaAuthenticatedCapabilityBinding {
  identity: OverlayQaSupervisedTargetIdentity;
  inputGeneration: number;
  renderGeneration: number;
  topologyEpoch: string;
  nativeCommitSequence: string;
}

export type OverlayQaCapabilityAuthenticationResult =
  | {
      authenticated: true;
      binding: OverlayQaAuthenticatedCapabilityBinding;
      inputReport: unknown;
      renderReport: unknown;
      controllerMiddlewareReport?: unknown;
    }
  | {
      authenticated: false;
      reason: string;
    };

/**
 * The adapter owns the native channel secret and must retain `bootstrap`
 * before accepting a target publication. The coordinator calls `authenticate`
 * only after the supervisor commit resumes the target; it may return the true
 * variant only after the native MAC, stable sequence, replay, peer and exact
 * bootstrap-binding checks have all passed. A fixed named mapping or a report
 * boolean is not a valid implementation of this interface.
 */
export interface OverlayQaCapabilityEvidenceSession {
  readonly bootstrap: OverlayQaCapabilityBootstrap;
  /**
   * The adapter must stop waiting for a publication when `signal` is aborted.
   * A true result is valid only while the signal remains live.
   */
  authenticate(
    signal: AbortSignal
  ): Promise<OverlayQaCapabilityAuthenticationResult>;
  /**
   * Abort is a mandatory best-effort cleanup request. The adapter must return
   * true only after the channel and every retained native resource are closed.
   */
  release(signal: AbortSignal): boolean | Promise<boolean>;
}

export interface OverlayQaCapabilityEvidenceSource {
  /**
   * While the target is suspended, create only the one-shot channel and retain
   * static target-identity and architecture expectations. Runtime module or Present
   * evidence cannot be published until after the supervisor resumes it. If
   * `signal` is aborted, the source must close partial resources and must not
   * subsequently publish or return a usable session.
   */
  open(
    identity: OverlayQaSupervisedTargetIdentity,
    signal: AbortSignal
  ): Promise<OverlayQaCapabilityEvidenceSession>;
}

export type OverlayQaEndToEndCoordinatorState =
  | "idle"
  | "launching"
  | "preparing"
  | "committing"
  | "authenticating"
  | "interactive"
  | "revoking"
  | "revoked"
  | "failed"
  | "launch-outcome-unknown";

export type OverlayQaEndToEndCoordinatorErrorCode =
  | "busy"
  | "launch-failed"
  | "authorization-revoked"
  | "evidence-session-failed"
  | "evidence-release-failed"
  | "evidence-unauthenticated"
  | "evidence-binding-mismatch"
  | "input-capability-rejected"
  | "controller-middleware-capability-rejected"
  | "render-capability-rejected";

export class OverlayQaEndToEndCoordinatorError extends Error {
  public constructor(
    public readonly code: OverlayQaEndToEndCoordinatorErrorCode,
    message: string,
    public readonly normalLaunchFallbackAllowed: boolean,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "OverlayQaEndToEndCoordinatorError";
  }
}

export interface OverlayQaEndToEndAcceptance {
  identity: OverlayQaSupervisedTargetIdentity;
  inputReport: OverlayInputCapabilityReport;
  renderReport: OverlayRenderCapabilityReport;
  controllerMiddlewareReport: OverlayControllerMiddlewareCapabilityReport | null;
}

export interface OverlayQaEndToEndRevocation {
  authorizationRevoked: boolean;
  evidenceReleased: boolean;
}

export interface OverlayQaEndToEndCoordinatorOptions {
  launchService: OverlaySupervisedLaunchService;
  authorizationRegistry: OverlayQaAuthorizationRegistry;
  evidenceSource: OverlayQaCapabilityEvidenceSource;
  evidenceDeadlines?: Partial<OverlayQaCapabilityEvidenceDeadlines>;
}

export interface OverlayQaCapabilityEvidenceDeadlines {
  openMs: number;
  authenticateMs: number;
  releaseMs: number;
}

const DEFAULT_EVIDENCE_DEADLINES: OverlayQaCapabilityEvidenceDeadlines = {
  openMs: 5_000,
  authenticateMs: 30_000,
  releaseMs: 5_000,
};

const MAX_EVIDENCE_DEADLINE_MS = 5 * 60_000;

const resolveEvidenceDeadlines = (
  overrides: Partial<OverlayQaCapabilityEvidenceDeadlines> | undefined
): OverlayQaCapabilityEvidenceDeadlines => {
  const deadlines = { ...DEFAULT_EVIDENCE_DEADLINES, ...overrides };
  for (const [name, value] of Object.entries(deadlines)) {
    if (
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > MAX_EVIDENCE_DEADLINE_MS
    ) {
      throw new RangeError(
        `QA capability evidence ${name} must be an integer from 1 through ${MAX_EVIDENCE_DEADLINE_MS}.`
      );
    }
  }
  return Object.freeze(deadlines);
};

type OverlayQaEvidenceOperation = "open" | "authenticate" | "release";

class OverlayQaEvidenceOperationInterruptedError extends Error {
  public constructor(
    public readonly operation: OverlayQaEvidenceOperation,
    public readonly reason: "aborted" | "deadline-exceeded"
  ) {
    super(
      `QA capability evidence ${operation} ${
        reason === "aborted" ? "was aborted" : "exceeded its deadline"
      }.`
    );
    this.name = "OverlayQaEvidenceOperationInterruptedError";
  }
}

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

const deepFreezeSnapshot = <T>(value: T, seen = new WeakSet<object>()): T => {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const member of Object.values(value)) deepFreezeSnapshot(member, seen);
  return Object.freeze(value);
};

const snapshotControllerMiddlewareExpectation = (
  value: OverlayControllerMiddlewareCapabilityExpectation
): OverlayControllerMiddlewareCapabilityExpectation => {
  const snapshot = structuredClone(value);
  const probe = validateOverlayControllerMiddlewareCapabilityReport(
    null,
    snapshot
  );
  if (probe.valid || probe.reason !== "invalid-report") {
    throw new TypeError(
      `Invalid controller middleware capability expectation (${probe.valid ? "unexpectedly-valid-report" : probe.reason}).`
    );
  }
  return deepFreezeSnapshot(snapshot);
};

const snapshotBootstrap = (
  value: OverlayQaCapabilityBootstrap
): OverlayQaCapabilityBootstrap =>
  Object.freeze({
    identity: Object.freeze({ ...value.identity }),
    inputGeneration: value.inputGeneration,
    renderGeneration: value.renderGeneration,
    topologyEpoch: value.topologyEpoch,
    nativeCommitSequence: value.nativeCommitSequence,
    absenceMonitorEpoch: value.absenceMonitorEpoch,
    requiredChildRoutes: Object.freeze([...value.requiredChildRoutes]),
    targetArchitecture: value.targetArchitecture,
    activeBackend: value.activeBackend,
    requiredRenderSurfaces: Object.freeze([...value.requiredRenderSurfaces]),
    ...(value.controllerMiddlewareExpectation === undefined
      ? {}
      : {
          controllerMiddlewareExpectation:
            snapshotControllerMiddlewareExpectation(
              value.controllerMiddlewareExpectation
            ),
        }),
  });

const inputExpectation = (
  bootstrap: OverlayQaCapabilityBootstrap
): OverlayInputCapabilityExpectation => ({
  identity: bootstrap.identity,
  generation: bootstrap.inputGeneration,
  topologyEpoch: bootstrap.topologyEpoch,
  nativeCommitSequence: bootstrap.nativeCommitSequence,
  absenceMonitorEpoch: bootstrap.absenceMonitorEpoch,
  requiredChildRoutes: bootstrap.requiredChildRoutes,
});

const renderExpectation = (
  bootstrap: OverlayQaCapabilityBootstrap
): OverlayRenderCapabilityExpectation => ({
  identity: bootstrap.identity,
  inputGeneration: bootstrap.inputGeneration,
  renderGeneration: bootstrap.renderGeneration,
  topologyEpoch: bootstrap.topologyEpoch,
  nativeCommitSequence: bootstrap.nativeCommitSequence,
  targetArchitecture: bootstrap.targetArchitecture,
  activeBackend: bootstrap.activeBackend,
  requiredSurfaces: bootstrap.requiredRenderSurfaces,
});

const bindingMatches = (
  binding: OverlayQaAuthenticatedCapabilityBinding,
  bootstrap: OverlayQaCapabilityBootstrap
) =>
  sameIdentity(binding.identity, bootstrap.identity) &&
  binding.inputGeneration === bootstrap.inputGeneration &&
  binding.renderGeneration === bootstrap.renderGeneration &&
  binding.topologyEpoch === bootstrap.topologyEpoch &&
  binding.nativeCommitSequence === bootstrap.nativeCommitSequence;

const controllerExpectationMatchesBootstrap = (
  expected: OverlayControllerMiddlewareCapabilityExpectation,
  bootstrap: OverlayQaCapabilityBootstrap
) =>
  sameIdentity(expected.identity, bootstrap.identity) &&
  expected.inputGeneration === String(bootstrap.inputGeneration) &&
  expected.topologyEpoch === bootstrap.topologyEpoch &&
  expected.nativeCommitSequence === bootstrap.nativeCommitSequence &&
  expected.absenceMonitorEpoch === bootstrap.absenceMonitorEpoch &&
  expected.targetArchitecture === bootstrap.targetArchitecture;

const coordinatorError = (
  code: OverlayQaEndToEndCoordinatorErrorCode,
  message: string,
  fallbackAllowed: boolean,
  cause?: unknown
) =>
  new OverlayQaEndToEndCoordinatorError(code, message, fallbackAllowed, {
    cause,
  });

/**
 * One-attempt QA coordinator. It composes the existing suspended-launch state
 * machine with an authenticated capability session without becoming a normal
 * game-launch fallback or a packaged runtime adapter.
 */
export class OverlayQaEndToEndCoordinator {
  private state: OverlayQaEndToEndCoordinatorState = "idle";
  private identity: OverlayQaSupervisedTargetIdentity | null = null;
  private evidenceSession: OverlayQaCapabilityEvidenceSession | null = null;
  private commitAcknowledged = false;
  private readonly evidenceDeadlines: OverlayQaCapabilityEvidenceDeadlines;
  private attemptController: AbortController | null = null;
  private revocationRequested = false;
  private revocationPromise: Promise<OverlayQaEndToEndRevocation> | null = null;

  public constructor(
    private readonly options: OverlayQaEndToEndCoordinatorOptions
  ) {
    this.evidenceDeadlines = resolveEvidenceDeadlines(
      options.evidenceDeadlines
    );
  }

  public getState(): OverlayQaEndToEndCoordinatorState {
    return this.state;
  }

  public async start(
    plan: OverlaySupervisedLaunchPlan
  ): Promise<OverlayQaEndToEndAcceptance> {
    if (this.state !== "idle") {
      throw coordinatorError(
        "busy",
        "The QA end-to-end coordinator already owns an attempt.",
        false
      );
    }

    this.attemptController = new AbortController();
    this.state = "launching";
    try {
      this.identity = await this.options.launchService.start(plan);
      if (!this.options.authorizationRegistry.canPrepare(this.identity)) {
        throw coordinatorError(
          "authorization-revoked",
          "The suspended identity was revoked before evidence preparation.",
          true
        );
      }

      this.state = "preparing";
      try {
        this.evidenceSession = await this.runEvidenceOperation(
          "open",
          this.evidenceDeadlines.openMs,
          (signal) => this.options.evidenceSource.open(this.identity!, signal),
          this.attemptController.signal
        );
      } catch (error) {
        const timedOut =
          error instanceof OverlayQaEvidenceOperationInterruptedError;
        throw coordinatorError(
          "evidence-session-failed",
          timedOut
            ? "Opening the authenticated QA capability session did not complete before its deadline."
            : "Unable to open the authenticated QA capability session.",
          !timedOut,
          error
        );
      }

      if (this.attemptController.signal.aborted) {
        throw coordinatorError(
          "authorization-revoked",
          "The suspended QA launch was cancelled before evidence preparation completed.",
          true
        );
      }

      let bootstrap: OverlayQaCapabilityBootstrap;
      try {
        bootstrap = snapshotBootstrap(this.evidenceSession.bootstrap);
      } catch (error) {
        throw coordinatorError(
          "evidence-session-failed",
          "The static QA capability bootstrap was invalid.",
          true,
          error
        );
      }

      if (!sameIdentity(bootstrap.identity, this.identity)) {
        throw coordinatorError(
          "evidence-binding-mismatch",
          "The retained capability bootstrap did not match the suspended launch identity.",
          true
        );
      }
      const staticInputExpectation = inputExpectation(bootstrap);
      const staticRenderExpectation = renderExpectation(bootstrap);
      const inputExpectationProbe = validateOverlayInputCapabilityReport(
        null,
        staticInputExpectation
      );
      const renderExpectationProbe = validateOverlayRenderCapabilityReport(
        null,
        staticRenderExpectation
      );
      const controllerExpectation =
        bootstrap.controllerMiddlewareExpectation ?? null;
      if (
        inputExpectationProbe.valid ||
        inputExpectationProbe.reason !== "invalid-report" ||
        renderExpectationProbe.valid ||
        renderExpectationProbe.reason !== "invalid-report" ||
        (controllerExpectation !== null &&
          !controllerExpectationMatchesBootstrap(
            controllerExpectation,
            bootstrap
          ))
      ) {
        throw coordinatorError(
          "evidence-session-failed",
          "The static QA capability expectations were invalid.",
          true
        );
      }

      // `open` above performs static preparation only. Runtime input/module and
      // render/Present evidence is impossible while the process is suspended.
      this.options.launchService.markPrepared(this.identity);
      this.state = "committing";
      await this.options.launchService.commit(this.identity);
      this.commitAcknowledged = true;

      if (this.attemptController.signal.aborted) {
        throw coordinatorError(
          "authorization-revoked",
          "The resumed QA launch was cancelled before capability authentication.",
          false
        );
      }

      this.state = "authenticating";
      let authentication: OverlayQaCapabilityAuthenticationResult;
      try {
        authentication = await this.runEvidenceOperation(
          "authenticate",
          this.evidenceDeadlines.authenticateMs,
          (signal) => this.evidenceSession!.authenticate(signal),
          this.attemptController.signal
        );
      } catch (error) {
        throw coordinatorError(
          "evidence-session-failed",
          error instanceof OverlayQaEvidenceOperationInterruptedError &&
            error.reason === "deadline-exceeded"
            ? "The resumed target's authenticated QA capability session exceeded its deadline."
            : "The resumed target's authenticated QA capability session failed.",
          false,
          error
        );
      }

      if (this.revocationRequested || this.attemptController.signal.aborted) {
        throw coordinatorError(
          "authorization-revoked",
          "The resumed QA capability session was revoked during authentication.",
          false
        );
      }

      if (!authentication.authenticated) {
        throw coordinatorError(
          "evidence-unauthenticated",
          `The QA capability publication was not authenticated (${authentication.reason}).`,
          false
        );
      }
      if (!bindingMatches(authentication.binding, bootstrap)) {
        throw coordinatorError(
          "evidence-binding-mismatch",
          "The authenticated capability publication did not match the retained launch/bootstrap tuple.",
          false
        );
      }

      const input = validateOverlayInputCapabilityReport(
        authentication.inputReport,
        staticInputExpectation
      );
      if (!input.valid) {
        throw coordinatorError(
          "input-capability-rejected",
          `The authenticated input capability report was rejected (${input.reason}).`,
          false
        );
      }

      const render = validateOverlayRenderCapabilityReport(
        authentication.renderReport,
        staticRenderExpectation
      );
      if (!render.valid) {
        throw coordinatorError(
          "render-capability-rejected",
          `The authenticated render capability report was rejected (${render.reason}).`,
          false
        );
      }

      let controllerMiddlewareReport: OverlayControllerMiddlewareCapabilityReport | null =
        null;
      if (controllerExpectation) {
        const controllerMiddleware =
          validateOverlayControllerMiddlewareCapabilityReport(
            authentication.controllerMiddlewareReport,
            controllerExpectation
          );
        if (!controllerMiddleware.valid) {
          throw coordinatorError(
            "controller-middleware-capability-rejected",
            `The authenticated controller middleware capability report was rejected (${controllerMiddleware.reason}).`,
            false
          );
        }
        controllerMiddlewareReport = controllerMiddleware.report;
      } else if (authentication.controllerMiddlewareReport !== undefined) {
        throw coordinatorError(
          "controller-middleware-capability-rejected",
          "The authenticated publication included controller middleware evidence without a retained expectation.",
          false
        );
      }
      if (
        render.report.inputGeneration !== input.report.generation ||
        render.report.topologyEpoch !== input.report.topologyEpoch ||
        render.report.nativeCommitSequence !==
          input.report.nativeCommitSequence ||
        (controllerMiddlewareReport !== null &&
          (controllerMiddlewareReport.inputGeneration !==
            String(input.report.generation) ||
            controllerMiddlewareReport.topologyEpoch !==
              input.report.topologyEpoch ||
            controllerMiddlewareReport.nativeCommitSequence !==
              input.report.nativeCommitSequence ||
            controllerMiddlewareReport.absenceMonitorEpoch !==
              input.report.absenceMonitorEpoch ||
            controllerMiddlewareReport.targetArchitecture !==
              render.report.targetArchitecture))
      ) {
        throw coordinatorError(
          "evidence-binding-mismatch",
          "The accepted input, render and controller reports did not share one native commit tuple.",
          false
        );
      }

      this.options.launchService.markInteractive(this.identity);
      if (!this.options.authorizationRegistry.canInteract(this.identity)) {
        throw coordinatorError(
          "authorization-revoked",
          "The resumed identity was revoked before interaction.",
          false
        );
      }

      this.state = "interactive";
      return Object.freeze({
        identity: Object.freeze({ ...this.identity }),
        inputReport: input.report,
        renderReport: render.report,
        controllerMiddlewareReport,
      });
    } catch (error) {
      throw await this.fail(error);
    }
  }

  public async revoke(): Promise<OverlayQaEndToEndRevocation> {
    if (this.revocationPromise) return this.revocationPromise;
    if (
      (this.state !== "interactive" && this.state !== "authenticating") ||
      !this.identity
    ) {
      return { authorizationRevoked: false, evidenceReleased: false };
    }

    this.revocationRequested = true;
    this.state = "revoking";
    this.attemptController?.abort();
    const authorizationRevoked = this.options.launchService.revoke(
      this.identity
    );
    this.revocationPromise = this.completeRevocation(authorizationRevoked);
    return this.revocationPromise;
  }

  /**
   * Fail-closed cancellation seam for a lifetime monitor that fires before
   * authentication begins. A suspended attempt follows the normal abort
   * handshake; an in-flight commit is allowed to settle but can never advance
   * into capability authentication or interaction.
   */
  public cancelBeforeInteraction(): boolean {
    if (this.state !== "preparing" && this.state !== "committing") {
      return false;
    }
    const controller = this.attemptController;
    if (!controller || controller.signal.aborted) return false;
    controller.abort();
    return true;
  }

  private async fail(
    error: unknown
  ): Promise<OverlayQaEndToEndCoordinatorError> {
    if (this.revocationRequested) {
      const revocation = await this.revocationPromise;
      if (!revocation?.evidenceReleased) {
        return coordinatorError(
          "evidence-release-failed",
          "The explicitly revoked QA capability evidence session did not release cleanly.",
          false,
          error
        );
      }
      return coordinatorError(
        "authorization-revoked",
        "The QA end-to-end launch attempt was explicitly revoked.",
        false,
        error
      );
    }

    const launchState = this.options.launchService.getState();
    const outcomeUnknown = launchState === "launch-outcome-unknown";
    const gameMayBeRunning =
      outcomeUnknown ||
      this.commitAcknowledged ||
      launchState === "resumed" ||
      launchState === "interactive";

    if (this.identity) {
      if (launchState === "suspended" || launchState === "prepared") {
        try {
          await this.options.launchService.abort(
            this.identity,
            "qa-capability-preparation-failed"
          );
        } catch {
          // The launch service owns its own fail-closed termination path.
        }
      } else if (launchState === "resumed" || launchState === "interactive") {
        this.options.launchService.revoke(this.identity);
      }
    }
    const evidenceReleased = await this.releaseEvidence();

    this.state = outcomeUnknown ? "launch-outcome-unknown" : "failed";
    if (!evidenceReleased) {
      return coordinatorError(
        "evidence-release-failed",
        "The QA capability evidence session did not release cleanly; a normal launch fallback is forbidden.",
        false,
        error
      );
    }
    if (error instanceof OverlayQaEndToEndCoordinatorError) {
      if (gameMayBeRunning && error.normalLaunchFallbackAllowed) {
        return coordinatorError(error.code, error.message, false, error);
      }
      return error;
    }
    return coordinatorError(
      "launch-failed",
      outcomeUnknown
        ? "The supervisor commit outcome is unknown; a normal launch fallback is forbidden."
        : "The QA end-to-end launch attempt failed.",
      !gameMayBeRunning,
      error
    );
  }

  private async releaseEvidence(): Promise<boolean> {
    const session = this.evidenceSession;
    this.evidenceSession = null;
    if (!session) return true;
    try {
      return (
        (await this.runEvidenceOperation(
          "release",
          this.evidenceDeadlines.releaseMs,
          (signal) => Promise.resolve(session.release(signal))
        )) === true
      );
    } catch {
      return false;
    }
  }

  private async completeRevocation(
    authorizationRevoked: boolean
  ): Promise<OverlayQaEndToEndRevocation> {
    const evidenceReleased = await this.releaseEvidence();
    this.state =
      authorizationRevoked && evidenceReleased ? "revoked" : "failed";
    return Object.freeze({ authorizationRevoked, evidenceReleased });
  }

  private runEvidenceOperation<T>(
    operation: OverlayQaEvidenceOperation,
    deadlineMs: number,
    invoke: (signal: AbortSignal) => Promise<T>,
    parentSignal?: AbortSignal
  ): Promise<T> {
    const controller = new AbortController();

    return new Promise<T>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const finish = (complete: () => void) => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        parentSignal?.removeEventListener("abort", onParentAbort);
        complete();
      };
      const interrupt = (reason: "aborted" | "deadline-exceeded") => {
        if (settled) return;
        controller.abort();
        finish(() =>
          reject(
            new OverlayQaEvidenceOperationInterruptedError(operation, reason)
          )
        );
      };
      const onParentAbort = () => interrupt("aborted");

      if (parentSignal?.aborted) {
        interrupt("aborted");
        return;
      }
      parentSignal?.addEventListener("abort", onParentAbort, { once: true });
      timer = setTimeout(() => interrupt("deadline-exceeded"), deadlineMs);

      let pending: Promise<T>;
      try {
        pending = invoke(controller.signal);
      } catch (error) {
        finish(() => reject(error));
        return;
      }
      void Promise.resolve(pending).then(
        (value) => finish(() => resolve(value)),
        (error) => finish(() => reject(error))
      );
    });
  }
}
