import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  OVERLAY_INPUT_BACKENDS,
  type OverlayInputBackend,
  type OverlayInputBackendState,
  type OverlayInputCapabilityReport,
} from "./overlay-input-capability-contract";
import {
  OVERLAY_CONTROLLER_MIDDLEWARE_BACKENDS,
  validateOverlayControllerMiddlewareCapabilityReport,
  type OverlayControllerMiddlewareCapabilityExpectation,
  type OverlayControllerMiddlewareCapabilityReport,
} from "./overlay-controller-middleware-capability-contract";
import {
  OVERLAY_RENDER_BACKENDS,
  OVERLAY_RENDER_SURFACES,
  type OverlayRenderCapabilityReport,
  type OverlayRenderSurface,
} from "./overlay-render-capability-contract";
import type {
  OverlayQaSupervisedTargetIdentity,
  OverlaySupervisedLaunchPlan,
  OverlaySupervisedQaRuntime,
} from "./overlay-supervised-launch-contract";
import { OverlayQaAuthorizationRegistry } from "./overlay-qa-authorization";
import {
  OverlayQaEndToEndCoordinator,
  OverlayQaEndToEndCoordinatorError,
  type OverlayQaCapabilityAuthenticationResult,
  type OverlayQaCapabilityBootstrap,
  type OverlayQaCapabilityEvidenceDeadlines,
  type OverlayQaCapabilityEvidenceSession,
} from "./overlay-qa-end-to-end-coordinator";
import { evaluateOverlaySupervisedLaunchPolicy } from "./overlay-supervised-launch-policy";
import {
  parseOverlaySupervisorCommandLine,
  type OverlaySupervisorCommand,
} from "./overlay-supervised-launch-protocol";
import {
  OverlaySupervisedLaunchService,
  type OverlaySupervisorHelperAdapter,
  type OverlaySupervisorHelperExit,
} from "./overlay-supervised-launch-service";

const sessionId = "coordinator_qa_session_000000000001";
const executable = String.raw`C:\Games\Fixture\fixture.exe`;
const gameRoot = String.raw`C:\Games\Fixture`;
const TARGET_CONTENT_SHA256 = "a".repeat(64);
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
  pid: 4421,
  creationTicks: "133700000000000000",
  canonicalExecutablePath: executable,
  volumeSerial: "00000000000000A1",
  fileId: "000000000000000000000000000000B2",
};
const requiredRenderSurfaces = [
  "present",
  "resize-buffers",
  "swap-chain-destruction",
  "device-removal",
  "pipeline-state-restore",
  "multi-swap-chain-selection",
  "late-module-resolution",
] as const satisfies readonly OverlayRenderSurface[];

const makePlan = (): OverlaySupervisedLaunchPlan => {
  const result = evaluateOverlaySupervisedLaunchPolicy({
    runtime,
    sessionId,
    game: { libraryOrigin: "custom", executablePath: executable },
    executablePath: executable,
    canonicalExecutablePath: executable,
    resolvedCommand: { command: executable, args: ["--qa"], env: {} },
    workingDirectory: gameRoot,
  });
  assert.equal(result.allowed, true);
  return result.plan;
};

const makeBootstrap = (
  overrides: Partial<OverlayQaCapabilityBootstrap> = {}
): OverlayQaCapabilityBootstrap => ({
  identity: { ...identity },
  inputGeneration: 7,
  renderGeneration: 3,
  topologyEpoch: "9",
  nativeCommitSequence: "14",
  absenceMonitorEpoch: "18",
  requiredChildRoutes: [],
  targetArchitecture: "x64",
  activeBackend: "dxgi-d3d11",
  requiredRenderSurfaces: [...requiredRenderSurfaces],
  ...overrides,
});

const makeInputReport = (
  overrides: Partial<OverlayInputCapabilityReport> = {},
  states: Partial<Record<OverlayInputBackend, OverlayInputBackendState>> = {}
): OverlayInputCapabilityReport => ({
  schemaVersion: 1,
  identity: { ...identity },
  generation: 7,
  topologyEpoch: "9",
  nativeCommitSequence: "14",
  completeModuleSnapshot: true,
  absenceMonitorArmed: true,
  absenceMonitorEpoch: "18",
  preEntryBootstrap: true,
  cachedPointerInlineDetours: true,
  releaseFenceReady: true,
  requiredChildRoutes: [],
  observations: OVERLAY_INPUT_BACKENDS.map((backend) => ({
    backend,
    state:
      states[backend] ??
      (backend === "win32-keyboard" ||
      backend === "raw-input" ||
      backend === "late-module-resolution"
        ? "covered"
        : "absent"),
  })),
  ...overrides,
});

const makeRenderReport = (
  overrides: Partial<OverlayRenderCapabilityReport> = {}
): OverlayRenderCapabilityReport => ({
  schemaVersion: 1,
  identity: { ...identity },
  inputGeneration: 7,
  renderGeneration: 3,
  topologyEpoch: "9",
  nativeCommitSequence: "14",
  targetArchitecture: "x64",
  payloadArchitecture: "x64",
  activeBackend: "dxgi-d3d11",
  completeModuleSnapshot: true,
  lateModuleMonitorArmed: true,
  preEntryBootstrap: true,
  cachedPointerInlineDetours: true,
  nonblockingPresentPath: true,
  allocationFreePresentPath: true,
  hookReaderFence: true,
  backendEvidence: OVERLAY_RENDER_BACKENDS.map((name) => ({
    name,
    state: name === "dxgi-d3d11" ? "covered" : "absent",
  })),
  surfaceEvidence: OVERLAY_RENDER_SURFACES.map((name) => ({
    name,
    state: requiredRenderSurfaces.includes(
      name as (typeof requiredRenderSurfaces)[number]
    )
      ? "covered"
      : "absent",
  })),
  ...overrides,
});

const makeControllerExpectation = (
  overrides: Partial<OverlayControllerMiddlewareCapabilityExpectation> = {}
): OverlayControllerMiddlewareCapabilityExpectation => ({
  identity: { ...identity },
  inputGeneration: "7",
  middlewareGeneration: "4",
  topologyEpoch: "9",
  nativeCommitSequence: "14",
  nativeCommitDigest: "C".repeat(64),
  absenceMonitorEpoch: "18",
  targetArchitecture: "x64",
  unknownObservationSetDigest: "D".repeat(64),
  observedInventory: [],
  unknownObservations: [],
  backendExpectations: OVERLAY_CONTROLLER_MIDDLEWARE_BACKENDS.map(
    (backend) => ({
      backend,
      disposition: "absent" as const,
      modules: [],
      interfaceRevision: null,
      abiSchemaDigest: null,
      hidEndpoints: [],
    })
  ),
  ...overrides,
});

const makeControllerReport = (
  overrides: Partial<OverlayControllerMiddlewareCapabilityReport> = {}
): OverlayControllerMiddlewareCapabilityReport => ({
  schemaVersion: 2,
  identity: { ...identity },
  inputGeneration: "7",
  middlewareGeneration: "4",
  topologyEpoch: "9",
  nativeCommitSequence: "14",
  nativeCommitDigest: "C".repeat(64),
  absenceMonitorEpoch: "18",
  targetArchitecture: "x64",
  unknownObservationSetDigest: "D".repeat(64),
  completeModuleSnapshot: true,
  completeInterfaceInventory: true,
  absenceMonitorArmed: true,
  preEntryBootstrap: true,
  cachedPointerInlineDetours: true,
  handleLifecycleFence: true,
  completionDrainFence: true,
  hookReaderFence: true,
  observedInventory: [],
  unknownObservations: [],
  backendEvidence: OVERLAY_CONTROLLER_MIDDLEWARE_BACKENDS.map((backend) => ({
    backend,
    state: "absent" as const,
    modules: [],
    interfaceRevision: null,
    abiSchemaDigest: null,
    hidEndpoints: [],
    methods: [],
    outputHoldReplay: null,
  })),
  ...overrides,
});

type VoidListener = () => void;

class ProtocolHelper implements OverlaySupervisorHelperAdapter {
  public readonly writes: OverlaySupervisorCommand[] = [];
  public terminated = false;
  public onCommitSent: (() => void) | null = null;
  private readonly stdoutData = new Set<(chunk: Uint8Array) => void>();
  private readonly stdoutEnd = new Set<VoidListener>();
  private readonly stdinError = new Set<(error: Error) => void>();
  private readonly stdinEof = new Set<VoidListener>();
  private readonly exits = new Set<
    (exit: OverlaySupervisorHelperExit) => void
  >();

  public constructor(private readonly ambiguousCommit = false) {}

  public writeStdin(line: string) {
    const command = parseOverlaySupervisorCommandLine(line.trimEnd());
    this.writes.push(command);
    if (command.type === "commit") this.onCommitSent?.();
    queueMicrotask(() => {
      if (command.type === "launch") {
        this.emitIdentity("suspended");
      } else if (command.type === "abort") {
        this.emitIdentity("aborted");
        this.emitExit();
      } else if (this.ambiguousCommit) {
        for (const listener of [...this.stdinError]) {
          listener(new Error("synthetic commit acknowledgement loss"));
        }
      } else {
        this.emitIdentity("resumed");
        this.emitExit();
      }
    });
    return true;
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

  private emitIdentity(type: "suspended" | "resumed" | "aborted") {
    const bytes = new TextEncoder().encode(
      `${JSON.stringify({ version: 1, type, ...identity })}\n`
    );
    for (const listener of [...this.stdoutData]) listener(bytes);
  }

  private emitExit() {
    for (const listener of [...this.exits]) {
      listener({ code: 0, signal: null });
    }
    for (const listener of [...this.stdoutEnd]) listener();
  }
}

interface EvidenceOverrides {
  bootstrap?: Partial<OverlayQaCapabilityBootstrap>;
  open?: (
    session: OverlayQaCapabilityEvidenceSession,
    signal: AbortSignal
  ) => Promise<OverlayQaCapabilityEvidenceSession>;
  authentication?: (
    bootstrap: OverlayQaCapabilityBootstrap,
    signal: AbortSignal
  ) =>
    | OverlayQaCapabilityAuthenticationResult
    | Promise<OverlayQaCapabilityAuthenticationResult>;
  release?: (signal: AbortSignal) => boolean | Promise<boolean>;
}

const makeFixture = (
  options: {
    ambiguousCommit?: boolean;
    evidence?: EvidenceOverrides;
    evidenceDeadlines?: Partial<OverlayQaCapabilityEvidenceDeadlines>;
  } = {}
) => {
  const registry = new OverlayQaAuthorizationRegistry(() => runtime);
  const helper = new ProtocolHelper(options.ambiguousCommit);
  const service = new OverlaySupervisedLaunchService({
    helperFactory: { start: () => helper },
    authorizationRegistry: registry,
    targetVerifier: {
      verify: () => ({
        canonicalExecutablePath: executable,
        canonicalGameRoot: gameRoot,
        volumeSerial: identity.volumeSerial,
        fileId: identity.fileId,
        contentSha256: TARGET_CONTENT_SHA256,
      }),
    },
  });
  let releases = 0;
  const authenticationStates: string[] = [];
  const bootstrap = makeBootstrap(options.evidence?.bootstrap);
  const defaultAuthentication =
    (): OverlayQaCapabilityAuthenticationResult => ({
      authenticated: true,
      binding: {
        identity: { ...bootstrap.identity },
        inputGeneration: bootstrap.inputGeneration,
        renderGeneration: bootstrap.renderGeneration,
        topologyEpoch: bootstrap.topologyEpoch,
        nativeCommitSequence: bootstrap.nativeCommitSequence,
      },
      inputReport: makeInputReport(),
      renderReport: makeRenderReport(),
    });
  const evidenceSession: OverlayQaCapabilityEvidenceSession = {
    bootstrap,
    async authenticate(signal) {
      authenticationStates.push(service.getState());
      return (
        (await options.evidence?.authentication?.(bootstrap, signal)) ??
        defaultAuthentication()
      );
    },
    release(signal) {
      releases += 1;
      return options.evidence?.release?.(signal) ?? true;
    },
  };
  const coordinator = new OverlayQaEndToEndCoordinator({
    launchService: service,
    authorizationRegistry: registry,
    evidenceSource: {
      open: async (_identity, signal) =>
        options.evidence?.open?.(evidenceSession, signal) ?? evidenceSession,
    },
    evidenceDeadlines: options.evidenceDeadlines,
  });
  return {
    coordinator,
    service,
    registry,
    helper,
    releases: () => releases,
    authenticationStates,
  };
};

const assertCoordinatorError = (
  error: unknown,
  code: OverlayQaEndToEndCoordinatorError["code"],
  fallbackAllowed = true
) => {
  assert.ok(error instanceof OverlayQaEndToEndCoordinatorError);
  assert.equal(error.code, code);
  assert.equal(error.normalLaunchFallbackAllowed, fallbackAllowed);
  return true;
};

describe("overlay QA end-to-end coordinator", () => {
  it("accepts static prepare, commit, post-resume render and interaction", async () => {
    const fixture = makeFixture();
    const accepted = await fixture.coordinator.start(makePlan());

    assert.deepEqual(accepted.identity, identity);
    assert.equal(accepted.inputReport.generation, 7);
    assert.equal(accepted.renderReport.activeBackend, "dxgi-d3d11");
    assert.equal(accepted.renderReport.surfaceEvidence[0].state, "covered");
    assert.deepEqual(
      fixture.helper.writes.map((command) => command.type),
      ["launch", "commit"]
    );
    assert.equal(fixture.service.getState(), "interactive");
    assert.equal(fixture.registry.canInteract(identity), true);
    assert.equal(fixture.coordinator.getState(), "interactive");
    assert.deepEqual(fixture.authenticationStates, ["resumed"]);

    assert.deepEqual(await fixture.coordinator.revoke(), {
      authorizationRevoked: true,
      evidenceReleased: true,
    });
    assert.equal(fixture.releases(), 1);
    assert.equal(fixture.registry.getState(), null);
    assert.equal(fixture.coordinator.getState(), "revoked");
  });

  it("binds exact controller middleware evidence to the same native commit tuple", async () => {
    const expectationProbe =
      validateOverlayControllerMiddlewareCapabilityReport(
        null,
        makeControllerExpectation()
      );
    assert.equal(expectationProbe.valid, false);
    if (!expectationProbe.valid) {
      assert.equal(expectationProbe.reason, "invalid-report");
    }
    const fixture = makeFixture({
      evidence: {
        bootstrap: {
          controllerMiddlewareExpectation: makeControllerExpectation(),
        },
        authentication: (bootstrap) => ({
          authenticated: true,
          binding: {
            identity: { ...bootstrap.identity },
            inputGeneration: bootstrap.inputGeneration,
            renderGeneration: bootstrap.renderGeneration,
            topologyEpoch: bootstrap.topologyEpoch,
            nativeCommitSequence: bootstrap.nativeCommitSequence,
          },
          inputReport: makeInputReport(),
          renderReport: makeRenderReport(),
          controllerMiddlewareReport: makeControllerReport(),
        }),
      },
    });

    const accepted = await fixture.coordinator.start(makePlan());
    assert.equal(
      accepted.controllerMiddlewareReport?.nativeCommitDigest,
      "C".repeat(64)
    );
    assert.equal(
      accepted.controllerMiddlewareReport?.backendEvidence.every(
        (backend) => backend.state === "absent"
      ),
      true
    );
  });

  it("rejects a controller expectation not bound to the bootstrap before resume", async () => {
    const fixture = makeFixture({
      evidence: {
        bootstrap: {
          controllerMiddlewareExpectation: makeControllerExpectation({
            nativeCommitSequence: "15",
          }),
        },
      },
    });

    await assert.rejects(
      fixture.coordinator.start(makePlan()),
      (error: unknown) =>
        assertCoordinatorError(error, "evidence-session-failed", true)
    );
    assert.deepEqual(
      fixture.helper.writes.map((command) => command.type),
      ["launch", "abort"]
    );
  });

  it("rejects missing or stale exact controller middleware evidence after resume", async () => {
    for (const controllerMiddlewareReport of [
      undefined,
      makeControllerReport({ nativeCommitDigest: "E".repeat(64) }),
    ]) {
      const fixture = makeFixture({
        evidence: {
          bootstrap: {
            controllerMiddlewareExpectation: makeControllerExpectation(),
          },
          authentication: (bootstrap) => ({
            authenticated: true,
            binding: {
              identity: { ...bootstrap.identity },
              inputGeneration: bootstrap.inputGeneration,
              renderGeneration: bootstrap.renderGeneration,
              topologyEpoch: bootstrap.topologyEpoch,
              nativeCommitSequence: bootstrap.nativeCommitSequence,
            },
            inputReport: makeInputReport(),
            renderReport: makeRenderReport(),
            ...(controllerMiddlewareReport === undefined
              ? {}
              : { controllerMiddlewareReport }),
          }),
        },
      });

      await assert.rejects(
        fixture.coordinator.start(makePlan()),
        (error: unknown) =>
          assertCoordinatorError(
            error,
            "controller-middleware-capability-rejected",
            false
          )
      );
    }
  });

  it("bounds evidence-channel opening and aborts its adapter", async () => {
    let openAborted = false;
    const fixture = makeFixture({
      evidenceDeadlines: { openMs: 15 },
      evidence: {
        open: (_session, signal) => {
          signal.addEventListener(
            "abort",
            () => {
              openAborted = true;
            },
            { once: true }
          );
          return new Promise<OverlayQaCapabilityEvidenceSession>(() => {});
        },
      },
    });

    await assert.rejects(fixture.coordinator.start(makePlan()), (error) =>
      assertCoordinatorError(error, "evidence-session-failed", false)
    );
    assert.equal(openAborted, true);
    assert.deepEqual(
      fixture.helper.writes.map((command) => command.type),
      ["launch", "abort"]
    );
    assert.equal(fixture.service.getState(), "aborted");
    assert.equal(fixture.coordinator.getState(), "failed");
  });

  it("cancels a lifetime violation while evidence preparation is pending", async () => {
    let enteredOpen!: () => void;
    const openEntered = new Promise<void>((resolve) => {
      enteredOpen = resolve;
    });
    const fixture = makeFixture({
      evidence: {
        open: (_session, signal) => {
          enteredOpen();
          return new Promise<OverlayQaCapabilityEvidenceSession>(
            (_resolve, reject) =>
              signal.addEventListener(
                "abort",
                () => reject(new DOMException("cancelled", "AbortError")),
                { once: true }
              )
          );
        },
      },
    });

    const start = fixture.coordinator.start(makePlan());
    await openEntered;
    assert.equal(fixture.coordinator.getState(), "preparing");
    assert.equal(fixture.coordinator.cancelBeforeInteraction(), true);
    assert.equal(fixture.coordinator.cancelBeforeInteraction(), false);
    await assert.rejects(start, (error) =>
      assertCoordinatorError(error, "evidence-session-failed", false)
    );
    assert.deepEqual(
      fixture.helper.writes.map((command) => command.type),
      ["launch", "abort"]
    );
    assert.equal(fixture.service.getState(), "aborted");
  });

  it("cannot authenticate or interact after cancellation during commit", async () => {
    const fixture = makeFixture();
    fixture.helper.onCommitSent = () => {
      assert.equal(fixture.coordinator.getState(), "committing");
      assert.equal(fixture.coordinator.cancelBeforeInteraction(), true);
    };

    await assert.rejects(fixture.coordinator.start(makePlan()), (error) =>
      assertCoordinatorError(error, "authorization-revoked", false)
    );
    assert.deepEqual(fixture.authenticationStates, []);
    assert.deepEqual(
      fixture.helper.writes.map((command) => command.type),
      ["launch", "commit"]
    );
    assert.equal(fixture.service.getState(), "revoked");
    assert.equal(fixture.releases(), 1);
  });

  it("bounds a never-settling post-resume authentication", async () => {
    let authenticationAborted = false;
    const fixture = makeFixture({
      evidenceDeadlines: { authenticateMs: 15 },
      evidence: {
        authentication: (_bootstrap, signal) => {
          signal.addEventListener(
            "abort",
            () => {
              authenticationAborted = true;
            },
            { once: true }
          );
          return new Promise<OverlayQaCapabilityAuthenticationResult>(() => {});
        },
      },
    });

    await assert.rejects(fixture.coordinator.start(makePlan()), (error) =>
      assertCoordinatorError(error, "evidence-session-failed", false)
    );
    assert.equal(authenticationAborted, true);
    assert.equal(fixture.service.getState(), "revoked");
    assert.equal(fixture.registry.getState(), null);
    assert.equal(fixture.releases(), 1);
    assert.equal(fixture.coordinator.getState(), "failed");
  });

  it("revokes a wedged authentication and cannot later accept its result", async () => {
    let markAuthenticationStarted!: () => void;
    const authenticationStarted = new Promise<void>((resolve) => {
      markAuthenticationStarted = resolve;
    });
    let resolveAuthentication!: (
      result: OverlayQaCapabilityAuthenticationResult
    ) => void;
    let authenticationAborted = false;
    const fixture = makeFixture({
      evidence: {
        authentication: (bootstrap, signal) => {
          signal.addEventListener(
            "abort",
            () => {
              authenticationAborted = true;
            },
            { once: true }
          );
          markAuthenticationStarted();
          return new Promise<OverlayQaCapabilityAuthenticationResult>(
            (resolve) => {
              resolveAuthentication = resolve;
            }
          ).then((result) => {
            assert.deepEqual(bootstrap.identity, identity);
            return result;
          });
        },
      },
    });

    const start = fixture.coordinator.start(makePlan());
    await authenticationStarted;
    assert.equal(fixture.coordinator.getState(), "authenticating");
    const rejectedStart = assert.rejects(start, (error) =>
      assertCoordinatorError(error, "authorization-revoked", false)
    );

    assert.deepEqual(await fixture.coordinator.revoke(), {
      authorizationRevoked: true,
      evidenceReleased: true,
    });
    assert.equal(authenticationAborted, true);
    resolveAuthentication({
      authenticated: true,
      binding: {
        identity: { ...identity },
        inputGeneration: 7,
        renderGeneration: 3,
        topologyEpoch: "9",
        nativeCommitSequence: "14",
      },
      inputReport: makeInputReport(),
      renderReport: makeRenderReport(),
    });
    await rejectedStart;
    assert.equal(fixture.service.getState(), "revoked");
    assert.equal(fixture.registry.getState(), null);
    assert.equal(fixture.coordinator.getState(), "revoked");
  });

  it("forbids fallback when evidence release reports failure", async () => {
    const fixture = makeFixture({
      evidence: {
        bootstrap: {
          identity: {
            ...identity,
            fileId: "000000000000000000000000000000B3",
          },
        },
        release: () => false,
      },
    });

    await assert.rejects(fixture.coordinator.start(makePlan()), (error) =>
      assertCoordinatorError(error, "evidence-release-failed", false)
    );
    assert.equal(fixture.releases(), 1);
    assert.equal(fixture.registry.getState(), null);
    assert.equal(fixture.coordinator.getState(), "failed");
  });

  it("bounds a wedged evidence release and remains failed closed", async () => {
    let releaseAborted = false;
    const fixture = makeFixture({
      evidenceDeadlines: { releaseMs: 15 },
      evidence: {
        release: (signal) => {
          signal.addEventListener(
            "abort",
            () => {
              releaseAborted = true;
            },
            { once: true }
          );
          return new Promise<boolean>(() => {});
        },
      },
    });
    await fixture.coordinator.start(makePlan());

    assert.deepEqual(await fixture.coordinator.revoke(), {
      authorizationRevoked: true,
      evidenceReleased: false,
    });
    assert.equal(releaseAborted, true);
    assert.equal(fixture.releases(), 1);
    assert.equal(fixture.registry.getState(), null);
    assert.equal(fixture.coordinator.getState(), "failed");
  });

  it("fails closed when the evidence channel rejects a forged publication", async () => {
    const fixture = makeFixture({
      evidence: {
        authentication: () => ({
          authenticated: false,
          reason: "mac-rejected",
        }),
      },
    });

    await assert.rejects(fixture.coordinator.start(makePlan()), (error) =>
      assertCoordinatorError(error, "evidence-unauthenticated", false)
    );
    assert.deepEqual(
      fixture.helper.writes.map((command) => command.type),
      ["launch", "commit"]
    );
    assert.equal(fixture.service.getState(), "revoked");
    assert.equal(fixture.registry.getState(), null);
    assert.equal(fixture.releases(), 1);
  });

  it("aborts before commit when static preparation binds another file", async () => {
    const fixture = makeFixture({
      evidence: {
        bootstrap: {
          identity: {
            ...identity,
            fileId: "000000000000000000000000000000B3",
          },
        },
      },
    });

    await assert.rejects(fixture.coordinator.start(makePlan()), (error) =>
      assertCoordinatorError(error, "evidence-binding-mismatch")
    );
    assert.deepEqual(
      fixture.helper.writes.map((command) => command.type),
      ["launch", "abort"]
    );
    assert.equal(fixture.service.getState(), "aborted");
    assert.equal(fixture.registry.getState(), null);
    assert.deepEqual(fixture.authenticationStates, []);
    assert.equal(fixture.releases(), 1);
  });

  it("binds the authenticated receipt to the exact PID, file and generations", async () => {
    const changes: Array<
      (
        binding: OverlayQaCapabilityAuthenticationResult & {
          authenticated: true;
        }
      ) => void
    > = [
      (value) => {
        value.binding.identity.pid += 1;
      },
      (value) => {
        value.binding.identity.creationTicks = "133700000000000001";
      },
      (value) => {
        value.binding.identity.fileId = "000000000000000000000000000000B3";
      },
      (value) => {
        value.binding.inputGeneration += 1;
      },
      (value) => {
        value.binding.renderGeneration += 1;
      },
      (value) => {
        value.binding.nativeCommitSequence = "15";
      },
    ];

    for (const change of changes) {
      const fixture = makeFixture({
        evidence: {
          authentication: (bootstrap) => {
            const value: OverlayQaCapabilityAuthenticationResult & {
              authenticated: true;
            } = {
              authenticated: true,
              binding: {
                identity: { ...bootstrap.identity },
                inputGeneration: bootstrap.inputGeneration,
                renderGeneration: bootstrap.renderGeneration,
                topologyEpoch: bootstrap.topologyEpoch,
                nativeCommitSequence: bootstrap.nativeCommitSequence,
              },
              inputReport: makeInputReport(),
              renderReport: makeRenderReport(),
            };
            change(value);
            return value;
          },
        },
      });
      await assert.rejects(fixture.coordinator.start(makePlan()), (error) =>
        assertCoordinatorError(error, "evidence-binding-mismatch", false)
      );
      assert.equal(fixture.service.getState(), "revoked");
      assert.equal(fixture.registry.getState(), null);
    }
  });

  it("rejects stale post-resume reports before interaction", async () => {
    for (const [report, expectedCode] of [
      [
        { inputReport: makeInputReport({ generation: 6 }) },
        "input-capability-rejected",
      ],
      [
        { renderReport: makeRenderReport({ renderGeneration: 2 }) },
        "render-capability-rejected",
      ],
    ] as const) {
      const fixture = makeFixture({
        evidence: {
          authentication: (bootstrap) => ({
            authenticated: true,
            binding: {
              identity: { ...bootstrap.identity },
              inputGeneration: bootstrap.inputGeneration,
              renderGeneration: bootstrap.renderGeneration,
              topologyEpoch: bootstrap.topologyEpoch,
              nativeCommitSequence: bootstrap.nativeCommitSequence,
            },
            inputReport: report.inputReport ?? makeInputReport(),
            renderReport: report.renderReport ?? makeRenderReport(),
          }),
        },
      });
      await assert.rejects(fixture.coordinator.start(makePlan()), (error) =>
        assertCoordinatorError(error, expectedCode, false)
      );
      assert.deepEqual(
        fixture.helper.writes.map((command) => command.type),
        ["launch", "commit"]
      );
    }
  });

  it("rejects incomplete DXGI/D3D11 render evidence", async () => {
    const value = makeRenderReport();
    value.surfaceEvidence = value.surfaceEvidence.map((item) =>
      item.name === "pipeline-state-restore"
        ? { ...item, state: "absent" }
        : item
    );
    const fixture = makeFixture({
      evidence: {
        authentication: (bootstrap) => ({
          authenticated: true,
          binding: {
            identity: { ...bootstrap.identity },
            inputGeneration: bootstrap.inputGeneration,
            renderGeneration: bootstrap.renderGeneration,
            topologyEpoch: bootstrap.topologyEpoch,
            nativeCommitSequence: bootstrap.nativeCommitSequence,
          },
          inputReport: makeInputReport(),
          renderReport: value,
        }),
      },
    });

    await assert.rejects(fixture.coordinator.start(makePlan()), (error) =>
      assertCoordinatorError(error, "render-capability-rejected", false)
    );
    assert.equal(fixture.service.getState(), "revoked");
  });

  it("forbids normal-launch fallback after an ambiguous commit", async () => {
    const fixture = makeFixture({ ambiguousCommit: true });

    await assert.rejects(fixture.coordinator.start(makePlan()), (error) =>
      assertCoordinatorError(error, "launch-failed", false)
    );
    assert.equal(fixture.service.getState(), "launch-outcome-unknown");
    assert.equal(fixture.coordinator.getState(), "launch-outcome-unknown");
    assert.deepEqual(
      fixture.helper.writes.map((command) => command.type),
      ["launch", "commit"]
    );
    assert.equal(fixture.registry.getState(), null);
    assert.equal(fixture.releases(), 1);
    assert.equal(fixture.helper.terminated, true);
  });
});
