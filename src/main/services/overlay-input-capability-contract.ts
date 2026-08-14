import type { OverlayQaSupervisedTargetIdentity } from "./overlay-supervised-launch-contract";
import {
  isValidOverlayQaSessionId,
  normalizeOverlayQaExecutablePath,
} from "./overlay-supervised-launch-policy";

/** Known input and child-creation surfaces the native bootstrap must classify. */
export const OVERLAY_INPUT_BACKENDS = [
  "win32-keyboard",
  "raw-input",
  "late-module-resolution",
  "xinput-1.1",
  "xinput-1.2",
  "xinput-1.3",
  "xinput-1.4",
  "xinput-9.1.0",
  "xinput-uap",
  "direct-input-legacy",
  "direct-input-8",
  "wgi-gamepad",
  "wgi-raw-game-controller",
  "wgi-racing-wheel",
  "wgi-flight-stick",
  "wgi-arcade-stick",
  "wgi-ui-navigation",
  "game-input",
  "steam-input-interface-revisions",
  "libscepad",
  "ds4-dualsense-middleware",
  "hid-input-reports",
  "create-process-w-a",
  "create-process-as-user",
  "create-process-with-token",
  "shell-execute",
  "nt-create-user-process",
] as const;

export type OverlayInputBackend = (typeof OVERLAY_INPUT_BACKENDS)[number];
export const OVERLAY_CHILD_CREATION_BACKENDS = [
  "create-process-w-a",
  "create-process-as-user",
  "create-process-with-token",
  "shell-execute",
  "nt-create-user-process",
] as const satisfies readonly OverlayInputBackend[];
export type OverlayChildCreationBackend =
  (typeof OVERLAY_CHILD_CREATION_BACKENDS)[number];
export type OverlayInputBackendState =
  | "absent"
  | "covered"
  | "unsupported"
  | "fault";

export interface OverlayInputBackendObservation {
  backend: OverlayInputBackend;
  state: OverlayInputBackendState;
}

export interface OverlayInputCapabilityReport {
  schemaVersion: 1;
  identity: OverlayQaSupervisedTargetIdentity;
  generation: number;
  topologyEpoch: string;
  nativeCommitSequence: string;
  completeModuleSnapshot: boolean;
  absenceMonitorArmed: boolean;
  absenceMonitorEpoch: string;
  preEntryBootstrap: boolean;
  cachedPointerInlineDetours: boolean;
  releaseFenceReady: boolean;
  requiredChildRoutes: readonly OverlayChildCreationBackend[];
  observations: readonly OverlayInputBackendObservation[];
}

export interface OverlayInputCapabilityExpectation {
  identity: OverlayQaSupervisedTargetIdentity;
  generation: number;
  topologyEpoch: string;
  nativeCommitSequence: string;
  absenceMonitorEpoch: string;
  requiredChildRoutes: readonly OverlayChildCreationBackend[];
}

export type OverlayInputCapabilityFailure =
  | "invalid-report"
  | "invalid-expectation"
  | "target-identity-mismatch"
  | "stale-generation"
  | "stale-topology-epoch"
  | "stale-commit-sequence"
  | "stale-absence-monitor-epoch"
  | "child-route-requirement-mismatch"
  | "incomplete-module-snapshot"
  | "absence-monitor-unavailable"
  | "pre-entry-bootstrap-required"
  | "cached-pointer-detours-required"
  | "release-fence-unavailable"
  | "incomplete-backend-report"
  | "invalid-backend-report"
  | "duplicate-backend-report"
  | "base-backend-uncovered"
  | "child-propagation-uncovered"
  | "observed-backend-uncovered";

export type OverlayInputCapabilityEvaluation =
  | {
      valid: true;
      report: OverlayInputCapabilityReport;
    }
  | {
      valid: false;
      reason: OverlayInputCapabilityFailure;
      backend?: OverlayInputBackend;
    };

const BASE_BACKENDS = new Set<OverlayInputBackend>([
  "win32-keyboard",
  "raw-input",
  "late-module-resolution",
]);
const BACKENDS = new Set<string>(OVERLAY_INPUT_BACKENDS);
const CHILD_BACKENDS = new Set<string>(OVERLAY_CHILD_CREATION_BACKENDS);
const BACKEND_STATES = new Set<string>([
  "absent",
  "covered",
  "unsupported",
  "fault",
]);
const UINT64_MAX = 18_446_744_073_709_551_615n;
const UINT64_DECIMAL = /^[1-9]\d{0,19}$/u;

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
    ]) ||
    typeof value.sessionId !== "string" ||
    !isValidOverlayQaSessionId(value.sessionId) ||
    typeof value.pid !== "number" ||
    !Number.isInteger(value.pid) ||
    value.pid < 1 ||
    value.pid > 0xffff_ffff ||
    !isUint64Decimal(value.creationTicks) ||
    typeof value.canonicalExecutablePath !== "string"
  ) {
    return null;
  }
  const canonicalPath = normalizeOverlayQaExecutablePath(
    value.canonicalExecutablePath
  );
  if (canonicalPath !== value.canonicalExecutablePath) return null;
  return {
    sessionId: value.sessionId,
    pid: value.pid,
    creationTicks: value.creationTicks,
    canonicalExecutablePath: value.canonicalExecutablePath,
  };
};

const parseRequiredChildRoutes = (
  value: unknown
): readonly OverlayChildCreationBackend[] | null => {
  if (!Array.isArray(value)) return null;
  const routes: OverlayChildCreationBackend[] = [];
  const seen = new Set<OverlayChildCreationBackend>();
  for (const route of value) {
    if (typeof route !== "string" || !CHILD_BACKENDS.has(route)) return null;
    const typedRoute = route as OverlayChildCreationBackend;
    if (seen.has(typedRoute)) return null;
    seen.add(typedRoute);
    routes.push(typedRoute);
  }
  const canonical = OVERLAY_CHILD_CREATION_BACKENDS.filter((route) =>
    seen.has(route)
  );
  if (routes.some((route, index) => route !== canonical[index])) return null;
  return Object.freeze(routes);
};

const parseExpectation = (
  value: unknown
): OverlayInputCapabilityExpectation | null => {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "identity",
      "generation",
      "topologyEpoch",
      "nativeCommitSequence",
      "absenceMonitorEpoch",
      "requiredChildRoutes",
    ]) ||
    !Number.isSafeInteger(value.generation) ||
    (value.generation as number) < 1 ||
    !isUint64Decimal(value.topologyEpoch) ||
    !isUint64Decimal(value.nativeCommitSequence) ||
    !isUint64Decimal(value.absenceMonitorEpoch)
  ) {
    return null;
  }
  const identity = parseIdentity(value.identity);
  const requiredChildRoutes = parseRequiredChildRoutes(
    value.requiredChildRoutes
  );
  if (!identity || !requiredChildRoutes) return null;
  return {
    identity,
    generation: value.generation as number,
    topologyEpoch: value.topologyEpoch,
    nativeCommitSequence: value.nativeCommitSequence,
    absenceMonitorEpoch: value.absenceMonitorEpoch,
    requiredChildRoutes,
  };
};

type ParsedReport = Omit<OverlayInputCapabilityReport, "observations"> & {
  rawObservations: readonly unknown[];
};

const parseReportEnvelope = (value: unknown): ParsedReport | null => {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "schemaVersion",
      "identity",
      "generation",
      "topologyEpoch",
      "nativeCommitSequence",
      "completeModuleSnapshot",
      "absenceMonitorArmed",
      "absenceMonitorEpoch",
      "preEntryBootstrap",
      "cachedPointerInlineDetours",
      "releaseFenceReady",
      "requiredChildRoutes",
      "observations",
    ]) ||
    value.schemaVersion !== 1 ||
    !Number.isSafeInteger(value.generation) ||
    (value.generation as number) < 1 ||
    !isUint64Decimal(value.topologyEpoch) ||
    !isUint64Decimal(value.nativeCommitSequence) ||
    !isUint64Decimal(value.absenceMonitorEpoch) ||
    typeof value.completeModuleSnapshot !== "boolean" ||
    typeof value.absenceMonitorArmed !== "boolean" ||
    typeof value.preEntryBootstrap !== "boolean" ||
    typeof value.cachedPointerInlineDetours !== "boolean" ||
    typeof value.releaseFenceReady !== "boolean" ||
    !Array.isArray(value.observations)
  ) {
    return null;
  }
  const identity = parseIdentity(value.identity);
  const requiredChildRoutes = parseRequiredChildRoutes(
    value.requiredChildRoutes
  );
  if (!identity || !requiredChildRoutes) return null;
  return {
    schemaVersion: 1,
    identity,
    generation: value.generation as number,
    topologyEpoch: value.topologyEpoch,
    nativeCommitSequence: value.nativeCommitSequence,
    completeModuleSnapshot: value.completeModuleSnapshot,
    absenceMonitorArmed: value.absenceMonitorArmed,
    absenceMonitorEpoch: value.absenceMonitorEpoch,
    preEntryBootstrap: value.preEntryBootstrap,
    cachedPointerInlineDetours: value.cachedPointerInlineDetours,
    releaseFenceReady: value.releaseFenceReady,
    requiredChildRoutes,
    rawObservations: value.observations,
  };
};

/**
 * Strictly validates one native report against an independently retained
 * identity/commit expectation. This is not a complete authorization decision:
 * report authenticity, monotonic native publication, file/signature/mitigation,
 * game-root and anti-cheat policy are enforced by separate boundaries.
 */
export const validateOverlayInputCapabilityReport = (
  unsafeReport: unknown,
  unsafeExpected: unknown
): OverlayInputCapabilityEvaluation => {
  const expected = parseExpectation(unsafeExpected);
  if (!expected) return { valid: false, reason: "invalid-expectation" };
  const envelope = parseReportEnvelope(unsafeReport);
  if (!envelope) return { valid: false, reason: "invalid-report" };

  if (
    envelope.identity.sessionId !== expected.identity.sessionId ||
    envelope.identity.pid !== expected.identity.pid ||
    envelope.identity.creationTicks !== expected.identity.creationTicks ||
    envelope.identity.canonicalExecutablePath !==
      expected.identity.canonicalExecutablePath
  ) {
    return { valid: false, reason: "target-identity-mismatch" };
  }
  if (envelope.generation !== expected.generation) {
    return { valid: false, reason: "stale-generation" };
  }
  if (envelope.topologyEpoch !== expected.topologyEpoch) {
    return { valid: false, reason: "stale-topology-epoch" };
  }
  if (envelope.nativeCommitSequence !== expected.nativeCommitSequence) {
    return { valid: false, reason: "stale-commit-sequence" };
  }
  if (envelope.absenceMonitorEpoch !== expected.absenceMonitorEpoch) {
    return { valid: false, reason: "stale-absence-monitor-epoch" };
  }
  if (
    envelope.requiredChildRoutes.length !==
      expected.requiredChildRoutes.length ||
    envelope.requiredChildRoutes.some(
      (route, index) => route !== expected.requiredChildRoutes[index]
    )
  ) {
    return { valid: false, reason: "child-route-requirement-mismatch" };
  }
  if (!envelope.completeModuleSnapshot) {
    return { valid: false, reason: "incomplete-module-snapshot" };
  }
  if (!envelope.absenceMonitorArmed) {
    return { valid: false, reason: "absence-monitor-unavailable" };
  }
  if (!envelope.preEntryBootstrap) {
    return { valid: false, reason: "pre-entry-bootstrap-required" };
  }
  if (!envelope.cachedPointerInlineDetours) {
    return { valid: false, reason: "cached-pointer-detours-required" };
  }
  if (!envelope.releaseFenceReady) {
    return { valid: false, reason: "release-fence-unavailable" };
  }

  const states = new Map<OverlayInputBackend, OverlayInputBackendState>();
  const observations: OverlayInputBackendObservation[] = [];
  for (const observation of envelope.rawObservations) {
    if (
      !isRecord(observation) ||
      !exactKeys(observation, ["backend", "state"]) ||
      typeof observation.backend !== "string" ||
      !BACKENDS.has(observation.backend) ||
      typeof observation.state !== "string" ||
      !BACKEND_STATES.has(observation.state)
    ) {
      return { valid: false, reason: "invalid-backend-report" };
    }
    const backend = observation.backend as OverlayInputBackend;
    const state = observation.state as OverlayInputBackendState;
    if (states.has(backend)) {
      return {
        valid: false,
        reason: "duplicate-backend-report",
        backend,
      };
    }
    states.set(backend, state);
    observations.push({ backend, state });
  }
  if (
    states.size !== OVERLAY_INPUT_BACKENDS.length ||
    OVERLAY_INPUT_BACKENDS.some((backend) => !states.has(backend))
  ) {
    return { valid: false, reason: "incomplete-backend-report" };
  }
  for (const backend of BASE_BACKENDS) {
    if (states.get(backend) !== "covered") {
      return { valid: false, reason: "base-backend-uncovered", backend };
    }
  }
  for (const backend of expected.requiredChildRoutes) {
    if (states.get(backend) !== "covered") {
      return {
        valid: false,
        reason: "child-propagation-uncovered",
        backend,
      };
    }
  }
  for (const backend of OVERLAY_INPUT_BACKENDS) {
    const state = states.get(backend);
    if (state === "unsupported" || state === "fault") {
      return {
        valid: false,
        reason: "observed-backend-uncovered",
        backend,
      };
    }
  }

  return {
    valid: true,
    report: Object.freeze({
      schemaVersion: 1,
      identity: Object.freeze({ ...envelope.identity }),
      generation: envelope.generation,
      topologyEpoch: envelope.topologyEpoch,
      nativeCommitSequence: envelope.nativeCommitSequence,
      completeModuleSnapshot: true,
      absenceMonitorArmed: true,
      absenceMonitorEpoch: envelope.absenceMonitorEpoch,
      preEntryBootstrap: true,
      cachedPointerInlineDetours: true,
      releaseFenceReady: true,
      requiredChildRoutes: Object.freeze([...envelope.requiredChildRoutes]),
      observations: Object.freeze(
        observations.map((observation) => Object.freeze({ ...observation }))
      ),
    }),
  };
};
