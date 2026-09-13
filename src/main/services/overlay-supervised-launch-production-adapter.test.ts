import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, it } from "node:test";

import type {
  ChildProcessWithoutNullStreams,
  SpawnOptionsWithoutStdio,
} from "node:child_process";
import type { ProcessPayload } from "./download/types";
import {
  OVERLAY_INPUT_BACKENDS,
  type OverlayInputBackend,
  type OverlayInputCapabilityReport,
} from "./overlay-input-capability-contract";
import type {
  OverlayQaCapabilityAuthenticationResult,
  OverlayQaCapabilityEvidenceDeadlines,
  OverlayQaCapabilityEvidenceSession,
  OverlayQaCapabilityBootstrap,
} from "./overlay-qa-end-to-end-coordinator";
import type {
  OverlayQaSupervisedTargetIdentity,
  OverlaySupervisedLaunchPolicyInput,
  OverlaySupervisedQaRuntime,
} from "./overlay-supervised-launch-contract";
import type { OverlayStaticTargetCapabilityProfile } from "./overlay-target-static-capability-policy";
import type {
  OverlayStaticTargetPreflightAccepted,
  OverlayStaticTargetPreflightDecision,
} from "./overlay-static-target-preflight";
import {
  OVERLAY_SUPERVISOR_HELPER_ARGS,
  parseOverlaySupervisorCommandLine,
  type OverlaySupervisorCommand,
} from "./overlay-supervised-launch-protocol";
import {
  OVERLAY_SUPERVISED_LAUNCH_ADAPTER_PRODUCTION_ENABLED,
  NodeOverlaySupervisorHelperFactory,
  OverlaySupervisedLaunchProductionAdapter,
  OverlaySupervisedLaunchProductionAdapterError,
  type OverlaySupervisedIdentityVerificationPhase,
  type OverlaySupervisedLifetimeGuardViolation,
  type OverlaySupervisorPinnedHelperIdentity,
} from "./overlay-supervised-launch-production-adapter";
import type {
  OverlaySupervisorHelperAdapter,
  OverlaySupervisorHelperExit,
} from "./overlay-supervised-launch-service";

const sessionId = "production_adapter_qa_000000000001";
const executable = String.raw`C:\Games\Fixture\fixture.exe`;
const gameRoot = String.raw`C:\Games\Fixture`;
const TARGET_CONTENT_SHA256 = "a".repeat(64);
const runtime = {
  platform: "win32",
  isPackaged: false,
  environment: {
    GAMEHUB_READ_ONLY_VISUAL_QA: "true",
    GAMEHUB_OVERLAY_SUPERVISED_LAUNCH_QA: "true",
  },
} as const;
const identity: OverlayQaSupervisedTargetIdentity = {
  sessionId,
  pid: 4421,
  creationTicks: "133700000000000000",
  canonicalExecutablePath: executable,
  volumeSerial: "00000000000000A1",
  fileId: "000000000000000000000000000000B2",
};

const request = (): OverlaySupervisedLaunchPolicyInput => ({
  runtime,
  sessionId,
  game: {
    libraryOrigin: "custom",
    executablePath: executable,
    nativeExecutablePath: null,
    trackingExecutablePaths: [],
  },
  executablePath: executable,
  canonicalExecutablePath: executable,
  resolvedCommand: { command: executable, args: ["--qa"], env: {} },
  workingDirectory: gameRoot,
});

const requiredRenderSurfaces = [
  "present",
  "resize-buffers",
  "swap-chain-destruction",
  "device-removal",
  "pipeline-state-restore",
  "multi-swap-chain-selection",
  "late-module-resolution",
] as const;

const staticProfile: OverlayStaticTargetCapabilityProfile = {
  requiresChildPropagation: false,
  requiredInputBackends: [
    "win32-keyboard",
    "raw-input",
    "late-module-resolution",
  ],
  requiredChildRoutes: [],
  candidateRenderBackends: ["dxgi-d3d11"],
  observedSteamInterfaceRevisions: [],
  blockers: [],
};

const staticPreflightEvidence = (
  profile: OverlayStaticTargetCapabilityProfile = staticProfile,
  imports: readonly { module: string; symbol: string | null }[] = [
    { module: "d3d11.dll", symbol: null },
  ]
): OverlayStaticTargetPreflightAccepted => {
  const image = {
    canonicalPath: executable,
    contentSha256: TARGET_CONTENT_SHA256,
    architecture: "x64" as const,
    completeImportSnapshot: true,
    imports,
    referencedSymbols: [],
    embeddedInterfaceRevisions: [],
  };
  return {
    allowed: true,
    inventory: {
      launchImage: image,
      renderImage: image,
      completeAdjacentModuleSnapshot: true,
      adjacentModules: [],
    },
    profile,
    scannedAdjacentDirectories: [gameRoot],
  };
};

const steamInputStaticPreflightEvidence =
  (): OverlayStaticTargetPreflightAccepted => {
    const image = {
      canonicalPath: executable,
      contentSha256: TARGET_CONTENT_SHA256,
      architecture: "x64" as const,
      completeImportSnapshot: true,
      imports: [
        { module: "d3d11.dll", symbol: null },
        { module: "steam_api64.dll", symbol: null },
      ],
      referencedSymbols: [],
      embeddedInterfaceRevisions: ["SteamInput006"],
      embeddedInterfaceTokens: ["SteamInput006"],
    };
    return {
      allowed: true,
      inventory: {
        launchImage: image,
        renderImage: image,
        completeAdjacentModuleSnapshot: true,
        adjacentModules: [],
      },
      profile: {
        requiresChildPropagation: false,
        requiredInputBackends: [
          "win32-keyboard",
          "raw-input",
          "late-module-resolution",
          "steam-input-interface-revisions",
        ],
        requiredChildRoutes: [],
        candidateRenderBackends: ["dxgi-d3d11"],
        observedSteamInterfaceRevisions: ["steaminput006"],
        blockers: [],
      },
      scannedAdjacentDirectories: [gameRoot],
    };
  };

const bootstrapFor = (
  targetIdentity: OverlayQaSupervisedTargetIdentity
): OverlayQaCapabilityBootstrap => ({
  identity: { ...targetIdentity },
  inputGeneration: 7,
  renderGeneration: 3,
  topologyEpoch: "9",
  nativeCommitSequence: "14",
  absenceMonitorEpoch: "18",
  requiredChildRoutes: [],
  targetArchitecture: "x64",
  activeBackend: "dxgi-d3d11",
  requiredRenderSurfaces: [...requiredRenderSurfaces],
});

const inputReportFor = (
  targetIdentity: OverlayQaSupervisedTargetIdentity,
  coveredBackends: readonly OverlayInputBackend[]
): OverlayInputCapabilityReport => ({
  schemaVersion: 1,
  identity: { ...targetIdentity },
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
    state: coveredBackends.includes(backend) ? "covered" : "absent",
  })),
});

type VoidListener = () => void;

class ProtocolHelper implements OverlaySupervisorHelperAdapter {
  public readonly writes: OverlaySupervisorCommand[] = [];
  public terminated = false;
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

class FakeNodeChild extends EventEmitter {
  public readonly stdin = new PassThrough();
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  public exitCode: number | null = null;
  public killed = false;

  public kill() {
    this.killed = true;
    return true;
  }
}

const pinnedHelper: OverlaySupervisorPinnedHelperIdentity = {
  canonicalExecutablePath: String.raw`C:\GameHub\overlay\gamehub-overlay-supervisor.exe`,
  canonicalTrustedRoot: String.raw`C:\GameHub\overlay`,
  volumeSerial: "00000000000000C3",
  fileId: "000000000000000000000000000000D4",
};

const assertAdapterError = (
  error: unknown,
  code: OverlaySupervisedLaunchProductionAdapterError["code"],
  fallbackAllowed: boolean
) => {
  assert.ok(error instanceof OverlaySupervisedLaunchProductionAdapterError);
  assert.equal(error.code, code);
  assert.equal(error.normalLaunchFallbackAllowed, fallbackAllowed);
  return true;
};

const makeAdapter = (
  options: {
    ambiguousCommit?: boolean;
    processes?: readonly ProcessPayload[];
    processSnapshots?: readonly (readonly ProcessPayload[])[];
    identityAllowed?: boolean;
    staticResult?: OverlayStaticTargetPreflightDecision;
    staticError?: Error;
    bootstrap?: Partial<OverlayQaCapabilityBootstrap>;
    authentication?: (
      bootstrap: OverlayQaCapabilityBootstrap
    ) =>
      | OverlayQaCapabilityAuthenticationResult
      | Promise<OverlayQaCapabilityAuthenticationResult>;
    releaseResult?: boolean;
    releaseError?: Error;
    verifiedContentSha256?: string;
    runtimeProvider?: () => OverlaySupervisedQaRuntime;
    onStaticInspect?: () => void | Promise<void>;
    evidenceDeadlines?: Partial<OverlayQaCapabilityEvidenceDeadlines>;
    evidenceOpen?: (
      targetIdentity: OverlayQaSupervisedTargetIdentity,
      retainedDecision: OverlayStaticTargetPreflightAccepted,
      signal: AbortSignal
    ) => Promise<OverlayQaCapabilityEvidenceSession>;
  } = {}
) => {
  const helper = new ProtocolHelper(options.ambiguousCommit);
  let helperStarts = 0;
  let releases = 0;
  let inventoryCalls = 0;
  let staticPreflightCalls = 0;
  let lifetimeReleases = 0;
  const configuredExecutableSnapshots: string[][] = [];
  let publishLifetimeViolation: (
    violation: OverlaySupervisedLifetimeGuardViolation
  ) => void = () => {
    throw new Error("Lifetime guard was not armed.");
  };
  const phases: OverlaySupervisedIdentityVerificationPhase[] = [];
  const evidenceDecisions: OverlayStaticTargetPreflightAccepted[] = [];
  const adapter = new OverlaySupervisedLaunchProductionAdapter({
    runtimeProvider: options.runtimeProvider ?? (() => runtime),
    helperFactory: {
      start() {
        helperStarts += 1;
        return helper;
      },
    },
    targetVerifier: {
      verify: () => ({
        canonicalExecutablePath: executable,
        canonicalGameRoot: gameRoot,
        volumeSerial: identity.volumeSerial,
        fileId: identity.fileId,
        contentSha256: options.verifiedContentSha256 ?? TARGET_CONTENT_SHA256,
      }),
    },
    processIdentityVerifier: {
      verify(targetIdentity, trustedTarget, phase, signal) {
        phases.push(phase);
        assert.equal(signal.aborted, false);
        assert.deepEqual(targetIdentity, identity);
        assert.equal(
          trustedTarget.canonicalExecutablePath,
          identity.canonicalExecutablePath
        );
        assert.equal(trustedTarget.volumeSerial, identity.volumeSerial);
        assert.equal(trustedTarget.fileId, identity.fileId);
        return options.identityAllowed ?? true;
      },
    },
    processInventory: {
      async list(signal) {
        inventoryCalls += 1;
        assert.equal(signal.aborted, false);
        if (options.processSnapshots) {
          return (
            options.processSnapshots[
              Math.min(inventoryCalls - 1, options.processSnapshots.length - 1)
            ] ?? []
          );
        }
        return options.processes ?? [];
      },
    },
    lifetimeGuard: {
      async arm(
        targetIdentity,
        trustedTarget,
        configuredExecutables,
        onViolation,
        signal
      ) {
        assert.equal(signal.aborted, false);
        assert.deepEqual(targetIdentity, identity);
        assert.equal(trustedTarget.canonicalExecutablePath, executable);
        assert.ok(configuredExecutables.includes(executable));
        configuredExecutableSnapshots.push([...configuredExecutables]);
        publishLifetimeViolation = onViolation;
        return {
          release(releaseSignal: AbortSignal) {
            lifetimeReleases += 1;
            assert.equal(releaseSignal.aborted, false);
            return true;
          },
        };
      },
    },
    staticTargetPreflight: {
      async inspect(preflightRequest, signal) {
        staticPreflightCalls += 1;
        assert.equal(signal.aborted, false);
        assert.deepEqual(preflightRequest, {
          launchTargetPath: executable,
          renderTargetPath: executable,
        });
        await options.onStaticInspect?.();
        if (options.staticError) throw options.staticError;
        return options.staticResult ?? staticPreflightEvidence();
      },
    },
    evidenceSource: {
      async open(targetIdentity, retainedDecision, signal) {
        assert.equal(signal.aborted, false);
        evidenceDecisions.push(retainedDecision);
        if (options.evidenceOpen) {
          return options.evidenceOpen(targetIdentity, retainedDecision, signal);
        }
        const bootstrap = {
          ...bootstrapFor(targetIdentity),
          ...options.bootstrap,
        };
        const session: OverlayQaCapabilityEvidenceSession = {
          bootstrap,
          async authenticate(authenticationSignal) {
            assert.equal(authenticationSignal.aborted, false);
            return (
              options.authentication?.(bootstrap) ?? {
                authenticated: false,
                reason: "fixture-refusal",
              }
            );
          },
          release(releaseSignal) {
            releases += 1;
            assert.equal(releaseSignal.aborted, false);
            if (options.releaseError) throw options.releaseError;
            return options.releaseResult ?? true;
          },
        };
        return session;
      },
    },
    evidenceDeadlines: options.evidenceDeadlines,
  });
  return {
    adapter,
    helper,
    helperStarts: () => helperStarts,
    inventoryCalls: () => inventoryCalls,
    staticPreflightCalls: () => staticPreflightCalls,
    releases: () => releases,
    lifetimeReleases: () => lifetimeReleases,
    configuredExecutableSnapshots,
    publishLifetimeViolation: (
      violation: OverlaySupervisedLifetimeGuardViolation
    ) => publishLifetimeViolation(violation),
    phases,
    evidenceDecisions,
  };
};

describe("guarded overlay supervised launch production adapter", () => {
  it("keeps the production adapter gate disabled", () => {
    assert.equal(OVERLAY_SUPERVISED_LAUNCH_ADAPTER_PRODUCTION_ENABLED, false);
  });

  it("spawns only the pinned helper identity with fixed protocol argv", async () => {
    const child = new FakeNodeChild();
    const spawns: Array<{
      executablePath: string;
      args: readonly string[];
      options: SpawnOptionsWithoutStdio;
    }> = [];
    const factory = new NodeOverlaySupervisorHelperFactory({
      pinnedHelper,
      helperIdentityVerifier: { verify: () => ({ ...pinnedHelper }) },
      environment: { SystemRoot: String.raw`C:\Windows` },
      spawnProcess(executablePath, args, options) {
        spawns.push({ executablePath, args, options });
        return child as unknown as ChildProcessWithoutNullStreams;
      },
    });

    const helper = factory.start(OVERLAY_SUPERVISOR_HELPER_ARGS);
    let written = "";
    child.stdin.once("data", (chunk) => {
      written = String(chunk);
    });
    assert.equal(await helper.writeStdin("fixture\n"), true);

    assert.equal(spawns.length, 1);
    assert.equal(
      spawns[0].executablePath,
      pinnedHelper.canonicalExecutablePath
    );
    assert.deepEqual(spawns[0].args, ["--stdio-json-v1"]);
    assert.equal(spawns[0].options.shell, false);
    assert.equal(spawns[0].options.detached, false);
    assert.deepEqual(spawns[0].options.stdio, ["pipe", "pipe", "pipe"]);
    assert.equal(written, "fixture\n");
  });

  it("refuses changed helper file identity and non-protocol argv", () => {
    const child = new FakeNodeChild();
    const changedFactory = new NodeOverlaySupervisorHelperFactory({
      pinnedHelper,
      helperIdentityVerifier: {
        verify: () => ({
          ...pinnedHelper,
          fileId: "000000000000000000000000000000E5",
        }),
      },
      spawnProcess: () => child as unknown as ChildProcessWithoutNullStreams,
    });
    assert.throws(
      () => changedFactory.start(OVERLAY_SUPERVISOR_HELPER_ARGS),
      /identity changed/u
    );

    const validFactory = new NodeOverlaySupervisorHelperFactory({
      pinnedHelper,
      helperIdentityVerifier: { verify: () => pinnedHelper },
      spawnProcess: () => child as unknown as ChildProcessWithoutNullStreams,
    });
    assert.throws(
      () => validFactory.start(["--stdio-json-v1", executable]),
      /non-protocol/u
    );
    assert.throws(
      () =>
        new NodeOverlaySupervisorHelperFactory({
          pinnedHelper,
          helperIdentityVerifier: { verify: () => pinnedHelper },
          environment: { GAMEHUB_QA_CRASH_AFTER_CREATE: "1" },
          spawnProcess: () =>
            child as unknown as ChildProcessWithoutNullStreams,
        }),
      /helper environment/u
    );
  });

  it("rejects anti-cheat before the helper starts and allows normal fallback", async () => {
    const fixture = makeAdapter({
      processes: [
        {
          pid: 55,
          name: "EasyAntiCheat_EOS.exe",
          exe: String.raw`C:\Games\Fixture\EasyAntiCheat\EasyAntiCheat_EOS.exe`,
        },
      ],
    });
    await assert.rejects(fixture.adapter.start(request()), (error) =>
      assertAdapterError(error, "anti-cheat-detected", true)
    );
    assert.equal(fixture.helperStarts(), 0);
    assert.equal(fixture.adapter.getState(), "failed");
  });

  it("fails closed on static refusal, exception, and caller abort before spawn", async () => {
    const refused = makeAdapter({
      staticResult: { allowed: false, reason: "invalid-request" },
    });
    await assert.rejects(refused.adapter.start(request()), (error) =>
      assertAdapterError(error, "static-target-rejected", true)
    );
    assert.equal(refused.helperStarts(), 0);
    assert.equal(refused.adapter.getStaticCapabilityProfile(), null);

    const failed = makeAdapter({ staticError: new Error("inspection failed") });
    await assert.rejects(failed.adapter.start(request()), (error) =>
      assertAdapterError(error, "static-target-preflight-failed", true)
    );
    assert.equal(failed.helperStarts(), 0);

    const aborted = makeAdapter();
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      aborted.adapter.start(request(), controller.signal),
      (error) =>
        assertAdapterError(error, "static-target-preflight-failed", true)
    );
    assert.equal(aborted.staticPreflightCalls(), 0);
    assert.equal(aborted.helperStarts(), 0);
  });

  it("uses only its constructor-owned frozen runtime snapshot", async () => {
    for (const runtimeProvider of [
      () => {
        throw new Error("trusted runtime unavailable");
      },
      () => null as unknown as OverlaySupervisedQaRuntime,
    ]) {
      const failed = makeAdapter({ runtimeProvider });
      await assert.rejects(failed.adapter.start(request()), (error) =>
        assertAdapterError(error, "policy-rejected", true)
      );
      assert.equal(failed.staticPreflightCalls(), 0);
      assert.equal(failed.helperStarts(), 0);
    }

    const forged = request();
    forged.runtime = {
      platform: "linux",
      isPackaged: true,
      environment: {},
    };
    const trusted = makeAdapter();
    await assert.rejects(trusted.adapter.start(forged), (error) =>
      assertAdapterError(error, "launch-failed", false)
    );
    assert.equal(trusted.staticPreflightCalls(), 1);
    assert.equal(trusted.helperStarts(), 1);
  });

  it("snapshots caller-owned anti-cheat anchors before awaited preflight", async () => {
    const mutableRequest = request();
    const fixture = makeAdapter({
      onStaticInspect: () => {
        mutableRequest.game.executablePath = String.raw`C:\Games\Mutated\other.exe`;
      },
    });

    await assert.rejects(fixture.adapter.start(mutableRequest), (error) =>
      assertAdapterError(error, "launch-failed", false)
    );
    assert.deepEqual(fixture.configuredExecutableSnapshots, [[executable]]);
  });

  it("rejects a retained-handle digest mismatch before helper spawn", async () => {
    for (const verifiedContentSha256 of ["b".repeat(64), "A".repeat(64)]) {
      const fixture = makeAdapter({ verifiedContentSha256 });
      await assert.rejects(fixture.adapter.start(request()), (error) =>
        assertAdapterError(error, "launch-failed", true)
      );
      assert.equal(fixture.helperStarts(), 0);
    }
  });

  it("rejects malformed, duplicated, out-of-order, and unknown static enums", async () => {
    const malformedProfiles = [
      {
        ...staticProfile,
        requiredInputBackends: [
          ...staticProfile.requiredInputBackends,
          "unknown-input-backend",
        ],
      },
      {
        ...staticProfile,
        candidateRenderBackends: ["dxgi-d3d11", "dxgi-d3d11"],
      },
      {
        ...staticProfile,
        candidateRenderBackends: ["dxgi-d3d12", "dxgi-d3d11"],
      },
      {
        ...staticProfile,
        requiredInputBackends: [
          ...staticProfile.requiredInputBackends,
          "steam-input-interface-revisions",
        ],
        observedSteamInterfaceRevisions: ["steaminput999"],
      },
    ] as unknown as OverlayStaticTargetCapabilityProfile[];

    for (const profile of malformedProfiles) {
      const fixture = makeAdapter({
        staticResult: staticPreflightEvidence(profile),
      });
      await assert.rejects(fixture.adapter.start(request()), (error) =>
        assertAdapterError(error, "static-target-preflight-failed", true)
      );
      assert.equal(fixture.helperStarts(), 0);
      assert.equal(fixture.adapter.getStaticCapabilityProfile(), null);
    }
  });

  it("recomputes and exactly binds the profile to the retained inventory", async () => {
    const forgedProfiles: OverlayStaticTargetCapabilityProfile[] = [
      {
        ...staticProfile,
        candidateRenderBackends: ["dxgi-d3d12"],
      },
      {
        ...staticProfile,
        requiredInputBackends: [
          ...staticProfile.requiredInputBackends,
          "direct-input-8",
        ],
      },
    ];
    for (const profile of forgedProfiles) {
      const fixture = makeAdapter({
        staticResult: staticPreflightEvidence(profile),
      });
      await assert.rejects(fixture.adapter.start(request()), (error) =>
        assertAdapterError(error, "static-target-preflight-failed", true)
      );
      assert.equal(fixture.helperStarts(), 0);
      assert.equal(fixture.adapter.getStaticPreflightEvidence(), null);
    }
  });

  it("rejects unrelated scan roots and noncanonical adjacent module evidence", async () => {
    const base = staticPreflightEvidence();
    const malformedEvidence = [
      {
        ...base,
        scannedAdjacentDirectories: [String.raw`C:\Games\Other`],
      },
      {
        ...base,
        inventory: {
          ...base.inventory,
          adjacentModules: ["z.dll", "a.dll"],
        },
      },
      {
        ...base,
        inventory: {
          ...base.inventory,
          adjacentModules: ["duplicate.dll", "duplicate.dll"],
        },
      },
      {
        ...base,
        inventory: {
          ...base.inventory,
          renderImage: {
            ...base.inventory.renderImage,
            contentSha256: "b".repeat(64),
          },
        },
      },
      {
        ...base,
        inventory: {
          ...base.inventory,
          hidReportSchemasVerified: true,
        },
      },
    ] as OverlayStaticTargetPreflightAccepted[];

    for (const staticResult of malformedEvidence) {
      const fixture = makeAdapter({ staticResult });
      await assert.rejects(fixture.adapter.start(request()), (error) =>
        assertAdapterError(error, "static-target-preflight-failed", true)
      );
      assert.equal(fixture.helperStarts(), 0);
    }
  });

  it("retains an immutable allowed profile and binds it into evidence open", async () => {
    const fixture = makeAdapter();
    await assert.rejects(fixture.adapter.start(request()), (error) =>
      assertAdapterError(error, "launch-failed", false)
    );
    const retained = fixture.adapter.getStaticCapabilityProfile();
    assert.ok(retained);
    assert.equal(Object.isFrozen(retained), true);
    assert.equal(Object.isFrozen(retained.requiredInputBackends), true);
    assert.equal(Object.isFrozen(retained.candidateRenderBackends), true);
    const retainedEvidence = fixture.adapter.getStaticPreflightEvidence();
    assert.ok(retainedEvidence);
    assert.equal(Object.isFrozen(retainedEvidence), true);
    assert.equal(fixture.evidenceDecisions.length, 1);
    assert.equal(fixture.evidenceDecisions[0], retainedEvidence);
    assert.equal(fixture.evidenceDecisions[0].profile, retained);
  });

  it("rejects bootstrap backend, architecture, and child-route mismatches before commit", async () => {
    for (const bootstrap of [
      { activeBackend: "dxgi-d3d12" as const },
      { targetArchitecture: "x86" as const },
      { requiredChildRoutes: ["create-process-w-a" as const] },
    ]) {
      const fixture = makeAdapter({ bootstrap });
      await assert.rejects(fixture.adapter.start(request()), (error) =>
        assertAdapterError(error, "launch-failed", true)
      );
      assert.deepEqual(
        fixture.helper.writes.map((command) => command.type),
        ["launch", "abort"]
      );
      assert.equal(fixture.releases(), 1);
    }
  });

  it("treats static Steam strings as hints and requires an exact middleware expectation", async () => {
    const fixture = makeAdapter({
      staticResult: steamInputStaticPreflightEvidence(),
    });

    await assert.rejects(fixture.adapter.start(request()), (error) =>
      assertAdapterError(error, "launch-failed", true)
    );
    assert.deepEqual(
      fixture.helper.writes.map((command) => command.type),
      ["launch", "abort"]
    );
    assert.equal(fixture.releases(), 1);
    assert.equal(fixture.lifetimeReleases(), 1);
  });

  it("forbids fallback when a rejected pre-commit session cannot release", async () => {
    const fixture = makeAdapter({
      bootstrap: { targetArchitecture: "x86" },
      releaseResult: false,
    });
    await assert.rejects(fixture.adapter.start(request()), (error) =>
      assertAdapterError(error, "launch-failed", false)
    );
    assert.deepEqual(
      fixture.helper.writes.map((command) => command.type),
      ["launch", "abort"]
    );
    assert.equal(fixture.releases(), 1);
  });

  it("releases the lifetime monitor when evidence release throws synchronously", async () => {
    const fixture = makeAdapter({
      releaseError: new Error("synthetic evidence release failure"),
    });
    await assert.rejects(fixture.adapter.start(request()), (error) =>
      assertAdapterError(error, "launch-failed", false)
    );
    assert.equal(fixture.releases(), 1);
    assert.equal(fixture.lifetimeReleases(), 1);
  });

  it("requires every statically required input backend to be covered", async () => {
    const requiredProfile: OverlayStaticTargetCapabilityProfile = {
      ...staticProfile,
      requiredInputBackends: [
        ...staticProfile.requiredInputBackends,
        "direct-input-8",
      ],
    };
    const binding = (bootstrap: OverlayQaCapabilityBootstrap) => ({
      identity: { ...bootstrap.identity },
      inputGeneration: bootstrap.inputGeneration,
      renderGeneration: bootstrap.renderGeneration,
      topologyEpoch: bootstrap.topologyEpoch,
      nativeCommitSequence: bootstrap.nativeCommitSequence,
    });
    const missing = makeAdapter({
      staticResult: staticPreflightEvidence(requiredProfile, [
        { module: "d3d11.dll", symbol: null },
        { module: "dinput8.dll", symbol: null },
      ]),
      authentication: (bootstrap) => ({
        authenticated: true,
        binding: binding(bootstrap),
        inputReport: inputReportFor(identity, [
          "win32-keyboard",
          "raw-input",
          "late-module-resolution",
        ]),
        renderReport: null,
      }),
    });
    await assert.rejects(missing.adapter.start(request()), (error) =>
      assertAdapterError(error, "launch-failed", false)
    );
    assert.deepEqual(missing.phases, ["suspended", "suspended", "resumed"]);
    assert.equal(missing.releases(), 1);

    const covered = makeAdapter({
      staticResult: staticPreflightEvidence(requiredProfile, [
        { module: "d3d11.dll", symbol: null },
        { module: "dinput8.dll", symbol: null },
      ]),
      authentication: (bootstrap) => ({
        authenticated: true,
        binding: binding(bootstrap),
        inputReport: inputReportFor(identity, [
          "win32-keyboard",
          "raw-input",
          "late-module-resolution",
          "direct-input-8",
        ]),
        // The coordinator rejects this after the adapter wrapper has accepted
        // static input coverage and performed its second resumed revalidation.
        renderReport: null,
      }),
    });
    await assert.rejects(covered.adapter.start(request()), (error) =>
      assertAdapterError(error, "launch-failed", false)
    );
    assert.deepEqual(covered.phases, [
      "suspended",
      "suspended",
      "resumed",
      "resumed",
    ]);
    assert.equal(covered.releases(), 1);
  });

  it("revalidates the full suspended identity and aborts before commit", async () => {
    const fixture = makeAdapter({ identityAllowed: false });
    await assert.rejects(fixture.adapter.start(request()), (error) =>
      assertAdapterError(error, "launch-failed", true)
    );
    assert.deepEqual(fixture.phases, ["suspended"]);
    assert.deepEqual(
      fixture.helper.writes.map((command) => command.type),
      ["launch", "abort"]
    );
    assert.equal(fixture.releases(), 0);
  });

  it("rechecks anti-cheat after channel creation and releases before abort", async () => {
    const antiCheat: ProcessPayload = {
      pid: 55,
      name: "EasyAntiCheat_EOS.exe",
      exe: String.raw`C:\Games\Fixture\EasyAntiCheat\EasyAntiCheat_EOS.exe`,
    };
    const fixture = makeAdapter({ processSnapshots: [[], [], [antiCheat]] });
    await assert.rejects(fixture.adapter.start(request()), (error) =>
      assertAdapterError(error, "launch-failed", true)
    );
    assert.deepEqual(fixture.phases, ["suspended", "suspended"]);
    assert.deepEqual(
      fixture.helper.writes.map((command) => command.type),
      ["launch", "abort"]
    );
    assert.equal(fixture.releases(), 1);
  });

  it("checks anti-cheat and exact identity again after resume", async () => {
    const fixture = makeAdapter();
    await assert.rejects(fixture.adapter.start(request()), (error) =>
      assertAdapterError(error, "launch-failed", false)
    );
    assert.deepEqual(fixture.phases, ["suspended", "suspended", "resumed"]);
    assert.deepEqual(
      fixture.helper.writes.map((command) => command.type),
      ["launch", "commit"]
    );
    assert.equal(fixture.inventoryCalls(), 4);
    assert.equal(fixture.releases(), 1);
  });

  it("revokes a resumed target while authentication never settles", async () => {
    let enteredAuthentication!: () => void;
    const authenticationEntered = new Promise<void>((resolve) => {
      enteredAuthentication = resolve;
    });
    const fixture = makeAdapter({
      authentication: async () => {
        enteredAuthentication();
        return new Promise<OverlayQaCapabilityAuthenticationResult>(() => {});
      },
    });

    const start = fixture.adapter.start(request());
    await authenticationEntered;
    assert.equal(fixture.adapter.getState(), "launching");
    assert.deepEqual(await fixture.adapter.revoke(), {
      authorizationRevoked: true,
      evidenceReleased: true,
    });
    await assert.rejects(start, (error) =>
      assertAdapterError(error, "launch-failed", false)
    );
    assert.equal(fixture.adapter.getState(), "revoked");
    assert.equal(fixture.releases(), 1);
  });

  it("revokes immediately when the lifetime guard detects an anti-cheat driver", async () => {
    let enteredAuthentication!: () => void;
    const authenticationEntered = new Promise<void>((resolve) => {
      enteredAuthentication = resolve;
    });
    const fixture = makeAdapter({
      authentication: async () => {
        enteredAuthentication();
        return new Promise<OverlayQaCapabilityAuthenticationResult>(() => {});
      },
    });

    const start = fixture.adapter.start(request());
    await authenticationEntered;
    fixture.publishLifetimeViolation({ kind: "anti-cheat-driver" });
    await assert.rejects(start, (error) =>
      assertAdapterError(error, "launch-failed", false)
    );
    assert.equal(fixture.adapter.getState(), "revoked");
    assert.equal(fixture.releases(), 1);
    assert.equal(fixture.lifetimeReleases(), 1);
  });

  it("cancels and aborts when the lifetime guard fires during preparation", async () => {
    let openEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      openEntered = resolve;
    });
    const fixture = makeAdapter({
      evidenceOpen: async (_identity, _decision, signal) => {
        openEntered();
        return new Promise<OverlayQaCapabilityEvidenceSession>(
          (_resolve, reject) =>
            signal.addEventListener(
              "abort",
              () => reject(new DOMException("cancelled", "AbortError")),
              { once: true }
            )
        );
      },
    });

    const start = fixture.adapter.start(request());
    await entered;
    fixture.publishLifetimeViolation({ kind: "anti-cheat-module" });
    await assert.rejects(start, (error) =>
      assertAdapterError(error, "launch-failed", false)
    );
    assert.deepEqual(
      fixture.helper.writes.map((command) => command.type),
      ["launch", "abort"]
    );
    assert.equal(fixture.releases(), 0);
    assert.equal(fixture.lifetimeReleases(), 1);
  });

  it("releases a late evidence-open fulfillment with a fresh cleanup signal", async () => {
    let fulfillOpen!: (session: OverlayQaCapabilityEvidenceSession) => void;
    let openSignal!: AbortSignal;
    let cleanupSignal!: AbortSignal;
    let openEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      openEntered = resolve;
    });
    let cleanupEntered!: () => void;
    const cleaned = new Promise<void>((resolve) => {
      cleanupEntered = resolve;
    });
    const fixture = makeAdapter({
      evidenceDeadlines: { openMs: 15 },
      evidenceOpen: async (_targetIdentity, _retainedDecision, signal) => {
        openSignal = signal;
        openEntered();
        return new Promise<OverlayQaCapabilityEvidenceSession>((resolve) => {
          fulfillOpen = resolve;
        });
      },
    });

    const start = fixture.adapter.start(request());
    await entered;
    if (!openSignal.aborted) {
      await new Promise<void>((resolve) =>
        openSignal.addEventListener("abort", () => resolve(), { once: true })
      );
    }
    fulfillOpen({
      bootstrap: bootstrapFor(identity),
      async authenticate() {
        return { authenticated: false, reason: "not-reached" };
      },
      release(signal) {
        cleanupSignal = signal;
        cleanupEntered();
        return true;
      },
    });

    await assert.rejects(start, (error) =>
      assertAdapterError(error, "launch-failed", false)
    );
    await cleaned;
    assert.notEqual(cleanupSignal, openSignal);
    assert.equal(openSignal.aborted, true);
    assert.equal(cleanupSignal.aborted, false);
  });

  it("forbids fallback when the commit outcome is ambiguous", async () => {
    const fixture = makeAdapter({ ambiguousCommit: true });
    await assert.rejects(fixture.adapter.start(request()), (error) =>
      assertAdapterError(error, "launch-failed", false)
    );
    assert.deepEqual(
      fixture.helper.writes.map((command) => command.type),
      ["launch", "commit"]
    );
    assert.equal(fixture.helper.terminated, true);
    assert.equal(fixture.adapter.getState(), "launch-outcome-unknown");
    assert.equal(fixture.releases(), 1);
  });
});
