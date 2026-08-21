import type { OverlayQaSupervisedTargetIdentity } from "./overlay-supervised-launch-contract";
import {
  isValidOverlayQaSessionId,
  normalizeOverlayQaExecutablePath,
} from "./overlay-supervised-launch-policy";

export const OVERLAY_RENDER_BACKENDS = ["dxgi-d3d11", "dxgi-d3d12"] as const;

export const OVERLAY_RENDER_SURFACES = [
  "present",
  "present1",
  "resize-buffers",
  "resize-buffers1",
  "set-source-size",
  "swap-chain-destruction",
  "device-removal",
  "pipeline-state-restore",
  "command-queue-identity",
  "resource-idle-fence",
  "multi-swap-chain-selection",
  "late-module-resolution",
] as const;

export type OverlayRenderBackend = (typeof OVERLAY_RENDER_BACKENDS)[number];
export type OverlayRenderSurface = (typeof OVERLAY_RENDER_SURFACES)[number];
export type OverlayRenderArchitecture = "x86" | "x64";
export type OverlayRenderEvidenceState =
  | "absent"
  | "covered"
  | "unsupported"
  | "fault";

const REQUIRED_DXGI_SURFACES = [
  "present",
  "resize-buffers",
  "swap-chain-destruction",
  "device-removal",
  "pipeline-state-restore",
  "multi-swap-chain-selection",
  "late-module-resolution",
] as const satisfies readonly OverlayRenderSurface[];

const REQUIRED_D3D12_SURFACES = [
  ...REQUIRED_DXGI_SURFACES,
  "command-queue-identity",
  "resource-idle-fence",
] as const satisfies readonly OverlayRenderSurface[];

export interface OverlayRenderEvidence<TName extends string> {
  name: TName;
  state: OverlayRenderEvidenceState;
}

export interface OverlayRenderCapabilityReport {
  schemaVersion: 1;
  identity: OverlayQaSupervisedTargetIdentity;
  inputGeneration: number;
  renderGeneration: number;
  topologyEpoch: string;
  nativeCommitSequence: string;
  targetArchitecture: OverlayRenderArchitecture;
  payloadArchitecture: OverlayRenderArchitecture;
  activeBackend: OverlayRenderBackend;
  completeModuleSnapshot: boolean;
  lateModuleMonitorArmed: boolean;
  preEntryBootstrap: boolean;
  cachedPointerInlineDetours: boolean;
  nonblockingPresentPath: boolean;
  allocationFreePresentPath: boolean;
  hookReaderFence: boolean;
  backendEvidence: readonly OverlayRenderEvidence<OverlayRenderBackend>[];
  surfaceEvidence: readonly OverlayRenderEvidence<OverlayRenderSurface>[];
}

export interface OverlayRenderCapabilityExpectation {
  identity: OverlayQaSupervisedTargetIdentity;
  inputGeneration: number;
  renderGeneration: number;
  topologyEpoch: string;
  nativeCommitSequence: string;
  targetArchitecture: OverlayRenderArchitecture;
  activeBackend: OverlayRenderBackend;
  requiredSurfaces: readonly OverlayRenderSurface[];
}

export type OverlayRenderCapabilityFailure =
  | "invalid-report"
  | "invalid-expectation"
  | "target-identity-mismatch"
  | "stale-input-generation"
  | "stale-render-generation"
  | "stale-topology-epoch"
  | "stale-commit-sequence"
  | "target-architecture-mismatch"
  | "payload-architecture-mismatch"
  | "active-backend-mismatch"
  | "incomplete-module-snapshot"
  | "late-module-monitor-unavailable"
  | "pre-entry-bootstrap-required"
  | "cached-pointer-detours-required"
  | "blocking-present-path"
  | "allocating-present-path"
  | "hook-reader-fence-unavailable"
  | "invalid-backend-evidence"
  | "duplicate-backend-evidence"
  | "incomplete-backend-evidence"
  | "active-backend-uncovered"
  | "multiple-render-backends"
  | "observed-backend-uncovered"
  | "invalid-surface-evidence"
  | "duplicate-surface-evidence"
  | "incomplete-surface-evidence"
  | "required-surface-uncovered"
  | "observed-surface-uncovered";

export type OverlayRenderCapabilityEvaluation =
  | { valid: true; report: OverlayRenderCapabilityReport }
  | {
      valid: false;
      reason: OverlayRenderCapabilityFailure;
      backend?: OverlayRenderBackend;
      surface?: OverlayRenderSurface;
    };

const BACKENDS = new Set<string>(OVERLAY_RENDER_BACKENDS);
const SURFACES = new Set<string>(OVERLAY_RENDER_SURFACES);
const STATES = new Set<string>(["absent", "covered", "unsupported", "fault"]);
const ARCHITECTURES = new Set<string>(["x86", "x64"]);
const UINT64_MAX = 18_446_744_073_709_551_615n;
const UINT64_DECIMAL = /^[1-9]\d{0,19}$/u;
const VOLUME_SERIAL = /^(?!0{16}$)[0-9A-F]{16}$/u;
const FILE_ID = /^(?!0{32}$)[0-9A-F]{32}$/u;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
};

const isUint64Decimal = (value: unknown): value is string => {
  if (typeof value !== "string" || !UINT64_DECIMAL.test(value)) return false;
  try {
    return BigInt(value) <= UINT64_MAX;
  } catch {
    return false;
  }
};

const parseIdentity = (
  value: unknown
): OverlayQaSupervisedTargetIdentity | null => {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "sessionId",
      "pid",
      "creationTicks",
      "canonicalExecutablePath",
      "volumeSerial",
      "fileId",
    ]) ||
    typeof value.sessionId !== "string" ||
    !isValidOverlayQaSessionId(value.sessionId) ||
    typeof value.pid !== "number" ||
    !Number.isInteger(value.pid) ||
    value.pid < 1 ||
    value.pid > 0xffff_ffff ||
    !isUint64Decimal(value.creationTicks) ||
    typeof value.canonicalExecutablePath !== "string" ||
    normalizeOverlayQaExecutablePath(value.canonicalExecutablePath) !==
      value.canonicalExecutablePath ||
    typeof value.volumeSerial !== "string" ||
    !VOLUME_SERIAL.test(value.volumeSerial) ||
    typeof value.fileId !== "string" ||
    !FILE_ID.test(value.fileId)
  ) {
    return null;
  }
  return {
    sessionId: value.sessionId,
    pid: value.pid,
    creationTicks: value.creationTicks,
    canonicalExecutablePath: value.canonicalExecutablePath,
    volumeSerial: value.volumeSerial,
    fileId: value.fileId,
  };
};

const parseCanonicalNames = <TName extends string>(
  value: unknown,
  canonical: readonly TName[],
  known: ReadonlySet<string>
): readonly TName[] | null => {
  if (!Array.isArray(value)) return null;
  const names: TName[] = [];
  const seen = new Set<TName>();
  for (const item of value) {
    if (typeof item !== "string" || !known.has(item)) return null;
    const name = item as TName;
    if (seen.has(name)) return null;
    seen.add(name);
    names.push(name);
  }
  const ordered = canonical.filter((name) => seen.has(name));
  if (names.some((name, index) => name !== ordered[index])) return null;
  return Object.freeze(names);
};

const parseEvidence = <TName extends string>(
  value: unknown,
  canonical: readonly TName[],
  known: ReadonlySet<string>
): readonly OverlayRenderEvidence<TName>[] | null => {
  if (!Array.isArray(value)) return null;
  const evidence: OverlayRenderEvidence<TName>[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      !exactKeys(item, ["name", "state"]) ||
      typeof item.name !== "string" ||
      !known.has(item.name) ||
      typeof item.state !== "string" ||
      !STATES.has(item.state)
    ) {
      return null;
    }
    evidence.push({
      name: item.name as TName,
      state: item.state as OverlayRenderEvidenceState,
    });
  }
  const seen = new Set<TName>();
  for (const item of evidence) {
    if (seen.has(item.name)) return null;
    seen.add(item.name);
  }
  if (
    evidence.length !== canonical.length ||
    canonical.some((name) => !seen.has(name))
  ) {
    return null;
  }
  return evidence;
};

type ParsedExpectation = OverlayRenderCapabilityExpectation;

const parseExpectation = (value: unknown): ParsedExpectation | null => {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "identity",
      "inputGeneration",
      "renderGeneration",
      "topologyEpoch",
      "nativeCommitSequence",
      "targetArchitecture",
      "activeBackend",
      "requiredSurfaces",
    ]) ||
    !Number.isSafeInteger(value.inputGeneration) ||
    (value.inputGeneration as number) < 1 ||
    !Number.isSafeInteger(value.renderGeneration) ||
    (value.renderGeneration as number) < 1 ||
    !isUint64Decimal(value.topologyEpoch) ||
    !isUint64Decimal(value.nativeCommitSequence) ||
    typeof value.targetArchitecture !== "string" ||
    !ARCHITECTURES.has(value.targetArchitecture) ||
    typeof value.activeBackend !== "string" ||
    !BACKENDS.has(value.activeBackend)
  ) {
    return null;
  }
  const identity = parseIdentity(value.identity);
  const requiredSurfaces = parseCanonicalNames(
    value.requiredSurfaces,
    OVERLAY_RENDER_SURFACES,
    SURFACES
  );
  if (!identity || !requiredSurfaces || requiredSurfaces.length === 0) {
    return null;
  }
  const requiredProfile =
    value.activeBackend === "dxgi-d3d12"
      ? REQUIRED_D3D12_SURFACES
      : REQUIRED_DXGI_SURFACES;
  const selected = new Set(requiredSurfaces);
  if (requiredProfile.some((surface) => !selected.has(surface))) return null;
  return {
    identity,
    inputGeneration: value.inputGeneration as number,
    renderGeneration: value.renderGeneration as number,
    topologyEpoch: value.topologyEpoch,
    nativeCommitSequence: value.nativeCommitSequence,
    targetArchitecture: value.targetArchitecture as OverlayRenderArchitecture,
    activeBackend: value.activeBackend as OverlayRenderBackend,
    requiredSurfaces,
  };
};

const parseReport = (value: unknown): OverlayRenderCapabilityReport | null => {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "schemaVersion",
      "identity",
      "inputGeneration",
      "renderGeneration",
      "topologyEpoch",
      "nativeCommitSequence",
      "targetArchitecture",
      "payloadArchitecture",
      "activeBackend",
      "completeModuleSnapshot",
      "lateModuleMonitorArmed",
      "preEntryBootstrap",
      "cachedPointerInlineDetours",
      "nonblockingPresentPath",
      "allocationFreePresentPath",
      "hookReaderFence",
      "backendEvidence",
      "surfaceEvidence",
    ]) ||
    value.schemaVersion !== 1 ||
    !Number.isSafeInteger(value.inputGeneration) ||
    (value.inputGeneration as number) < 1 ||
    !Number.isSafeInteger(value.renderGeneration) ||
    (value.renderGeneration as number) < 1 ||
    !isUint64Decimal(value.topologyEpoch) ||
    !isUint64Decimal(value.nativeCommitSequence) ||
    typeof value.targetArchitecture !== "string" ||
    !ARCHITECTURES.has(value.targetArchitecture) ||
    typeof value.payloadArchitecture !== "string" ||
    !ARCHITECTURES.has(value.payloadArchitecture) ||
    typeof value.activeBackend !== "string" ||
    !BACKENDS.has(value.activeBackend) ||
    typeof value.completeModuleSnapshot !== "boolean" ||
    typeof value.lateModuleMonitorArmed !== "boolean" ||
    typeof value.preEntryBootstrap !== "boolean" ||
    typeof value.cachedPointerInlineDetours !== "boolean" ||
    typeof value.nonblockingPresentPath !== "boolean" ||
    typeof value.allocationFreePresentPath !== "boolean" ||
    typeof value.hookReaderFence !== "boolean"
  ) {
    return null;
  }
  const identity = parseIdentity(value.identity);
  const backendEvidence = parseEvidence(
    value.backendEvidence,
    OVERLAY_RENDER_BACKENDS,
    BACKENDS
  );
  const surfaceEvidence = parseEvidence(
    value.surfaceEvidence,
    OVERLAY_RENDER_SURFACES,
    SURFACES
  );
  if (!identity || !backendEvidence || !surfaceEvidence) return null;
  return {
    schemaVersion: 1,
    identity,
    inputGeneration: value.inputGeneration as number,
    renderGeneration: value.renderGeneration as number,
    topologyEpoch: value.topologyEpoch,
    nativeCommitSequence: value.nativeCommitSequence,
    targetArchitecture: value.targetArchitecture as OverlayRenderArchitecture,
    payloadArchitecture: value.payloadArchitecture as OverlayRenderArchitecture,
    activeBackend: value.activeBackend as OverlayRenderBackend,
    completeModuleSnapshot: value.completeModuleSnapshot,
    lateModuleMonitorArmed: value.lateModuleMonitorArmed,
    preEntryBootstrap: value.preEntryBootstrap,
    cachedPointerInlineDetours: value.cachedPointerInlineDetours,
    nonblockingPresentPath: value.nonblockingPresentPath,
    allocationFreePresentPath: value.allocationFreePresentPath,
    hookReaderFence: value.hookReaderFence,
    backendEvidence,
    surfaceEvidence,
  };
};

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

/**
 * Validates one native render report against independently retained launch and
 * input generations. Authenticity, monotonic publication, anti-cheat policy,
 * signatures and the detector's completeness remain separate native gates.
 */
export const validateOverlayRenderCapabilityReport = (
  unsafeReport: unknown,
  unsafeExpected: unknown
): OverlayRenderCapabilityEvaluation => {
  let expected: ParsedExpectation | null;
  try {
    expected = parseExpectation(unsafeExpected);
  } catch {
    return { valid: false, reason: "invalid-expectation" };
  }
  if (!expected) return { valid: false, reason: "invalid-expectation" };
  let report: OverlayRenderCapabilityReport | null;
  try {
    report = parseReport(unsafeReport);
  } catch {
    return { valid: false, reason: "invalid-report" };
  }
  if (!report) return { valid: false, reason: "invalid-report" };
  if (!sameIdentity(report.identity, expected.identity)) {
    return { valid: false, reason: "target-identity-mismatch" };
  }
  if (report.inputGeneration !== expected.inputGeneration) {
    return { valid: false, reason: "stale-input-generation" };
  }
  if (report.renderGeneration !== expected.renderGeneration) {
    return { valid: false, reason: "stale-render-generation" };
  }
  if (report.topologyEpoch !== expected.topologyEpoch) {
    return { valid: false, reason: "stale-topology-epoch" };
  }
  if (report.nativeCommitSequence !== expected.nativeCommitSequence) {
    return { valid: false, reason: "stale-commit-sequence" };
  }
  if (report.targetArchitecture !== expected.targetArchitecture) {
    return { valid: false, reason: "target-architecture-mismatch" };
  }
  if (report.payloadArchitecture !== report.targetArchitecture) {
    return { valid: false, reason: "payload-architecture-mismatch" };
  }
  if (report.activeBackend !== expected.activeBackend) {
    return { valid: false, reason: "active-backend-mismatch" };
  }
  if (!report.completeModuleSnapshot) {
    return { valid: false, reason: "incomplete-module-snapshot" };
  }
  if (!report.lateModuleMonitorArmed) {
    return { valid: false, reason: "late-module-monitor-unavailable" };
  }
  if (!report.preEntryBootstrap) {
    return { valid: false, reason: "pre-entry-bootstrap-required" };
  }
  if (!report.cachedPointerInlineDetours) {
    return { valid: false, reason: "cached-pointer-detours-required" };
  }
  if (!report.nonblockingPresentPath) {
    return { valid: false, reason: "blocking-present-path" };
  }
  if (!report.allocationFreePresentPath) {
    return { valid: false, reason: "allocating-present-path" };
  }
  if (!report.hookReaderFence) {
    return { valid: false, reason: "hook-reader-fence-unavailable" };
  }

  const backendStates = new Map(
    report.backendEvidence.map((item) => [item.name, item.state] as const)
  );
  if (backendStates.get(report.activeBackend) !== "covered") {
    return {
      valid: false,
      reason: "active-backend-uncovered",
      backend: report.activeBackend,
    };
  }
  for (const backend of OVERLAY_RENDER_BACKENDS) {
    const state = backendStates.get(backend);
    if (backend !== report.activeBackend && state === "covered") {
      return {
        valid: false,
        reason: "multiple-render-backends",
        backend,
      };
    }
    if (state === "unsupported" || state === "fault") {
      return {
        valid: false,
        reason: "observed-backend-uncovered",
        backend,
      };
    }
  }

  const surfaceStates = new Map(
    report.surfaceEvidence.map((item) => [item.name, item.state] as const)
  );
  for (const surface of expected.requiredSurfaces) {
    if (surfaceStates.get(surface) !== "covered") {
      return {
        valid: false,
        reason: "required-surface-uncovered",
        surface,
      };
    }
  }
  for (const surface of OVERLAY_RENDER_SURFACES) {
    const state = surfaceStates.get(surface);
    if (state === "unsupported" || state === "fault") {
      return {
        valid: false,
        reason: "observed-surface-uncovered",
        surface,
      };
    }
  }

  return {
    valid: true,
    report: Object.freeze({
      ...report,
      identity: Object.freeze({ ...report.identity }),
      backendEvidence: Object.freeze(
        report.backendEvidence.map((item) => Object.freeze({ ...item }))
      ),
      surfaceEvidence: Object.freeze(
        report.surfaceEvidence.map((item) => Object.freeze({ ...item }))
      ),
    }),
  };
};
