import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from "node:child_process";
import path from "node:path";

import type { ProcessPayload } from "./download/types";
import {
  evaluateOverlayInjectionEligibility,
  findOverlayAntiCheatProcess,
} from "./overlay-injection-policy";
import {
  OVERLAY_CHILD_CREATION_BACKENDS,
  OVERLAY_INPUT_BACKENDS,
  validateOverlayInputCapabilityReport,
} from "./overlay-input-capability-contract";
import {
  OVERLAY_CONTROLLER_MIDDLEWARE_BACKENDS,
  type OverlayControllerMiddlewareCapabilityExpectation,
} from "./overlay-controller-middleware-capability-contract";
import {
  OverlayQaEndToEndCoordinator,
  OverlayQaEndToEndCoordinatorError,
  type OverlayQaCapabilityBootstrap,
  type OverlayQaCapabilityEvidenceDeadlines,
  type OverlayQaCapabilityEvidenceSession,
  type OverlayQaCapabilityEvidenceSource,
  type OverlayQaEndToEndAcceptance,
  type OverlayQaEndToEndRevocation,
} from "./overlay-qa-end-to-end-coordinator";
import { OverlayQaAuthorizationRegistry } from "./overlay-qa-authorization";
import type {
  OverlayQaSupervisedTargetIdentity,
  OverlaySupervisedLaunchPolicyInput,
  OverlaySupervisedLaunchPlan,
  OverlaySupervisedQaRuntime,
} from "./overlay-supervised-launch-contract";
import {
  evaluateOverlaySupervisedLaunchPolicy,
  normalizeOverlayQaExecutablePath,
} from "./overlay-supervised-launch-policy";
import { OVERLAY_SUPERVISOR_HELPER_ARGS } from "./overlay-supervised-launch-protocol";
import {
  OVERLAY_RENDER_BACKENDS,
  OVERLAY_RENDER_SURFACES,
} from "./overlay-render-capability-contract";
import type {
  OverlayStaticTargetPreflightAccepted,
  OverlayStaticTargetPreflightDependency,
} from "./overlay-static-target-preflight";
import {
  OverlaySupervisedLaunchService,
  type OverlayNativeVerifiedTarget,
  type OverlaySupervisedLaunchTimeouts,
  type OverlaySupervisorHelperAdapter,
  type OverlaySupervisorHelperExit,
  type OverlaySupervisorHelperFactory,
  type OverlaySupervisorTargetVerifier,
} from "./overlay-supervised-launch-service";
import {
  evaluateOverlayStaticTargetCapabilities,
  type OverlayStaticTargetCapabilityProfile,
} from "./overlay-target-static-capability-policy";

/**
 * This boundary is deliberately not connected to `open-game`. The existing
 * production kill switches remain the only production authority and stay
 * false until a signed, generic native supervisor and evidence publisher ship.
 */
export const OVERLAY_SUPERVISED_LAUNCH_ADAPTER_PRODUCTION_ENABLED = false;

const VOLUME_SERIAL = /^(?!0{16}$)[0-9A-F]{16}$/u;
const FILE_ID = /^(?!0{32}$)[0-9A-F]{32}$/u;
const LOWERCASE_SHA256 = /^[0-9a-f]{64}$/u;
const DEFAULT_STATIC_PREFLIGHT_DEADLINE_MS = 5_000;
const MAX_STATIC_PREFLIGHT_DEADLINE_MS = 60_000;
const EVIDENCE_OPEN_CLEANUP_DEADLINE_MS = 5_000;
const REQUIRED_BASE_INPUT_BACKENDS = [
  "win32-keyboard",
  "raw-input",
  "late-module-resolution",
] as const;
const KNOWN_STEAM_INPUT_REVISIONS = [
  "steamcontroller008",
  "steaminput006",
] as const;
const OVERLAY_STATIC_TARGET_BLOCKERS = [
  "incomplete-launch-import-snapshot",
  "incomplete-render-import-snapshot",
  "incomplete-adjacent-module-snapshot",
  "architecture-mismatch",
  "render-backend-unresolved",
  "child-creation-route-unresolved",
  "hid-report-schema-unverified",
  "steam-interface-revision-unresolved",
  "libscepad-abi-unverified",
] as const;

const samePinnedFile = (
  left: OverlaySupervisorPinnedHelperIdentity,
  right: OverlaySupervisorPinnedHelperIdentity
) =>
  left.canonicalExecutablePath === right.canonicalExecutablePath &&
  left.canonicalTrustedRoot === right.canonicalTrustedRoot &&
  left.volumeSerial === right.volumeSerial &&
  left.fileId === right.fileId;

const sameTargetIdentity = (
  identity: OverlayQaSupervisedTargetIdentity,
  target: OverlayNativeVerifiedTarget
) =>
  identity.canonicalExecutablePath === target.canonicalExecutablePath &&
  identity.volumeSerial === target.volumeSerial &&
  identity.fileId === target.fileId;

const sameWindowsPath = (left: string, right: string) =>
  path.win32.normalize(left).toLowerCase() ===
  path.win32.normalize(right).toLowerCase();

const isWithinRoot = (candidate: string, root: string) => {
  const relative = path.win32.relative(root, candidate);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.win32.sep}`) &&
    !path.win32.isAbsolute(relative)
  );
};

export interface OverlaySupervisorPinnedHelperIdentity {
  canonicalExecutablePath: string;
  canonicalTrustedRoot: string;
  volumeSerial: string;
  fileId: string;
}

/**
 * Must inspect the helper by an open native file handle. Returning a path from
 * a directory listing is not sufficient. The future production bootstrap must
 * additionally retain/revalidate this handle across CreateProcessW; Node's
 * spawn API cannot close that final replacement window by itself.
 */
export interface OverlaySupervisorHelperIdentityVerifier {
  verify(): OverlaySupervisorPinnedHelperIdentity | null;
}

export type OverlaySupervisorNodeSpawn = (
  executablePath: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio
) => ChildProcessWithoutNullStreams;

export interface NodeOverlaySupervisorHelperFactoryOptions {
  pinnedHelper: OverlaySupervisorPinnedHelperIdentity;
  helperIdentityVerifier: OverlaySupervisorHelperIdentityVerifier;
  environment?: Readonly<Record<string, string>>;
  spawnProcess?: OverlaySupervisorNodeSpawn;
}

const normalizePinnedHelper = (
  identity: OverlaySupervisorPinnedHelperIdentity
): OverlaySupervisorPinnedHelperIdentity => {
  const canonicalExecutablePath = normalizeOverlayQaExecutablePath(
    identity.canonicalExecutablePath
  );
  const canonicalTrustedRoot = path.win32.normalize(
    identity.canonicalTrustedRoot
  );
  if (
    !canonicalExecutablePath ||
    !path.win32.isAbsolute(canonicalTrustedRoot) ||
    canonicalTrustedRoot.startsWith("\\\\") ||
    canonicalTrustedRoot === path.win32.parse(canonicalTrustedRoot).root ||
    !isWithinRoot(canonicalExecutablePath, canonicalTrustedRoot) ||
    !VOLUME_SERIAL.test(identity.volumeSerial) ||
    !FILE_ID.test(identity.fileId)
  ) {
    throw new TypeError("Invalid pinned overlay supervisor helper identity.");
  }
  return Object.freeze({
    canonicalExecutablePath,
    canonicalTrustedRoot,
    volumeSerial: identity.volumeSerial,
    fileId: identity.fileId,
  });
};

class NodeOverlaySupervisorHelperAdapter
  implements OverlaySupervisorHelperAdapter
{
  private readonly stdoutDataListeners = new Set<(chunk: Uint8Array) => void>();
  private readonly stdoutEndListeners = new Set<() => void>();
  private readonly stdinErrorListeners = new Set<(error: Error) => void>();
  private readonly stdinEofListeners = new Set<() => void>();
  private readonly exitListeners = new Set<
    (exit: OverlaySupervisorHelperExit) => void
  >();
  private readonly pendingStdout: Uint8Array[] = [];
  private stdoutEnded = false;
  private stdinEnded = false;
  private startupError: Error | null = null;
  private exited: OverlaySupervisorHelperExit | null = null;

  public constructor(private readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.on("data", (chunk: Buffer | Uint8Array) => {
      const bytes = new Uint8Array(chunk);
      if (this.stdoutDataListeners.size === 0) {
        this.pendingStdout.push(bytes);
        return;
      }
      for (const listener of [...this.stdoutDataListeners]) listener(bytes);
    });
    child.stdout.once("end", () => {
      this.stdoutEnded = true;
      for (const listener of [...this.stdoutEndListeners]) listener();
    });
    child.stdin.on("error", (error) => this.emitStdinError(error));
    child.stdin.once("close", () => {
      // A normal child exit also closes stdin. Defer the classification until
      // Node has had a chance to publish its exit status.
      setImmediate(() => {
        if (this.exited || child.exitCode !== null) return;
        this.stdinEnded = true;
        for (const listener of [...this.stdinEofListeners]) listener();
      });
    });
    child.once("error", (error) => this.emitStdinError(error));
    child.once("exit", (code, signal) => {
      this.exited = { code, signal };
      for (const listener of [...this.exitListeners]) listener(this.exited);
    });
    // The protocol has no stderr channel. Always drain it so a verbose helper
    // can never deadlock before its authenticated stdout result.
    child.stderr.resume();
  }

  public writeStdin(line: string): Promise<boolean> {
    if (this.startupError) return Promise.reject(this.startupError);
    if (this.exited || this.child.stdin.destroyed)
      return Promise.resolve(false);
    return new Promise<boolean>((resolve, reject) => {
      this.child.stdin.write(line, "utf8", (error) => {
        if (error) reject(error);
        else resolve(true);
      });
    });
  }

  public onStdoutData(listener: (chunk: Uint8Array) => void) {
    this.stdoutDataListeners.add(listener);
    for (const chunk of this.pendingStdout.splice(0)) listener(chunk);
    return () => this.stdoutDataListeners.delete(listener);
  }

  public onStdoutEnd(listener: () => void) {
    this.stdoutEndListeners.add(listener);
    if (this.stdoutEnded) queueMicrotask(listener);
    return () => this.stdoutEndListeners.delete(listener);
  }

  public onStdinError(listener: (error: Error) => void) {
    this.stdinErrorListeners.add(listener);
    if (this.startupError) queueMicrotask(() => listener(this.startupError!));
    return () => this.stdinErrorListeners.delete(listener);
  }

  public onStdinEof(listener: () => void) {
    this.stdinEofListeners.add(listener);
    if (this.stdinEnded) queueMicrotask(listener);
    return () => this.stdinEofListeners.delete(listener);
  }

  public onExit(listener: (exit: OverlaySupervisorHelperExit) => void) {
    this.exitListeners.add(listener);
    if (this.exited) queueMicrotask(() => listener(this.exited!));
    return () => this.exitListeners.delete(listener);
  }

  public terminate() {
    if (!this.child.stdin.destroyed) this.child.stdin.destroy();
    if (this.child.exitCode === null && !this.child.killed) this.child.kill();
  }

  private emitStdinError(error: Error) {
    this.startupError = error;
    for (const listener of [...this.stdinErrorListeners]) listener(error);
  }
}

/**
 * Real fixed-argv Node adapter for the native supervisor. The helper path,
 * root, volume and file ID are pinned at construction and re-inspected before
 * every spawn. All launch data still travels over the strict stdin protocol.
 */
export class NodeOverlaySupervisorHelperFactory
  implements OverlaySupervisorHelperFactory
{
  private readonly pinnedHelper: OverlaySupervisorPinnedHelperIdentity;
  private readonly spawnProcess: OverlaySupervisorNodeSpawn;
  private readonly environment: Readonly<Record<string, string>>;

  public constructor(
    private readonly options: NodeOverlaySupervisorHelperFactoryOptions
  ) {
    this.pinnedHelper = normalizePinnedHelper(options.pinnedHelper);
    const defaultEnvironment: Record<string, string> = {};
    const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
    if (systemRoot) {
      defaultEnvironment.SystemRoot = systemRoot;
      defaultEnvironment.WINDIR = systemRoot;
    }
    const environment = options.environment ?? defaultEnvironment;
    const environmentKeys = Object.keys(environment);
    const normalizedKeys = environmentKeys.map((key) => key.toLowerCase());
    if (
      new Set(normalizedKeys).size !== normalizedKeys.length ||
      normalizedKeys.some((key) => key !== "systemroot" && key !== "windir") ||
      Object.values(environment).some(
        (value) =>
          typeof value !== "string" ||
          value.length === 0 ||
          value.length > 32_767 ||
          value.includes("\0")
      )
    ) {
      throw new TypeError("Invalid overlay supervisor helper environment.");
    }
    this.environment = Object.freeze({ ...environment });
    this.spawnProcess =
      options.spawnProcess ??
      ((executablePath, args, spawnOptions) =>
        spawn(
          executablePath,
          [...args],
          spawnOptions
        ) as ChildProcessWithoutNullStreams);
  }

  public start(args: readonly string[]): OverlaySupervisorHelperAdapter {
    if (
      args.length !== OVERLAY_SUPERVISOR_HELPER_ARGS.length ||
      args.some(
        (argument, index) => argument !== OVERLAY_SUPERVISOR_HELPER_ARGS[index]
      )
    ) {
      throw new TypeError("Refused non-protocol overlay supervisor arguments.");
    }
    const inspected = this.options.helperIdentityVerifier.verify();
    if (!inspected) {
      throw new TypeError(
        "Overlay supervisor helper identity was unavailable."
      );
    }
    let normalizedInspected: OverlaySupervisorPinnedHelperIdentity;
    try {
      normalizedInspected = normalizePinnedHelper(inspected);
    } catch (error) {
      throw new TypeError("Overlay supervisor helper identity was invalid.", {
        cause: error,
      });
    }
    if (!samePinnedFile(normalizedInspected, this.pinnedHelper)) {
      throw new TypeError("Overlay supervisor helper identity changed.");
    }

    const child = this.spawnProcess(
      this.pinnedHelper.canonicalExecutablePath,
      OVERLAY_SUPERVISOR_HELPER_ARGS,
      {
        cwd: path.win32.dirname(this.pinnedHelper.canonicalExecutablePath),
        detached: false,
        env: { ...this.environment },
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        windowsVerbatimArguments: false,
      }
    );
    return new NodeOverlaySupervisorHelperAdapter(child);
  }
}

export type OverlaySupervisedIdentityVerificationPhase =
  | "suspended"
  | "resumed";

/** Must re-open the exact PID and verify creation time, image and file ID. */
export interface OverlaySupervisedProcessIdentityVerifier {
  verify(
    identity: OverlayQaSupervisedTargetIdentity,
    trustedTarget: OverlayNativeVerifiedTarget,
    phase: OverlaySupervisedIdentityVerificationPhase,
    signal: AbortSignal
  ): boolean | Promise<boolean>;
}

export interface OverlaySupervisedProcessInventory {
  list(signal: AbortSignal): Promise<readonly ProcessPayload[]>;
}

export type OverlaySupervisedLifetimeGuardViolationKind =
  | "anti-cheat-process"
  | "anti-cheat-module"
  | "anti-cheat-service"
  | "anti-cheat-driver"
  | "target-identity-lost"
  | "monitor-fault";

export interface OverlaySupervisedLifetimeGuardViolation {
  kind: OverlaySupervisedLifetimeGuardViolationKind;
}

export interface OverlaySupervisedLifetimeGuardSession {
  /** True only after the process-tree/module/service/driver monitor is closed. */
  release(signal: AbortSignal): boolean | Promise<boolean>;
}

/**
 * Native lifetime monitor. `arm` must return only after all four inventories
 * (process tree, loaded modules, services and drivers) are live, and must keep
 * them live until `release` succeeds.
 */
export interface OverlaySupervisedLifetimeGuard {
  arm(
    identity: OverlayQaSupervisedTargetIdentity,
    trustedTarget: OverlayNativeVerifiedTarget,
    configuredExecutables: readonly string[],
    onViolation: (violation: OverlaySupervisedLifetimeGuardViolation) => void,
    signal: AbortSignal
  ): Promise<OverlaySupervisedLifetimeGuardSession>;
}

/** Static policy is retained and handed to native evidence preparation. */
export interface OverlaySupervisedCapabilityEvidenceSource {
  open(
    identity: OverlayQaSupervisedTargetIdentity,
    staticEvidence: OverlayStaticTargetPreflightAccepted,
    signal: AbortSignal
  ): Promise<OverlayQaCapabilityEvidenceSession>;
}

export interface OverlaySupervisedLaunchProductionAdapterOptions {
  /** Constructor-owned runtime authority; launch requests cannot forge it. */
  runtimeProvider: () => OverlaySupervisedQaRuntime;
  helperFactory: OverlaySupervisorHelperFactory;
  targetVerifier: OverlaySupervisorTargetVerifier;
  processIdentityVerifier: OverlaySupervisedProcessIdentityVerifier;
  processInventory: OverlaySupervisedProcessInventory;
  lifetimeGuard: OverlaySupervisedLifetimeGuard;
  staticTargetPreflight: OverlayStaticTargetPreflightDependency;
  evidenceSource: OverlaySupervisedCapabilityEvidenceSource;
  staticPreflightDeadlineMs?: number;
  serviceTimeouts?: Partial<OverlaySupervisedLaunchTimeouts>;
  evidenceDeadlines?: Partial<OverlayQaCapabilityEvidenceDeadlines>;
}

export type OverlaySupervisedLaunchProductionAdapterState =
  | "idle"
  | "checking"
  | "launching"
  | "interactive"
  | "revoking"
  | "revoked"
  | "failed"
  | "launch-outcome-unknown";

export type OverlaySupervisedLaunchProductionAdapterErrorCode =
  | "busy"
  | "policy-rejected"
  | "injection-policy-rejected"
  | "static-target-rejected"
  | "static-target-preflight-failed"
  | "anti-cheat-detected"
  | "process-inventory-failed"
  | "target-identity-rejected"
  | "launch-failed";

export class OverlaySupervisedLaunchProductionAdapterError extends Error {
  public constructor(
    public readonly code: OverlaySupervisedLaunchProductionAdapterErrorCode,
    message: string,
    public readonly normalLaunchFallbackAllowed: boolean,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "OverlaySupervisedLaunchProductionAdapterError";
  }
}

const adapterError = (
  code: OverlaySupervisedLaunchProductionAdapterErrorCode,
  message: string,
  normalLaunchFallbackAllowed: boolean,
  cause?: unknown
) =>
  new OverlaySupervisedLaunchProductionAdapterError(
    code,
    message,
    normalLaunchFallbackAllowed,
    { cause }
  );

const causeForbidsNormalFallback = (error: unknown) => {
  const seen = new Set<unknown>();
  let current = error;
  while (current && !seen.has(current)) {
    seen.add(current);
    if (
      current instanceof OverlaySupervisedLaunchProductionAdapterError &&
      !current.normalLaunchFallbackAllowed
    ) {
      return true;
    }
    current =
      typeof current === "object" && "cause" in current
        ? (current as { cause?: unknown }).cause
        : null;
  }
  return false;
};

class OverlayStaticPreflightInterruptedError extends Error {
  public constructor(public readonly reason: "aborted" | "deadline-exceeded") {
    super(
      reason === "aborted"
        ? "The static target preflight was aborted."
        : "The static target preflight exceeded its deadline."
    );
    this.name = "OverlayStaticPreflightInterruptedError";
  }
}

const runStaticPreflightOperation = <T>(
  deadlineMs: number,
  parentSignal: AbortSignal | undefined,
  operation: (signal: AbortSignal) => Promise<T>
): Promise<T> => {
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onParentAbort);
      complete();
    };
    const interrupt = (reason: "aborted" | "deadline-exceeded") => {
      if (settled) return;
      controller.abort();
      finish(() => reject(new OverlayStaticPreflightInterruptedError(reason)));
    };
    const onParentAbort = () => interrupt("aborted");
    const timer = setTimeout(() => interrupt("deadline-exceeded"), deadlineMs);
    timer.unref();

    if (parentSignal?.aborted) {
      interrupt("aborted");
      return;
    }
    parentSignal?.addEventListener("abort", onParentAbort, { once: true });
    let pending: Promise<T>;
    try {
      pending = operation(controller.signal);
    } catch (error) {
      finish(() => reject(error));
      return;
    }
    void Promise.resolve(pending).then(
      (result) => finish(() => resolve(result)),
      (error) => finish(() => reject(error))
    );
  });
};

const releaseLateResource = (
  resource: Pick<OverlayQaCapabilityEvidenceSession, "release">
): Promise<boolean> => {
  const controller = new AbortController();
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (released: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(released);
    };
    const timer = setTimeout(() => {
      controller.abort(
        new DOMException("Evidence cleanup deadline exceeded", "TimeoutError")
      );
      finish(false);
    }, EVIDENCE_OPEN_CLEANUP_DEADLINE_MS);
    timer.unref();
    try {
      void Promise.resolve(resource.release(controller.signal)).then(
        (released) => finish(released === true && !controller.signal.aborted),
        () => finish(false)
      );
    } catch {
      finish(false);
    }
  });
};

const snapshotStaticCapabilityProfile = (
  profile: OverlayStaticTargetCapabilityProfile
): OverlayStaticTargetCapabilityProfile => {
  const copyOrderedSubset = <T extends string>(
    value: readonly string[],
    allowed: readonly T[],
    name: string
  ): readonly T[] => {
    if (
      !Array.isArray(value) ||
      value.length > 128 ||
      value.some(
        (item) =>
          typeof item !== "string" || item.length === 0 || item.length > 128
      )
    ) {
      throw new TypeError(`Invalid static target ${name}.`);
    }
    let priorIndex = -1;
    const copied = value.map((item) => {
      const index = allowed.indexOf(item as T);
      if (index < 0 || index <= priorIndex) {
        throw new TypeError(
          `Static target ${name} were unknown, duplicated, or out of order.`
        );
      }
      priorIndex = index;
      return item as T;
    });
    return Object.freeze(copied);
  };
  if (typeof profile?.requiresChildPropagation !== "boolean") {
    throw new TypeError("Invalid static target child-propagation profile.");
  }
  const requiredInputBackends = copyOrderedSubset(
    profile.requiredInputBackends,
    OVERLAY_INPUT_BACKENDS,
    "input backends"
  ) as OverlayStaticTargetCapabilityProfile["requiredInputBackends"];
  const requiredChildRoutes = copyOrderedSubset(
    profile.requiredChildRoutes,
    OVERLAY_CHILD_CREATION_BACKENDS,
    "child routes"
  ) as OverlayStaticTargetCapabilityProfile["requiredChildRoutes"];
  const candidateRenderBackends = copyOrderedSubset(
    profile.candidateRenderBackends,
    OVERLAY_RENDER_BACKENDS,
    "render backends"
  ) as OverlayStaticTargetCapabilityProfile["candidateRenderBackends"];
  const observedSteamInterfaceRevisions = copyOrderedSubset(
    profile.observedSteamInterfaceRevisions,
    KNOWN_STEAM_INPUT_REVISIONS,
    "Steam interface revisions"
  );
  const blockers = copyOrderedSubset(
    profile.blockers,
    OVERLAY_STATIC_TARGET_BLOCKERS,
    "blockers"
  ) as OverlayStaticTargetCapabilityProfile["blockers"];
  if (
    REQUIRED_BASE_INPUT_BACKENDS.some(
      (backend, index) => requiredInputBackends[index] !== backend
    ) ||
    OVERLAY_CHILD_CREATION_BACKENDS.some((backend) =>
      requiredInputBackends.includes(backend)
    ) ||
    (profile.requiresChildPropagation
      ? requiredChildRoutes.length === 0
      : requiredChildRoutes.length !== 0) ||
    (requiredInputBackends.includes("steam-input-interface-revisions")
      ? observedSteamInterfaceRevisions.length === 0
      : observedSteamInterfaceRevisions.length !== 0)
  ) {
    throw new TypeError("Static target capability relationships were invalid.");
  }
  return Object.freeze({
    requiresChildPropagation: profile.requiresChildPropagation,
    requiredInputBackends,
    requiredChildRoutes,
    candidateRenderBackends,
    observedSteamInterfaceRevisions,
    blockers,
  });
};

const deepFreeze = <T>(value: T, seen = new WeakSet<object>()): T => {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const member of Object.values(value)) deepFreeze(member, seen);
  return Object.freeze(value);
};

const snapshotTrustedRuntime = (
  unsafeRuntime: OverlaySupervisedQaRuntime
): Readonly<OverlaySupervisedQaRuntime> => {
  if (
    !unsafeRuntime ||
    typeof unsafeRuntime !== "object" ||
    typeof unsafeRuntime.platform !== "string" ||
    unsafeRuntime.platform.length < 1 ||
    unsafeRuntime.platform.length > 64 ||
    typeof unsafeRuntime.isPackaged !== "boolean" ||
    !unsafeRuntime.environment ||
    typeof unsafeRuntime.environment !== "object" ||
    Array.isArray(unsafeRuntime.environment)
  ) {
    throw new TypeError("Invalid trusted overlay QA runtime snapshot.");
  }
  const keys = Reflect.ownKeys(unsafeRuntime.environment);
  if (
    keys.length > 256 ||
    keys.some(
      (key) =>
        typeof key !== "string" ||
        key.length < 1 ||
        key.length > 32_767 ||
        key.includes("\0")
    )
  ) {
    throw new TypeError("Invalid trusted overlay QA runtime environment.");
  }
  const environment: Record<string, string | undefined> = {};
  for (const key of keys as string[]) {
    const value = unsafeRuntime.environment[key];
    if (
      value !== undefined &&
      (typeof value !== "string" ||
        value.length > 32_767 ||
        value.includes("\0"))
    ) {
      throw new TypeError("Invalid trusted overlay QA runtime environment.");
    }
    environment[key] = value;
  }
  return Object.freeze({
    platform: unsafeRuntime.platform,
    isPackaged: unsafeRuntime.isPackaged,
    environment: Object.freeze(environment),
  });
};

const snapshotStaticPreflightEvidence = (
  decision: OverlayStaticTargetPreflightAccepted,
  plan: OverlaySupervisedLaunchPlan
): OverlayStaticTargetPreflightAccepted => {
  const inventory = decision?.inventory;
  const launchImage = inventory?.launchImage;
  const renderImage = inventory?.renderImage;
  if (
    decision?.allowed !== true ||
    !inventory ||
    !launchImage ||
    !renderImage ||
    launchImage.completeImportSnapshot !== true ||
    renderImage.completeImportSnapshot !== true ||
    !LOWERCASE_SHA256.test(launchImage.contentSha256) ||
    !LOWERCASE_SHA256.test(renderImage.contentSha256) ||
    launchImage.contentSha256 !== renderImage.contentSha256 ||
    inventory.completeAdjacentModuleSnapshot !== true ||
    !Array.isArray(launchImage.imports) ||
    launchImage.imports.length > 65_536 ||
    !Array.isArray(renderImage.imports) ||
    renderImage.imports.length > 65_536 ||
    !Array.isArray(inventory.adjacentModules) ||
    inventory.adjacentModules.length > 2_048 ||
    !Array.isArray(decision.scannedAdjacentDirectories) ||
    decision.scannedAdjacentDirectories.length < 1 ||
    decision.scannedAdjacentDirectories.length > 2 ||
    decision.scannedAdjacentDirectories.some(
      (directory) =>
        typeof directory !== "string" || !path.win32.isAbsolute(directory)
    ) ||
    typeof launchImage.canonicalPath !== "string" ||
    typeof renderImage.canonicalPath !== "string" ||
    !sameWindowsPath(launchImage.canonicalPath, plan.executablePath) ||
    !sameWindowsPath(renderImage.canonicalPath, plan.canonicalExecutablePath) ||
    (launchImage.architecture !== "x86" &&
      launchImage.architecture !== "x64") ||
    renderImage.architecture !== launchImage.architecture ||
    (inventory.hidReportSchemaDigest !== undefined &&
      !LOWERCASE_SHA256.test(inventory.hidReportSchemaDigest)) ||
    (inventory.libScePadAbiDigest !== undefined &&
      !LOWERCASE_SHA256.test(inventory.libScePadAbiDigest)) ||
    Object.prototype.hasOwnProperty.call(
      inventory,
      "hidReportSchemasVerified"
    ) ||
    Object.prototype.hasOwnProperty.call(inventory, "libScePadAbiVerified")
  ) {
    throw new TypeError("Invalid static target preflight evidence.");
  }
  const expectedDirectories = new Set(
    [
      path.win32.dirname(launchImage.canonicalPath),
      path.win32.dirname(renderImage.canonicalPath),
    ].map((directory) => path.win32.normalize(directory).toLowerCase())
  );
  const scannedDirectories = decision.scannedAdjacentDirectories.map(
    (directory) => path.win32.normalize(directory).toLowerCase()
  );
  const scannedDirectorySet = new Set(scannedDirectories);
  let priorModule = "";
  if (
    scannedDirectorySet.size !== scannedDirectories.length ||
    scannedDirectorySet.size !== expectedDirectories.size ||
    [...expectedDirectories].some(
      (directory) => !scannedDirectorySet.has(directory)
    ) ||
    inventory.adjacentModules.some((module) => {
      if (
        typeof module !== "string" ||
        module.length < 5 ||
        module.length > 1_024 ||
        module.includes("\0") ||
        path.win32.basename(module) !== module ||
        !module.endsWith(".dll") ||
        module !== module.toLowerCase() ||
        module <= priorModule
      ) {
        return true;
      }
      priorModule = module;
      return false;
    })
  ) {
    throw new TypeError(
      "Static target adjacent-module evidence was not exact and canonical."
    );
  }
  let clonedInventory: OverlayStaticTargetPreflightAccepted["inventory"];
  try {
    clonedInventory = structuredClone(inventory);
  } catch (error) {
    throw new TypeError("Static target inventory was not cloneable.", {
      cause: error,
    });
  }
  const suppliedProfile = snapshotStaticCapabilityProfile(decision.profile);
  const recomputedProfile = snapshotStaticCapabilityProfile(
    evaluateOverlayStaticTargetCapabilities(clonedInventory)
  );
  if (JSON.stringify(suppliedProfile) !== JSON.stringify(recomputedProfile)) {
    throw new TypeError(
      "Static target capability profile did not exactly match its retained inventory."
    );
  }
  return deepFreeze({
    allowed: true,
    inventory: clonedInventory,
    profile: recomputedProfile,
    scannedAdjacentDirectories: [...decision.scannedAdjacentDirectories],
  });
};

const snapshotCapabilityBootstrap = (
  bootstrap: OverlayQaCapabilityBootstrap
): OverlayQaCapabilityBootstrap => {
  const isOrderedSubset = <T extends string>(
    value: unknown,
    allowed: readonly T[]
  ): value is readonly T[] => {
    if (!Array.isArray(value) || value.length > allowed.length) return false;
    let priorIndex = -1;
    return value.every((item) => {
      const index = allowed.indexOf(item as T);
      if (typeof item !== "string" || index < 0 || index <= priorIndex) {
        return false;
      }
      priorIndex = index;
      return true;
    });
  };
  const isUint64 = (value: unknown) => {
    if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/u.test(value)) {
      return false;
    }
    try {
      return BigInt(value) <= 0xffff_ffff_ffff_ffffn;
    } catch {
      return false;
    }
  };
  if (
    !bootstrap ||
    !bootstrap.identity ||
    !Number.isSafeInteger(bootstrap.inputGeneration) ||
    bootstrap.inputGeneration < 1 ||
    !Number.isSafeInteger(bootstrap.renderGeneration) ||
    bootstrap.renderGeneration < 1 ||
    !isUint64(bootstrap.topologyEpoch) ||
    !isUint64(bootstrap.nativeCommitSequence) ||
    !isUint64(bootstrap.absenceMonitorEpoch) ||
    !isOrderedSubset(
      bootstrap.requiredChildRoutes,
      OVERLAY_CHILD_CREATION_BACKENDS
    ) ||
    (bootstrap.targetArchitecture !== "x86" &&
      bootstrap.targetArchitecture !== "x64") ||
    !OVERLAY_RENDER_BACKENDS.includes(bootstrap.activeBackend) ||
    !isOrderedSubset(
      bootstrap.requiredRenderSurfaces,
      OVERLAY_RENDER_SURFACES
    ) ||
    bootstrap.requiredRenderSurfaces.length === 0
  ) {
    throw new TypeError("Invalid native capability bootstrap.");
  }
  return Object.freeze({
    identity: Object.freeze({ ...bootstrap.identity }),
    inputGeneration: bootstrap.inputGeneration,
    renderGeneration: bootstrap.renderGeneration,
    topologyEpoch: bootstrap.topologyEpoch,
    nativeCommitSequence: bootstrap.nativeCommitSequence,
    absenceMonitorEpoch: bootstrap.absenceMonitorEpoch,
    requiredChildRoutes: Object.freeze([...bootstrap.requiredChildRoutes]),
    targetArchitecture: bootstrap.targetArchitecture,
    activeBackend: bootstrap.activeBackend,
    requiredRenderSurfaces: Object.freeze([
      ...bootstrap.requiredRenderSurfaces,
    ]),
    ...(bootstrap.controllerMiddlewareExpectation === undefined
      ? {}
      : {
          controllerMiddlewareExpectation: deepFreeze(
            structuredClone(bootstrap.controllerMiddlewareExpectation)
          ),
        }),
  });
};

class CapturingTargetVerifier implements OverlaySupervisorTargetVerifier {
  private captured: OverlayNativeVerifiedTarget | null = null;

  public constructor(
    private readonly delegate: OverlaySupervisorTargetVerifier,
    private readonly retainedContentSha256: string
  ) {}

  public verify(plan: OverlaySupervisedLaunchPlan) {
    const verified = this.delegate.verify(plan);
    if (!verified) return null;
    const snapshot = Object.freeze({ ...verified });
    if (
      !LOWERCASE_SHA256.test(snapshot.contentSha256) ||
      snapshot.contentSha256 !== this.retainedContentSha256 ||
      (this.captured &&
        (this.captured.canonicalExecutablePath !==
          snapshot.canonicalExecutablePath ||
          this.captured.canonicalGameRoot !== snapshot.canonicalGameRoot ||
          this.captured.volumeSerial !== snapshot.volumeSerial ||
          this.captured.fileId !== snapshot.fileId ||
          this.captured.contentSha256 !== snapshot.contentSha256))
    ) {
      return null;
    }
    this.captured = snapshot;
    return snapshot;
  }

  public getCaptured(): OverlayNativeVerifiedTarget | null {
    return this.captured;
  }
}

class GuardedCapabilityEvidenceSource
  implements OverlayQaCapabilityEvidenceSource
{
  private lifetimeSession: OverlaySupervisedLifetimeGuardSession | null = null;
  private lifetimeViolation: OverlaySupervisedLifetimeGuardViolation | null =
    null;
  private readonly lifetimeViolationPublished: Promise<void>;
  private publishLifetimeViolation!: () => void;

  public constructor(
    private readonly source: OverlaySupervisedCapabilityEvidenceSource,
    private readonly staticEvidence: OverlayStaticTargetPreflightAccepted,
    private readonly targetVerifier: CapturingTargetVerifier,
    private readonly identityVerifier: OverlaySupervisedProcessIdentityVerifier,
    private readonly inventory: OverlaySupervisedProcessInventory,
    private readonly configuredExecutables: readonly string[],
    private readonly lifetimeGuard: OverlaySupervisedLifetimeGuard,
    private readonly onLifetimeViolation: () => void
  ) {
    this.lifetimeViolationPublished = new Promise<void>((resolve) => {
      this.publishLifetimeViolation = resolve;
    });
  }

  public async open(
    identity: OverlayQaSupervisedTargetIdentity,
    signal: AbortSignal
  ): Promise<OverlayQaCapabilityEvidenceSession> {
    await this.assertGuarded(identity, "suspended", signal);
    const trustedTarget = this.targetVerifier.getCaptured();
    if (!trustedTarget) {
      throw adapterError(
        "target-identity-rejected",
        "The lifetime monitor could not bind the retained target identity.",
        true
      );
    }
    this.lifetimeSession = await this.lifetimeGuard.arm(
      identity,
      trustedTarget,
      this.configuredExecutables,
      (violation) => this.recordLifetimeViolation(violation),
      signal
    );
    if (
      !this.lifetimeSession ||
      typeof this.lifetimeSession.release !== "function"
    ) {
      throw adapterError(
        "anti-cheat-detected",
        "The lifetime anti-cheat monitor did not arm completely.",
        true
      );
    }
    this.throwIfLifetimeViolated(true);
    let session: OverlayQaCapabilityEvidenceSession;
    try {
      session = await this.source.open(identity, this.staticEvidence, signal);
    } catch (error) {
      const lifetimeSession = this.lifetimeSession;
      this.lifetimeSession = null;
      if (lifetimeSession && !(await releaseLateResource(lifetimeSession))) {
        throw adapterError(
          "launch-failed",
          "The failed evidence open left its lifetime guard armed; normal launch fallback is forbidden.",
          false,
          error
        );
      }
      throw error;
    }
    let bootstrap: OverlayQaCapabilityBootstrap;
    try {
      if (signal.aborted) {
        throw new DOMException("Operation aborted", "AbortError");
      }
      this.throwIfLifetimeViolated(true);
      bootstrap = snapshotCapabilityBootstrap(session.bootstrap);
      // Channel creation may take most of the prepared budget. Revalidate at
      // the final point before returning control to markPrepared()/commit().
      await this.assertGuarded(identity, "suspended", signal);
      this.throwIfLifetimeViolated(true);
      if (!this.bootstrapMatchesStaticEvidence(bootstrap, identity)) {
        throw adapterError(
          "static-target-rejected",
          "The native evidence bootstrap did not match the retained static target profile.",
          true
        );
      }
    } catch (error) {
      const released = await this.releaseOpenedResources(session);
      if (!released) {
        throw adapterError(
          "launch-failed",
          "The pre-commit evidence session failed to release; normal launch fallback is forbidden.",
          false,
          error
        );
      }
      throw error;
    }
    return Object.freeze({
      bootstrap,
      authenticate: async (authenticationSignal: AbortSignal) => {
        await this.assertGuarded(identity, "resumed", authenticationSignal);
        this.throwIfLifetimeViolated(false);
        const result = await Promise.race([
          session.authenticate(authenticationSignal),
          this.lifetimeViolationPublished.then(() => {
            this.throwIfLifetimeViolated(false);
            throw new Error("Unreachable lifetime violation state.");
          }),
        ]);
        this.throwIfLifetimeViolated(false);
        if (result.authenticated) {
          if (
            !this.authenticatedInputCoversStaticProfile(
              result.inputReport,
              bootstrap
            )
          ) {
            return Object.freeze({
              authenticated: false as const,
              reason: "static-input-capability-mismatch",
            });
          }
          await this.assertGuarded(identity, "resumed", authenticationSignal);
          this.throwIfLifetimeViolated(false);
        }
        return result;
      },
      release: (releaseSignal: AbortSignal) =>
        this.releaseInteractiveResources(session, releaseSignal),
    });
  }

  private recordLifetimeViolation(
    violation: OverlaySupervisedLifetimeGuardViolation
  ) {
    if (this.lifetimeViolation) return;
    const allowed = new Set<OverlaySupervisedLifetimeGuardViolationKind>([
      "anti-cheat-process",
      "anti-cheat-module",
      "anti-cheat-service",
      "anti-cheat-driver",
      "target-identity-lost",
      "monitor-fault",
    ]);
    this.lifetimeViolation = Object.freeze({
      kind: allowed.has(violation?.kind) ? violation.kind : "monitor-fault",
    });
    this.publishLifetimeViolation();
    this.onLifetimeViolation();
  }

  private throwIfLifetimeViolated(fallbackAllowed: boolean): void {
    if (!this.lifetimeViolation) return;
    throw adapterError(
      "anti-cheat-detected",
      `The lifetime overlay guard revoked the target (${this.lifetimeViolation.kind}).`,
      fallbackAllowed
    );
  }

  private async releaseOpenedResources(
    session: OverlayQaCapabilityEvidenceSession
  ): Promise<boolean> {
    const lifetimeSession = this.lifetimeSession;
    this.lifetimeSession = null;
    const releases = [releaseLateResource(session)];
    if (lifetimeSession) releases.push(releaseLateResource(lifetimeSession));
    const results = await Promise.all(releases);
    return results.every((released) => released);
  }

  private async releaseInteractiveResources(
    session: OverlayQaCapabilityEvidenceSession,
    signal: AbortSignal
  ): Promise<boolean> {
    const lifetimeSession = this.lifetimeSession;
    this.lifetimeSession = null;
    const releaseOne = async (
      resource: Pick<OverlayQaCapabilityEvidenceSession, "release">
    ) => {
      try {
        return (await resource.release(signal)) === true && !signal.aborted;
      } catch {
        return false;
      }
    };
    const releases = await Promise.all([
      releaseOne(session),
      ...(lifetimeSession ? [releaseOne(lifetimeSession)] : []),
    ]);
    return releases.every((released) => released);
  }

  private bootstrapMatchesStaticEvidence(
    bootstrap: OverlayQaCapabilityBootstrap,
    identity: OverlayQaSupervisedTargetIdentity
  ) {
    const profile = this.staticEvidence.profile;
    const expectedArchitecture =
      this.staticEvidence.inventory.renderImage.architecture;
    return Boolean(
      bootstrap &&
        bootstrap.targetArchitecture === expectedArchitecture &&
        profile.candidateRenderBackends.includes(bootstrap.activeBackend) &&
        bootstrap.requiredChildRoutes.length ===
          profile.requiredChildRoutes.length &&
        bootstrap.requiredChildRoutes.every(
          (route, index) => route === profile.requiredChildRoutes[index]
        ) &&
        bootstrap.identity.sessionId === identity.sessionId &&
        bootstrap.identity.pid === identity.pid &&
        bootstrap.identity.creationTicks === identity.creationTicks &&
        bootstrap.identity.canonicalExecutablePath ===
          identity.canonicalExecutablePath &&
        bootstrap.identity.volumeSerial === identity.volumeSerial &&
        bootstrap.identity.fileId === identity.fileId &&
        this.controllerExpectationMatchesStaticEvidence(
          bootstrap.controllerMiddlewareExpectation
        )
    );
  }

  private controllerExpectationMatchesStaticEvidence(
    expectation: OverlayControllerMiddlewareCapabilityExpectation | undefined
  ) {
    const profile = this.staticEvidence.profile;
    const inventory = this.staticEvidence.inventory;
    const required = new Set<string>();
    if (profile.requiredInputBackends.includes("hid-input-reports")) {
      required.add("hid-overlapped");
    }
    for (const revision of profile.observedSteamInterfaceRevisions) {
      if (revision === "steaminput006") required.add("steam-input-006");
      if (revision === "steamcontroller008") {
        required.add("steam-controller-008");
      }
    }
    if (profile.requiredInputBackends.includes("libscepad")) {
      required.add("libscepad");
    }

    if (required.size === 0) return expectation === undefined;
    if (
      !expectation ||
      expectation.backendExpectations.length !==
        OVERLAY_CONTROLLER_MIDDLEWARE_BACKENDS.length ||
      expectation.observedInventory.length < required.size
    ) {
      return false;
    }

    for (
      let index = 0;
      index < OVERLAY_CONTROLLER_MIDDLEWARE_BACKENDS.length;
      index += 1
    ) {
      const backend = OVERLAY_CONTROLLER_MIDDLEWARE_BACKENDS[index];
      const backendExpectation = expectation.backendExpectations[index];
      if (!backend || backendExpectation?.backend !== backend) return false;
      const isRequired = required.has(backend);
      if (
        backendExpectation.disposition !== (isRequired ? "required" : "absent")
      ) {
        return false;
      }
      if (!isRequired) continue;

      if (
        backend === "hid-overlapped" &&
        backendExpectation.abiSchemaDigest?.toLowerCase() !==
          inventory.hidReportSchemaDigest
      ) {
        return false;
      }
      if (
        backend === "libscepad" &&
        backendExpectation.abiSchemaDigest?.toLowerCase() !==
          inventory.libScePadAbiDigest
      ) {
        return false;
      }
      if (
        backend === "steam-input-006" &&
        backendExpectation.interfaceRevision !== "SteamInput006"
      ) {
        return false;
      }
      if (
        backend === "steam-controller-008" &&
        backendExpectation.interfaceRevision !== "SteamController008"
      ) {
        return false;
      }
    }
    return true;
  }

  private authenticatedInputCoversStaticProfile(
    inputReport: unknown,
    bootstrap: OverlayQaCapabilityBootstrap
  ) {
    const validation = validateOverlayInputCapabilityReport(inputReport, {
      identity: bootstrap.identity,
      generation: bootstrap.inputGeneration,
      topologyEpoch: bootstrap.topologyEpoch,
      nativeCommitSequence: bootstrap.nativeCommitSequence,
      absenceMonitorEpoch: bootstrap.absenceMonitorEpoch,
      requiredChildRoutes: bootstrap.requiredChildRoutes,
    });
    if (!validation.valid) return false;
    const covered = new Set(
      validation.report.observations
        .filter((observation) => observation.state === "covered")
        .map((observation) => observation.backend)
    );
    return this.staticEvidence.profile.requiredInputBackends.every((backend) =>
      covered.has(backend)
    );
  }

  private async assertGuarded(
    identity: OverlayQaSupervisedTargetIdentity,
    phase: OverlaySupervisedIdentityVerificationPhase,
    signal: AbortSignal
  ) {
    if (signal.aborted)
      throw new DOMException("Operation aborted", "AbortError");
    const trustedTarget = this.targetVerifier.getCaptured();
    if (
      !trustedTarget ||
      !sameTargetIdentity(identity, trustedTarget) ||
      !(await this.identityVerifier.verify(
        identity,
        trustedTarget,
        phase,
        signal
      )) ||
      signal.aborted
    ) {
      throw adapterError(
        "target-identity-rejected",
        `The exact ${phase} overlay target identity was not revalidated.`,
        phase === "suspended"
      );
    }
    await assertNoAntiCheat(
      this.inventory,
      trustedTarget.canonicalExecutablePath,
      this.configuredExecutables,
      signal,
      phase === "suspended",
      trustedTarget.canonicalGameRoot
    );
  }
}

const configuredExecutables = (
  game: OverlaySupervisedLaunchPolicyInput["game"]
) =>
  Object.freeze(
    [
      game.executablePath,
      game.nativeExecutablePath,
      ...(game.trackingExecutablePaths ?? []),
    ].filter(
      (value): value is string =>
        typeof value === "string" && Boolean(value.trim())
    )
  );

const assertNoAntiCheat = async (
  inventory: OverlaySupervisedProcessInventory,
  targetExecutable: string,
  configured: readonly string[],
  signal: AbortSignal,
  fallbackAllowed: boolean,
  trustedGameRoot?: string
) => {
  let processes: readonly ProcessPayload[];
  try {
    processes = await inventory.list(signal);
  } catch (error) {
    throw adapterError(
      "process-inventory-failed",
      "Unable to obtain the fail-closed overlay anti-cheat inventory.",
      fallbackAllowed,
      error
    );
  }
  if (signal.aborted) throw new DOMException("Operation aborted", "AbortError");

  const selectedTargetProbe: ProcessPayload = {
    pid: 5,
    name: path.win32.basename(targetExecutable),
    exe: targetExecutable,
  };
  const configuredScanAnchors = trustedGameRoot
    ? [
        path.win32.join(trustedGameRoot, "gamehub-overlay-root-anchor.exe"),
        ...configured,
      ]
    : [...configured];
  const antiCheat =
    findOverlayAntiCheatProcess(
      [selectedTargetProbe],
      targetExecutable,
      configuredScanAnchors
    ) ??
    findOverlayAntiCheatProcess(
      [...processes],
      targetExecutable,
      configuredScanAnchors
    );
  if (antiCheat) {
    throw adapterError(
      "anti-cheat-detected",
      "An anti-cheat target or process was detected in the trusted game tree.",
      fallbackAllowed
    );
  }
};

/**
 * One-attempt guarded composition boundary. It remains QA-gated by the
 * existing policy/authorization registry and is not a normal-launch wrapper.
 * Callers may use fallback only when the returned error explicitly says so.
 */
export class OverlaySupervisedLaunchProductionAdapter {
  private state: OverlaySupervisedLaunchProductionAdapterState = "idle";
  private coordinator: OverlayQaEndToEndCoordinator | null = null;
  private staticEvidence: OverlayStaticTargetPreflightAccepted | null = null;
  private readonly staticPreflightDeadlineMs: number;

  public constructor(
    private readonly options: OverlaySupervisedLaunchProductionAdapterOptions
  ) {
    this.staticPreflightDeadlineMs =
      options.staticPreflightDeadlineMs ?? DEFAULT_STATIC_PREFLIGHT_DEADLINE_MS;
    if (
      !Number.isSafeInteger(this.staticPreflightDeadlineMs) ||
      this.staticPreflightDeadlineMs < 1 ||
      this.staticPreflightDeadlineMs > MAX_STATIC_PREFLIGHT_DEADLINE_MS
    ) {
      throw new RangeError(
        `Static target preflight deadline must be an integer from 1 through ${MAX_STATIC_PREFLIGHT_DEADLINE_MS}.`
      );
    }
  }

  public getState(): OverlaySupervisedLaunchProductionAdapterState {
    return this.state;
  }

  public getStaticCapabilityProfile(): OverlayStaticTargetCapabilityProfile | null {
    return this.staticEvidence?.profile ?? null;
  }

  public getStaticPreflightEvidence(): OverlayStaticTargetPreflightAccepted | null {
    return this.staticEvidence;
  }

  public async start(
    request: OverlaySupervisedLaunchPolicyInput,
    preflightSignal?: AbortSignal
  ): Promise<OverlayQaEndToEndAcceptance> {
    if (this.state !== "idle") {
      throw adapterError(
        "busy",
        "The guarded overlay launch adapter already owns an attempt.",
        false
      );
    }

    this.state = "checking";
    let trustedRuntime: Readonly<OverlaySupervisedQaRuntime>;
    try {
      trustedRuntime = snapshotTrustedRuntime(this.options.runtimeProvider());
    } catch (error) {
      this.state = "failed";
      throw adapterError(
        "policy-rejected",
        "The trusted overlay QA runtime provider failed closed.",
        true,
        error
      );
    }
    let policy: ReturnType<typeof evaluateOverlaySupervisedLaunchPolicy>;
    try {
      policy = evaluateOverlaySupervisedLaunchPolicy({
        ...request,
        runtime: trustedRuntime,
      });
    } catch (error) {
      this.state = "failed";
      throw adapterError(
        "policy-rejected",
        "The supervised overlay launch request was malformed.",
        true,
        error
      );
    }
    if (!policy.allowed) {
      this.state = "failed";
      throw adapterError(
        "policy-rejected",
        `The supervised overlay launch policy rejected the target (${policy.reason}).`,
        true
      );
    }
    let injection: ReturnType<typeof evaluateOverlayInjectionEligibility>;
    try {
      injection = evaluateOverlayInjectionEligibility(
        {
          ...request.game,
          trackingExecutablePaths: request.game.trackingExecutablePaths
            ? [...request.game.trackingExecutablePaths]
            : request.game.trackingExecutablePaths,
        },
        policy.plan.canonicalExecutablePath
      );
    } catch (error) {
      this.state = "failed";
      throw adapterError(
        "injection-policy-rejected",
        "The overlay injection policy could not validate the target.",
        true,
        error
      );
    }
    if (!injection.allowed) {
      this.state = "failed";
      throw adapterError(
        "injection-policy-rejected",
        `The overlay injection policy rejected the target (${injection.reason}).`,
        true
      );
    }

    // Snapshot every caller-owned anti-cheat scan anchor before the first
    // awaited operation. A caller mutation during PE inspection must not
    // change the process inventory or lifetime-monitor scope.
    const configured = configuredExecutables(request.game);

    let staticResult: Awaited<
      ReturnType<OverlayStaticTargetPreflightDependency["inspect"]>
    >;
    try {
      staticResult = await runStaticPreflightOperation(
        this.staticPreflightDeadlineMs,
        preflightSignal,
        (signal) =>
          this.options.staticTargetPreflight.inspect(
            {
              launchTargetPath: policy.plan.executablePath,
              renderTargetPath: policy.plan.canonicalExecutablePath,
            },
            signal
          )
      );
    } catch (error) {
      this.state = "failed";
      throw adapterError(
        "static-target-preflight-failed",
        error instanceof OverlayStaticPreflightInterruptedError
          ? error.message
          : "The static target capability preflight failed.",
        true,
        error
      );
    }
    if (!staticResult.allowed) {
      this.state = "failed";
      throw adapterError(
        "static-target-rejected",
        `The static target capability preflight rejected the target (${staticResult.reason}).`,
        true
      );
    }
    let staticEvidence: OverlayStaticTargetPreflightAccepted;
    try {
      staticEvidence = snapshotStaticPreflightEvidence(
        staticResult,
        policy.plan
      );
    } catch (error) {
      this.state = "failed";
      throw adapterError(
        "static-target-preflight-failed",
        "The static target capability profile was malformed.",
        true,
        error
      );
    }
    if (
      staticEvidence.profile.blockers.length > 0 ||
      staticEvidence.profile.requiresChildPropagation ||
      staticEvidence.profile.candidateRenderBackends.length === 0
    ) {
      this.state = "failed";
      throw adapterError(
        "static-target-rejected",
        "The static target requires unsupported or unresolved overlay capabilities.",
        true
      );
    }
    this.staticEvidence = staticEvidence;

    try {
      await runStaticPreflightOperation(
        this.staticPreflightDeadlineMs,
        preflightSignal,
        (signal) =>
          assertNoAntiCheat(
            this.options.processInventory,
            policy.plan.canonicalExecutablePath,
            configured,
            signal,
            true
          )
      );
    } catch (error) {
      this.state = "failed";
      if (error instanceof OverlayStaticPreflightInterruptedError) {
        throw adapterError(
          "process-inventory-failed",
          "The fail-closed overlay anti-cheat inventory did not complete before launch.",
          true,
          error
        );
      }
      throw error;
    }

    if (preflightSignal?.aborted) {
      this.state = "failed";
      throw adapterError(
        "static-target-preflight-failed",
        "The static target preflight was aborted before launch.",
        true
      );
    }

    let authorizationRegistry: OverlayQaAuthorizationRegistry;
    let targetVerifier: CapturingTargetVerifier;
    let launchService: OverlaySupervisedLaunchService;
    try {
      authorizationRegistry = new OverlayQaAuthorizationRegistry(
        () => trustedRuntime
      );
      targetVerifier = new CapturingTargetVerifier(
        this.options.targetVerifier,
        staticEvidence.inventory.launchImage.contentSha256
      );
      launchService = new OverlaySupervisedLaunchService({
        helperFactory: this.options.helperFactory,
        authorizationRegistry,
        targetVerifier,
        timeouts: this.options.serviceTimeouts,
      });
      const evidenceSource = new GuardedCapabilityEvidenceSource(
        this.options.evidenceSource,
        staticEvidence,
        targetVerifier,
        this.options.processIdentityVerifier,
        this.options.processInventory,
        configured,
        this.options.lifetimeGuard,
        () => this.handleLifetimeViolation()
      );
      this.coordinator = new OverlayQaEndToEndCoordinator({
        launchService,
        authorizationRegistry,
        evidenceSource,
        evidenceDeadlines: this.options.evidenceDeadlines,
      });
    } catch (error) {
      this.state = "failed";
      throw adapterError(
        "launch-failed",
        "The guarded overlay launch services could not be configured.",
        true,
        error
      );
    }

    this.state = "launching";
    try {
      const acceptance = await this.coordinator.start(policy.plan);
      this.state = "interactive";
      return acceptance;
    } catch (error) {
      const outcomeUnknown =
        this.coordinator.getState() === "launch-outcome-unknown" ||
        launchService.getState() === "launch-outcome-unknown";
      const currentState = this.getState();
      if (currentState !== "revoking" && currentState !== "revoked") {
        this.state = outcomeUnknown ? "launch-outcome-unknown" : "failed";
      }
      if (error instanceof OverlayQaEndToEndCoordinatorError) {
        throw adapterError(
          "launch-failed",
          error.message,
          outcomeUnknown || causeForbidsNormalFallback(error)
            ? false
            : error.normalLaunchFallbackAllowed,
          error
        );
      }
      throw adapterError(
        "launch-failed",
        "The guarded overlay launch failed without a proven safe fallback point.",
        false,
        error
      );
    }
  }

  public async revoke(): Promise<OverlayQaEndToEndRevocation> {
    const coordinatorState = this.coordinator?.getState();
    const mayRevoke =
      this.state === "interactive" ||
      (this.state === "launching" &&
        (coordinatorState === "authenticating" ||
          coordinatorState === "interactive"));
    if (!mayRevoke || !this.coordinator) {
      return { authorizationRevoked: false, evidenceReleased: false };
    }
    this.state = "revoking";
    const revocation = await this.coordinator.revoke();
    this.state =
      revocation.authorizationRevoked && revocation.evidenceReleased
        ? "revoked"
        : "failed";
    return revocation;
  }

  private handleLifetimeViolation(): void {
    const coordinatorState = this.coordinator?.getState();
    if (coordinatorState === "preparing" || coordinatorState === "committing") {
      this.coordinator?.cancelBeforeInteraction();
      return;
    }
    if (
      coordinatorState !== "authenticating" &&
      coordinatorState !== "interactive"
    ) {
      return;
    }
    void this.revoke().catch(() => {
      this.state = "failed";
    });
  }
}
