import path from "node:path";

import type { OverlayQaSupervisedTargetIdentity } from "./overlay-supervised-launch-contract";
import {
  isValidOverlayQaSessionId,
  normalizeOverlayQaExecutablePath,
} from "./overlay-supervised-launch-policy";

export const OVERLAY_CONTROLLER_MIDDLEWARE_BACKENDS = [
  "hid-overlapped",
  "steam-input-006",
  "steam-controller-008",
  "libscepad",
] as const;

export const OVERLAY_HID_ROUTES = [
  "setup-di-get-class-devs-w",
  "setup-di-get-class-devs-a",
  "setup-di-enum-device-interfaces",
  "setup-di-get-device-interface-detail-w",
  "setup-di-get-device-interface-detail-a",
  "setup-di-destroy-device-info-list",
  "create-file-w",
  "create-file-a",
  "duplicate-handle",
  "inherited-handle-bootstrap",
  "close-handle",
  "read-file",
  "read-file-ex",
  "apc-completion",
  "write-file",
  "write-file-ex",
  "device-io-control",
  "overlapped-event-completion",
  "get-overlapped-result",
  "get-overlapped-result-ex",
  "create-io-completion-port",
  "get-queued-completion-status",
  "get-queued-completion-status-ex",
  "cancel-io",
  "cancel-io-ex",
] as const;

export const OVERLAY_HID_REPORT_OPERATIONS = [
  "read-file",
  "read-file-ex",
  "write-file",
  "write-file-ex",
  "device-io-control",
] as const;

export const OVERLAY_HID_CONTROL_SEMANTICS = [
  "none",
  "get-feature",
  "set-feature",
  "get-input-report",
  "set-output-report",
] as const;

export const OVERLAY_HID_TRANSFER_DIRECTIONS = [
  "device-to-host",
  "host-to-device",
] as const;

export const OVERLAY_CONTROLLER_SNAPSHOT_LIMITS = Object.freeze({
  maxCollectionEntries: 4_096,
  maxTotalNodes: 16_384,
  maxDepth: 64,
  maxAggregateStringBytes: 1_048_576,
});

export const OVERLAY_STEAM_INPUT_006_METHODS = [
  "RunFrame",
  "GetConnectedControllers",
  "GetActionSetHandle",
  "GetDigitalActionHandle",
  "GetAnalogActionHandle",
  "GetDigitalActionData",
  "GetAnalogActionData",
  "GetMotionData",
  "GetGamepadIndexForController",
  "GetControllerForGamepadIndex",
  "TriggerVibration",
  "TriggerVibrationExtended",
  "TriggerSimpleHapticEvent",
  "Legacy_TriggerHapticPulse",
  "Legacy_TriggerRepeatedHapticPulse",
  "SetLEDColor",
] as const;

export const OVERLAY_STEAM_CONTROLLER_008_METHODS = [
  "RunFrame",
  "GetConnectedControllers",
  "GetActionSetHandle",
  "GetDigitalActionHandle",
  "GetAnalogActionHandle",
  "GetDigitalActionData",
  "GetAnalogActionData",
  "GetMotionData",
  "GetGamepadIndexForController",
  "GetControllerForGamepadIndex",
  "TriggerHapticPulse",
  "TriggerRepeatedHapticPulse",
  "TriggerVibration",
  "SetLEDColor",
] as const;

export const OVERLAY_CONTROLLER_MODULE_ROLES = [
  "hid-api",
  "setupapi",
  "kernel-io",
  "steam-api",
  "libscepad",
  "unknown-controller",
] as const;

export type OverlayControllerMiddlewareBackend =
  (typeof OVERLAY_CONTROLLER_MIDDLEWARE_BACKENDS)[number];
export type OverlayHidRoute = (typeof OVERLAY_HID_ROUTES)[number];
export type OverlayHidReportOperation =
  (typeof OVERLAY_HID_REPORT_OPERATIONS)[number];
export type OverlayHidControlSemantic =
  (typeof OVERLAY_HID_CONTROL_SEMANTICS)[number];
export type OverlayHidTransferDirection =
  (typeof OVERLAY_HID_TRANSFER_DIRECTIONS)[number];
export type OverlaySteamInput006Method =
  (typeof OVERLAY_STEAM_INPUT_006_METHODS)[number];
export type OverlaySteamController008Method =
  (typeof OVERLAY_STEAM_CONTROLLER_008_METHODS)[number];
export type OverlayControllerMethod =
  | OverlaySteamInput006Method
  | OverlaySteamController008Method;
export type OverlayControllerModuleRole =
  (typeof OVERLAY_CONTROLLER_MODULE_ROLES)[number];
export type OverlayControllerArchitecture = "x86" | "x64";
export type OverlayControllerEvidenceState =
  | "absent"
  | "covered"
  | "unsupported"
  | "fault"
  | "abi-unverified";
export type OverlayControllerObservedState = Exclude<
  OverlayControllerEvidenceState,
  "absent"
>;
export type OverlayControllerExpectationDisposition = "required" | "absent";

export interface OverlayControllerModuleIdentity {
  role: OverlayControllerModuleRole;
  moduleName: string;
  canonicalPath: string;
  architecture: OverlayControllerArchitecture;
  volumeSerial: string;
  fileId: string;
  sha256: string;
  imageSize: number;
  loadAddress: string;
}

export interface OverlayHidEndpointIdentity {
  endpointId: string;
  devicePathDigest: string;
  containerId: string;
  vendorId: number;
  productId: number;
  versionNumber: number;
  usagePage: number;
  usage: number;
  collectionNumber: number;
}

/** Report IDs are namespaced by endpoint, generation, operation, control and direction. */
export interface OverlayHidTrackedReportSchema {
  operation: OverlayHidReportOperation;
  controlSemantic: OverlayHidControlSemantic;
  transferDirection: OverlayHidTransferDirection;
  reportId: number;
  byteLength: number;
  schemaDigest: string;
  transferBindingDigest: string;
  neutralReportDigest: string | null;
}

export interface OverlayHidTransferHoldReplayEvidence
  extends OverlayOutputHoldReplayEvidence {
  transferBindingDigest: string;
}

export interface OverlayHidTrackedTransferEvidence
  extends OverlayHidTrackedReportSchema {
  outputHoldReplay: OverlayHidTransferHoldReplayEvidence | null;
}

export interface OverlayControllerNamedEvidence<TName extends string> {
  name: TName;
  state: Exclude<OverlayControllerEvidenceState, "abi-unverified">;
}

export interface OverlayOutputHoldReplayEvidence {
  holdWhileBlocked: boolean;
  replayLatestOnceOnRelease: boolean;
  generationBound: boolean;
  endpointBound: boolean;
  dropOnCloseOrDisconnect: boolean;
  orderedAfterInputRelease: boolean;
}

export interface OverlayHidEndpointExpectation {
  endpoint: OverlayHidEndpointIdentity;
  handleGeneration: string;
  pendingDrainEpoch: string;
  lateCompletionEpoch: string;
  trackedReports: readonly OverlayHidTrackedReportSchema[];
}

export interface OverlayHidEndpointEvidence
  extends Omit<OverlayHidEndpointExpectation, "trackedReports"> {
  pendingCompletionsDrained: boolean;
  lateCompletionFenceArmed: boolean;
  routes: readonly OverlayControllerNamedEvidence<OverlayHidRoute>[];
  trackedTransfers: readonly OverlayHidTrackedTransferEvidence[];
}

export interface OverlayControllerBackendExpectation {
  backend: OverlayControllerMiddlewareBackend;
  disposition: OverlayControllerExpectationDisposition;
  modules: readonly OverlayControllerModuleIdentity[];
  interfaceRevision: string | null;
  abiSchemaDigest: string | null;
  hidEndpoints: readonly OverlayHidEndpointExpectation[];
}

export interface OverlayControllerBackendEvidence {
  backend: OverlayControllerMiddlewareBackend;
  state: OverlayControllerEvidenceState;
  modules: readonly OverlayControllerModuleIdentity[];
  interfaceRevision: string | null;
  abiSchemaDigest: string | null;
  hidEndpoints: readonly OverlayHidEndpointEvidence[];
  methods: readonly OverlayControllerNamedEvidence<OverlayControllerMethod>[];
  outputHoldReplay: OverlayOutputHoldReplayEvidence | null;
}

export interface OverlayControllerObservedInventoryEntry {
  backend: OverlayControllerMiddlewareBackend;
  module: OverlayControllerModuleIdentity;
  interfaceRevision: string;
  abiSchemaDigest: string;
  state: OverlayControllerObservedState;
}

export interface OverlayControllerUnknownObservation {
  kind: "steam-interface" | "controller-module";
  module: OverlayControllerModuleIdentity;
  observedInterface: string;
  observationDigest: string;
  state: "unsupported" | "abi-unverified";
}

export interface OverlayControllerMiddlewareCapabilityExpectation {
  identity: OverlayQaSupervisedTargetIdentity;
  inputGeneration: string;
  middlewareGeneration: string;
  topologyEpoch: string;
  nativeCommitSequence: string;
  nativeCommitDigest: string;
  absenceMonitorEpoch: string;
  targetArchitecture: OverlayControllerArchitecture;
  unknownObservationSetDigest: string;
  observedInventory: readonly OverlayControllerObservedInventoryEntry[];
  unknownObservations: readonly [];
  backendExpectations: readonly OverlayControllerBackendExpectation[];
}

export interface OverlayControllerMiddlewareCapabilityReport {
  schemaVersion: 2;
  identity: OverlayQaSupervisedTargetIdentity;
  inputGeneration: string;
  middlewareGeneration: string;
  topologyEpoch: string;
  nativeCommitSequence: string;
  nativeCommitDigest: string;
  absenceMonitorEpoch: string;
  targetArchitecture: OverlayControllerArchitecture;
  unknownObservationSetDigest: string;
  completeModuleSnapshot: boolean;
  completeInterfaceInventory: boolean;
  absenceMonitorArmed: boolean;
  preEntryBootstrap: boolean;
  cachedPointerInlineDetours: boolean;
  handleLifecycleFence: boolean;
  completionDrainFence: boolean;
  hookReaderFence: boolean;
  observedInventory: readonly OverlayControllerObservedInventoryEntry[];
  unknownObservations: readonly OverlayControllerUnknownObservation[];
  backendEvidence: readonly OverlayControllerBackendEvidence[];
}

export type OverlayControllerMiddlewareCapabilityFailure =
  | "invalid-report"
  | "invalid-expectation"
  | "target-identity-mismatch"
  | "stale-input-generation"
  | "stale-middleware-generation"
  | "stale-topology-epoch"
  | "stale-commit-sequence"
  | "native-commit-digest-mismatch"
  | "stale-absence-monitor-epoch"
  | "target-architecture-mismatch"
  | "unknown-observation-set-digest-mismatch"
  | "unknown-observation"
  | "observed-inventory-mismatch"
  | "incomplete-module-snapshot"
  | "incomplete-interface-inventory"
  | "absence-monitor-unavailable"
  | "pre-entry-bootstrap-required"
  | "cached-pointer-detours-required"
  | "handle-lifecycle-fence-unavailable"
  | "completion-drain-fence-unavailable"
  | "hook-reader-fence-unavailable"
  | "backend-disposition-mismatch"
  | "module-identity-mismatch"
  | "interface-revision-mismatch"
  | "abi-schema-mismatch"
  | "hid-endpoint-generation-set-mismatch"
  | "hid-drain-epoch-mismatch"
  | "hid-report-schema-mismatch"
  | "hid-neutralization-unavailable"
  | "hid-output-binding-mismatch"
  | "hid-route-uncovered"
  | "pending-completion-drain-unavailable"
  | "late-completion-fence-unavailable"
  | "steam-method-uncovered"
  | "output-hold-replay-unavailable"
  | "observed-backend-uncovered"
  | "libscepad-abi-unverified";

export type OverlayControllerMiddlewareCapabilityEvaluation =
  | { valid: true; report: OverlayControllerMiddlewareCapabilityReport }
  | {
      valid: false;
      reason: OverlayControllerMiddlewareCapabilityFailure;
      backend?: OverlayControllerMiddlewareBackend;
      endpointId?: string;
      handleGeneration?: string;
      route?: OverlayHidRoute;
      method?: OverlayControllerMethod;
      operation?: OverlayHidReportOperation;
      controlSemantic?: OverlayHidControlSemantic;
      transferDirection?: OverlayHidTransferDirection;
      reportId?: number;
    };

type SnapshotPrimitive = null | boolean | number | string;
type SnapshotValue =
  | SnapshotPrimitive
  | readonly SnapshotValue[]
  | SnapshotRecord;
interface SnapshotRecord {
  readonly [key: string]: SnapshotValue;
}

type SnapshotResult = { ok: true; value: SnapshotValue } | { ok: false };

const UINT64_MAX = 18_446_744_073_709_551_615n;
const UINT64_EXCLUSIVE = 18_446_744_073_709_551_616n;
const UINT32_EXCLUSIVE = 4_294_967_296n;
const UINT64_DECIMAL = /^(0|[1-9]\d{0,19})$/u;
const POSITIVE_UINT64_DECIMAL = /^[1-9]\d{0,19}$/u;
const ARRAY_INDEX = /^(0|[1-9]\d*)$/u;
const VOLUME_SERIAL = /^(?!0{16}$)[0-9A-F]{16}$/u;
const FILE_ID = /^(?!0{32}$)[0-9A-F]{32}$/u;
const SHA256 = /^(?!0{64}$)[0-9A-F]{64}$/u;
const MODULE_NAME = /^[a-z0-9_.-]+\.dll$/u;
const INTERFACE_REVISION = /^[A-Za-z0-9_.:@-]{1,128}$/u;
const GUID =
  /^\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}$/u;
const ARCHITECTURES = new Set<string>(["x86", "x64"]);
const BACKENDS = new Set<string>(OVERLAY_CONTROLLER_MIDDLEWARE_BACKENDS);
const MODULE_ROLES = new Set<string>(OVERLAY_CONTROLLER_MODULE_ROLES);
const HID_ROUTES = new Set<string>(OVERLAY_HID_ROUTES);
const HID_OPERATIONS = new Set<string>(OVERLAY_HID_REPORT_OPERATIONS);
const HID_CONTROL_SEMANTICS = new Set<string>(OVERLAY_HID_CONTROL_SEMANTICS);
const HID_TRANSFER_DIRECTIONS = new Set<string>(
  OVERLAY_HID_TRANSFER_DIRECTIONS
);
const STEAM_INPUT_METHODS = new Set<string>(OVERLAY_STEAM_INPUT_006_METHODS);
const STEAM_CONTROLLER_METHODS = new Set<string>(
  OVERLAY_STEAM_CONTROLLER_008_METHODS
);
const NAMED_EVIDENCE_STATES = new Set<string>([
  "absent",
  "covered",
  "unsupported",
  "fault",
]);
const BACKEND_STATES = new Set<string>([
  ...NAMED_EVIDENCE_STATES,
  "abi-unverified",
]);
const OBSERVED_STATES = new Set<string>([
  "covered",
  "unsupported",
  "fault",
  "abi-unverified",
]);
const DISPOSITIONS = new Set<string>(["required", "absent"]);
const UNKNOWN_KINDS = new Set<string>(["steam-interface", "controller-module"]);
const UNKNOWN_STATES = new Set<string>(["unsupported", "abi-unverified"]);

const MODULE_ROLES_BY_BACKEND = {
  "hid-overlapped": ["hid-api", "setupapi", "kernel-io"],
  "steam-input-006": ["steam-api"],
  "steam-controller-008": ["steam-api"],
  libscepad: ["libscepad"],
} as const satisfies Record<
  OverlayControllerMiddlewareBackend,
  readonly OverlayControllerModuleRole[]
>;

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

/**
 * Copies an untrusted JSON-shaped graph into frozen arrays/null-prototype
 * records. Each unsafe own property, including an array's length, is read once.
 * Parsers and evaluators only see the immutable copy.
 */
const snapshotUnsafe = (unsafeValue: unknown): SnapshotResult => {
  const seen = new WeakSet<object>();
  let totalNodes = 0;
  let aggregateStringBytes = 0;

  const accountString = (value: string) => {
    aggregateStringBytes += Buffer.byteLength(value, "utf8");
    return (
      aggregateStringBytes <=
      OVERLAY_CONTROLLER_SNAPSHOT_LIMITS.maxAggregateStringBytes
    );
  };

  const visit = (value: unknown, depth: number): SnapshotResult => {
    totalNodes += 1;
    if (
      totalNodes > OVERLAY_CONTROLLER_SNAPSHOT_LIMITS.maxTotalNodes ||
      depth > OVERLAY_CONTROLLER_SNAPSHOT_LIMITS.maxDepth
    ) {
      return { ok: false };
    }
    if (
      value === null ||
      typeof value === "boolean" ||
      typeof value === "number"
    ) {
      return { ok: true, value };
    }
    if (typeof value === "string") {
      return accountString(value) ? { ok: true, value } : { ok: false };
    }
    if (typeof value !== "object") return { ok: false };
    if (seen.has(value)) return { ok: false };
    seen.add(value);

    let isArrayValue: boolean;
    let keys: (string | symbol)[];
    try {
      isArrayValue = Array.isArray(value);
      keys = Reflect.ownKeys(value);
    } catch {
      return { ok: false };
    }
    if (
      keys.length >
        OVERLAY_CONTROLLER_SNAPSHOT_LIMITS.maxCollectionEntries + 1 ||
      keys.some((key) => typeof key !== "string")
    ) {
      return { ok: false };
    }

    const snapshotEntries: Array<readonly [string, SnapshotValue]> = [];
    try {
      for (const key of keys as string[]) {
        if (!accountString(key)) return { ok: false };
        const child = visit(Reflect.get(value, key), depth + 1);
        if (!child.ok) return child;
        snapshotEntries.push([key, child.value] as const);
      }
    } catch {
      return { ok: false };
    }

    if (isArrayValue) {
      const snapshotByKey = new Map(snapshotEntries);
      const unsafeLength = snapshotByKey.get("length");
      if (
        typeof unsafeLength !== "number" ||
        !Number.isSafeInteger(unsafeLength) ||
        unsafeLength < 0 ||
        unsafeLength >
          OVERLAY_CONTROLLER_SNAPSHOT_LIMITS.maxCollectionEntries ||
        snapshotByKey.size !== unsafeLength + 1
      ) {
        return { ok: false };
      }
      const result: SnapshotValue[] = new Array(unsafeLength);
      for (let index = 0; index < unsafeLength; index += 1) {
        const key = String(index);
        if (!snapshotByKey.has(key) || !ARRAY_INDEX.test(key)) {
          return { ok: false };
        }
        const child = snapshotByKey.get(key);
        if (child === undefined) return { ok: false };
        result[index] = child;
      }
      return { ok: true, value: Object.freeze(result) };
    }

    if (
      snapshotEntries.length >
      OVERLAY_CONTROLLER_SNAPSHOT_LIMITS.maxCollectionEntries
    ) {
      return { ok: false };
    }
    const result = Object.create(null) as Record<string, SnapshotValue>;
    for (const [key, child] of snapshotEntries) {
      Object.defineProperty(result, key, {
        value: child,
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    return { ok: true, value: Object.freeze(result) as SnapshotRecord };
  };

  try {
    return visit(unsafeValue, 0);
  } catch {
    return { ok: false };
  }
};

const isUint64Decimal = (value: unknown): value is string => {
  if (typeof value !== "string" || !UINT64_DECIMAL.test(value)) return false;
  try {
    return BigInt(value) <= UINT64_MAX;
  } catch {
    return false;
  }
};

const isPositiveUint64Decimal = (value: unknown): value is string =>
  typeof value === "string" &&
  POSITIVE_UINT64_DECIMAL.test(value) &&
  isUint64Decimal(value);

const normalizeModulePath = (value: string): string | null => {
  if (!value || value.includes("\0") || value.includes("/")) return null;
  if (!/^[a-z]:\\/iu.test(value) || value.startsWith("\\\\")) return null;
  const normalized = path.win32.normalize(value);
  if (
    !path.win32.isAbsolute(normalized) ||
    path.win32.extname(normalized).toLowerCase() !== ".dll"
  ) {
    return null;
  }
  return normalized === value ? normalized : null;
};

const moduleNameMatchesRole = (
  role: OverlayControllerModuleRole,
  moduleName: string,
  architecture: OverlayControllerArchitecture
) => {
  if (role === "hid-api") return moduleName === "hid.dll";
  if (role === "setupapi") return moduleName === "setupapi.dll";
  if (role === "kernel-io") {
    return moduleName === "kernelbase.dll" || moduleName === "kernel32.dll";
  }
  if (role === "steam-api") {
    return (
      moduleName ===
      (architecture === "x64" ? "steam_api64.dll" : "steam_api.dll")
    );
  }
  if (role === "libscepad") return moduleName === "libscepad.dll";
  return true;
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
    !isPositiveUint64Decimal(value.creationTicks) ||
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

const parseModuleIdentity = (
  value: unknown,
  architecture: OverlayControllerArchitecture
): OverlayControllerModuleIdentity | null => {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "role",
      "moduleName",
      "canonicalPath",
      "architecture",
      "volumeSerial",
      "fileId",
      "sha256",
      "imageSize",
      "loadAddress",
    ]) ||
    typeof value.role !== "string" ||
    !MODULE_ROLES.has(value.role) ||
    typeof value.moduleName !== "string" ||
    !MODULE_NAME.test(value.moduleName) ||
    !moduleNameMatchesRole(
      value.role as OverlayControllerModuleRole,
      value.moduleName,
      architecture
    ) ||
    typeof value.canonicalPath !== "string" ||
    normalizeModulePath(value.canonicalPath) !== value.canonicalPath ||
    path.win32.basename(value.canonicalPath).toLowerCase() !==
      value.moduleName ||
    value.architecture !== architecture ||
    typeof value.volumeSerial !== "string" ||
    !VOLUME_SERIAL.test(value.volumeSerial) ||
    typeof value.fileId !== "string" ||
    !FILE_ID.test(value.fileId) ||
    typeof value.sha256 !== "string" ||
    !SHA256.test(value.sha256) ||
    !Number.isSafeInteger(value.imageSize) ||
    (value.imageSize as number) < 1 ||
    (value.imageSize as number) > 0xffff_ffff ||
    !isPositiveUint64Decimal(value.loadAddress)
  ) {
    return null;
  }
  const loadAddress = BigInt(value.loadAddress);
  const endExclusive = loadAddress + BigInt(value.imageSize as number);
  const architectureExclusive =
    architecture === "x86" ? UINT32_EXCLUSIVE : UINT64_EXCLUSIVE;
  if (
    loadAddress >= architectureExclusive ||
    endExclusive > architectureExclusive ||
    endExclusive <= loadAddress
  ) {
    return null;
  }
  return {
    role: value.role as OverlayControllerModuleRole,
    moduleName: value.moduleName,
    canonicalPath: value.canonicalPath,
    architecture,
    volumeSerial: value.volumeSerial,
    fileId: value.fileId,
    sha256: value.sha256,
    imageSize: value.imageSize as number,
    loadAddress: value.loadAddress,
  };
};

const parseModules = (
  value: unknown,
  backend: OverlayControllerMiddlewareBackend,
  architecture: OverlayControllerArchitecture
): readonly OverlayControllerModuleIdentity[] | null => {
  if (!Array.isArray(value)) return null;
  const allowedRoles = MODULE_ROLES_BY_BACKEND[backend];
  const allowed = new Set<string>(allowedRoles);
  const modules: OverlayControllerModuleIdentity[] = [];
  const seen = new Set<OverlayControllerModuleRole>();
  for (const item of value) {
    const module = parseModuleIdentity(item, architecture);
    if (!module || !allowed.has(module.role) || seen.has(module.role)) {
      return null;
    }
    seen.add(module.role);
    modules.push(module);
  }
  const canonical = allowedRoles.filter((role) => seen.has(role));
  if (modules.some((module, index) => module.role !== canonical[index])) {
    return null;
  }
  return modules;
};

const parseEndpointIdentity = (
  value: unknown
): OverlayHidEndpointIdentity | null => {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "endpointId",
      "devicePathDigest",
      "containerId",
      "vendorId",
      "productId",
      "versionNumber",
      "usagePage",
      "usage",
      "collectionNumber",
    ]) ||
    typeof value.endpointId !== "string" ||
    !SHA256.test(value.endpointId) ||
    typeof value.devicePathDigest !== "string" ||
    !SHA256.test(value.devicePathDigest) ||
    typeof value.containerId !== "string" ||
    !GUID.test(value.containerId)
  ) {
    return null;
  }
  const numericFields = [
    value.vendorId,
    value.productId,
    value.versionNumber,
    value.usagePage,
    value.usage,
    value.collectionNumber,
  ];
  if (
    numericFields.some(
      (item) =>
        typeof item !== "number" ||
        !Number.isInteger(item) ||
        item < 0 ||
        item > 0xffff
    )
  ) {
    return null;
  }
  return {
    endpointId: value.endpointId,
    devicePathDigest: value.devicePathDigest,
    containerId: value.containerId,
    vendorId: value.vendorId as number,
    productId: value.productId as number,
    versionNumber: value.versionNumber as number,
    usagePage: value.usagePage as number,
    usage: value.usage as number,
    collectionNumber: value.collectionNumber as number,
  };
};

const validTransferSemantic = (
  operation: OverlayHidReportOperation,
  controlSemantic: OverlayHidControlSemantic,
  transferDirection: OverlayHidTransferDirection
) => {
  if (
    controlSemantic === "get-feature" ||
    controlSemantic === "get-input-report"
  ) {
    return (
      operation === "device-io-control" &&
      transferDirection === "device-to-host"
    );
  }
  if (
    controlSemantic === "set-feature" ||
    controlSemantic === "set-output-report"
  ) {
    return (
      operation === "device-io-control" &&
      transferDirection === "host-to-device"
    );
  }
  return (
    (transferDirection === "device-to-host" &&
      (operation === "read-file" || operation === "read-file-ex")) ||
    (transferDirection === "host-to-device" &&
      (operation === "write-file" || operation === "write-file-ex"))
  );
};

const reportSchemaOrder = (
  left: OverlayHidTrackedReportSchema,
  right: OverlayHidTrackedReportSchema
) => {
  const operationDifference =
    OVERLAY_HID_REPORT_OPERATIONS.indexOf(left.operation) -
    OVERLAY_HID_REPORT_OPERATIONS.indexOf(right.operation);
  if (operationDifference !== 0) return operationDifference;
  const semanticDifference =
    OVERLAY_HID_CONTROL_SEMANTICS.indexOf(left.controlSemantic) -
    OVERLAY_HID_CONTROL_SEMANTICS.indexOf(right.controlSemantic);
  if (semanticDifference !== 0) return semanticDifference;
  const directionDifference =
    OVERLAY_HID_TRANSFER_DIRECTIONS.indexOf(left.transferDirection) -
    OVERLAY_HID_TRANSFER_DIRECTIONS.indexOf(right.transferDirection);
  return directionDifference !== 0
    ? directionDifference
    : left.reportId - right.reportId;
};

const parseTrackedReportRecord = (
  item: unknown,
  keys: readonly string[],
  requireDeviceNeutralization: boolean
): OverlayHidTrackedReportSchema | null => {
  if (
    !isRecord(item) ||
    !exactKeys(item, keys) ||
    typeof item.operation !== "string" ||
    !HID_OPERATIONS.has(item.operation) ||
    typeof item.controlSemantic !== "string" ||
    !HID_CONTROL_SEMANTICS.has(item.controlSemantic) ||
    typeof item.transferDirection !== "string" ||
    !HID_TRANSFER_DIRECTIONS.has(item.transferDirection) ||
    !Number.isInteger(item.reportId) ||
    (item.reportId as number) < 0 ||
    (item.reportId as number) > 0xff ||
    !Number.isSafeInteger(item.byteLength) ||
    (item.byteLength as number) < 1 ||
    (item.byteLength as number) > 0xffff ||
    typeof item.schemaDigest !== "string" ||
    !SHA256.test(item.schemaDigest) ||
    typeof item.transferBindingDigest !== "string" ||
    !SHA256.test(item.transferBindingDigest) ||
    !(
      item.neutralReportDigest === null ||
      (typeof item.neutralReportDigest === "string" &&
        SHA256.test(item.neutralReportDigest))
    )
  ) {
    return null;
  }
  const operation = item.operation as OverlayHidReportOperation;
  const controlSemantic = item.controlSemantic as OverlayHidControlSemantic;
  const transferDirection =
    item.transferDirection as OverlayHidTransferDirection;
  if (
    !validTransferSemantic(operation, controlSemantic, transferDirection) ||
    (transferDirection === "host-to-device" &&
      item.neutralReportDigest !== null) ||
    (requireDeviceNeutralization &&
      transferDirection === "device-to-host" &&
      item.neutralReportDigest === null)
  ) {
    return null;
  }
  return {
    operation,
    controlSemantic,
    transferDirection,
    reportId: item.reportId as number,
    byteLength: item.byteLength as number,
    schemaDigest: item.schemaDigest,
    transferBindingDigest: item.transferBindingDigest,
    neutralReportDigest: item.neutralReportDigest as string | null,
  };
};

const parseTrackedReports = (
  value: unknown
): readonly OverlayHidTrackedReportSchema[] | null => {
  if (!Array.isArray(value)) return null;
  const reports: OverlayHidTrackedReportSchema[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const report = parseTrackedReportRecord(
      item,
      [
        "operation",
        "controlSemantic",
        "transferDirection",
        "reportId",
        "byteLength",
        "schemaDigest",
        "transferBindingDigest",
        "neutralReportDigest",
      ],
      true
    );
    if (!report) return null;
    const key = `${report.operation}\0${report.controlSemantic}\0${report.transferDirection}\0${report.reportId}`;
    if (seen.has(key)) return null;
    seen.add(key);
    reports.push(report);
  }
  for (let index = 1; index < reports.length; index += 1) {
    const previous = reports[index - 1];
    const current = reports[index];
    if (!previous || !current || reportSchemaOrder(previous, current) >= 0) {
      return null;
    }
  }
  return reports;
};

const parseNamedEvidence = <TName extends string>(
  value: unknown,
  canonical: readonly TName[],
  known: ReadonlySet<string>
): readonly OverlayControllerNamedEvidence<TName>[] | null => {
  if (!Array.isArray(value)) return null;
  const evidence: OverlayControllerNamedEvidence<TName>[] = [];
  const seen = new Set<TName>();
  for (const item of value) {
    if (
      !isRecord(item) ||
      !exactKeys(item, ["name", "state"]) ||
      typeof item.name !== "string" ||
      !known.has(item.name) ||
      typeof item.state !== "string" ||
      !NAMED_EVIDENCE_STATES.has(item.state)
    ) {
      return null;
    }
    const name = item.name as TName;
    if (seen.has(name)) return null;
    seen.add(name);
    evidence.push({
      name,
      state: item.state as Exclude<
        OverlayControllerEvidenceState,
        "abi-unverified"
      >,
    });
  }
  const ordered = canonical.filter((name) => seen.has(name));
  if (evidence.some((item, index) => item.name !== ordered[index])) {
    return null;
  }
  return evidence;
};

const parseOutputHoldReplay = (
  value: unknown
): OverlayOutputHoldReplayEvidence | null => {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "holdWhileBlocked",
      "replayLatestOnceOnRelease",
      "generationBound",
      "endpointBound",
      "dropOnCloseOrDisconnect",
      "orderedAfterInputRelease",
    ]) ||
    typeof value.holdWhileBlocked !== "boolean" ||
    typeof value.replayLatestOnceOnRelease !== "boolean" ||
    typeof value.generationBound !== "boolean" ||
    typeof value.endpointBound !== "boolean" ||
    typeof value.dropOnCloseOrDisconnect !== "boolean" ||
    typeof value.orderedAfterInputRelease !== "boolean"
  ) {
    return null;
  }
  return {
    holdWhileBlocked: value.holdWhileBlocked,
    replayLatestOnceOnRelease: value.replayLatestOnceOnRelease,
    generationBound: value.generationBound,
    endpointBound: value.endpointBound,
    dropOnCloseOrDisconnect: value.dropOnCloseOrDisconnect,
    orderedAfterInputRelease: value.orderedAfterInputRelease,
  };
};

const parseHidTransferHoldReplay = (
  value: unknown
): OverlayHidTransferHoldReplayEvidence | null => {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "holdWhileBlocked",
      "replayLatestOnceOnRelease",
      "generationBound",
      "endpointBound",
      "dropOnCloseOrDisconnect",
      "orderedAfterInputRelease",
      "transferBindingDigest",
    ]) ||
    typeof value.transferBindingDigest !== "string" ||
    !SHA256.test(value.transferBindingDigest)
  ) {
    return null;
  }
  const base = parseOutputHoldReplay({
    holdWhileBlocked: value.holdWhileBlocked,
    replayLatestOnceOnRelease: value.replayLatestOnceOnRelease,
    generationBound: value.generationBound,
    endpointBound: value.endpointBound,
    dropOnCloseOrDisconnect: value.dropOnCloseOrDisconnect,
    orderedAfterInputRelease: value.orderedAfterInputRelease,
  });
  return base
    ? { ...base, transferBindingDigest: value.transferBindingDigest }
    : null;
};

const parseTrackedTransfers = (
  value: unknown
): readonly OverlayHidTrackedTransferEvidence[] | null => {
  if (!Array.isArray(value)) return null;
  const transfers: OverlayHidTrackedTransferEvidence[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const report = parseTrackedReportRecord(
      item,
      [
        "operation",
        "controlSemantic",
        "transferDirection",
        "reportId",
        "byteLength",
        "schemaDigest",
        "transferBindingDigest",
        "neutralReportDigest",
        "outputHoldReplay",
      ],
      false
    );
    if (!report || !isRecord(item)) return null;
    const outputHoldReplay =
      item.outputHoldReplay === null
        ? null
        : parseHidTransferHoldReplay(item.outputHoldReplay);
    if (
      (item.outputHoldReplay !== null && !outputHoldReplay) ||
      (report.transferDirection === "device-to-host" &&
        outputHoldReplay !== null)
    ) {
      return null;
    }
    const key = `${report.operation}\0${report.controlSemantic}\0${report.transferDirection}\0${report.reportId}`;
    if (seen.has(key)) return null;
    seen.add(key);
    transfers.push({ ...report, outputHoldReplay });
  }
  for (let index = 1; index < transfers.length; index += 1) {
    const previous = transfers[index - 1];
    const current = transfers[index];
    if (!previous || !current || reportSchemaOrder(previous, current) >= 0) {
      return null;
    }
  }
  return transfers;
};

const compareEndpointGeneration = (
  left: Pick<OverlayHidEndpointExpectation, "endpoint" | "handleGeneration">,
  right: Pick<OverlayHidEndpointExpectation, "endpoint" | "handleGeneration">
) => {
  const endpointOrder =
    left.endpoint.endpointId < right.endpoint.endpointId
      ? -1
      : left.endpoint.endpointId > right.endpoint.endpointId
        ? 1
        : 0;
  if (endpointOrder !== 0) return endpointOrder;
  const leftGeneration = BigInt(left.handleGeneration);
  const rightGeneration = BigInt(right.handleGeneration);
  return leftGeneration < rightGeneration
    ? -1
    : leftGeneration > rightGeneration
      ? 1
      : 0;
};

const parseHidEndpointExpectation = (
  value: unknown
): OverlayHidEndpointExpectation | null => {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "endpoint",
      "handleGeneration",
      "pendingDrainEpoch",
      "lateCompletionEpoch",
      "trackedReports",
    ]) ||
    !isPositiveUint64Decimal(value.handleGeneration) ||
    !isPositiveUint64Decimal(value.pendingDrainEpoch) ||
    !isPositiveUint64Decimal(value.lateCompletionEpoch) ||
    BigInt(value.lateCompletionEpoch) <= BigInt(value.pendingDrainEpoch)
  ) {
    return null;
  }
  const endpoint = parseEndpointIdentity(value.endpoint);
  const trackedReports = parseTrackedReports(value.trackedReports);
  if (!endpoint || !trackedReports || trackedReports.length === 0) return null;
  return {
    endpoint,
    handleGeneration: value.handleGeneration,
    pendingDrainEpoch: value.pendingDrainEpoch,
    lateCompletionEpoch: value.lateCompletionEpoch,
    trackedReports,
  };
};

const parseHidEndpointExpectations = (
  value: unknown
): readonly OverlayHidEndpointExpectation[] | null => {
  if (!Array.isArray(value)) return null;
  const endpoints: OverlayHidEndpointExpectation[] = [];
  for (const item of value) {
    const endpoint = parseHidEndpointExpectation(item);
    if (!endpoint) return null;
    endpoints.push(endpoint);
  }
  for (let index = 1; index < endpoints.length; index += 1) {
    const previous = endpoints[index - 1];
    const current = endpoints[index];
    if (
      !previous ||
      !current ||
      compareEndpointGeneration(previous, current) >= 0
    ) {
      return null;
    }
  }
  return endpoints;
};

const parseHidEndpointEvidence = (
  value: unknown
): OverlayHidEndpointEvidence | null => {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "endpoint",
      "handleGeneration",
      "pendingDrainEpoch",
      "lateCompletionEpoch",
      "trackedTransfers",
      "pendingCompletionsDrained",
      "lateCompletionFenceArmed",
      "routes",
    ]) ||
    !isPositiveUint64Decimal(value.handleGeneration) ||
    !isPositiveUint64Decimal(value.pendingDrainEpoch) ||
    !isPositiveUint64Decimal(value.lateCompletionEpoch) ||
    BigInt(value.lateCompletionEpoch) <= BigInt(value.pendingDrainEpoch) ||
    typeof value.pendingCompletionsDrained !== "boolean" ||
    typeof value.lateCompletionFenceArmed !== "boolean"
  ) {
    return null;
  }
  const endpoint = parseEndpointIdentity(value.endpoint);
  const trackedTransfers = parseTrackedTransfers(value.trackedTransfers);
  const routes = parseNamedEvidence(
    value.routes,
    OVERLAY_HID_ROUTES,
    HID_ROUTES
  );
  if (
    !endpoint ||
    !trackedTransfers ||
    trackedTransfers.length === 0 ||
    !routes
  ) {
    return null;
  }
  return {
    endpoint,
    handleGeneration: value.handleGeneration,
    pendingDrainEpoch: value.pendingDrainEpoch,
    lateCompletionEpoch: value.lateCompletionEpoch,
    trackedTransfers,
    pendingCompletionsDrained: value.pendingCompletionsDrained,
    lateCompletionFenceArmed: value.lateCompletionFenceArmed,
    routes,
  };
};

const parseHidEndpointEvidenceSet = (
  value: unknown
): readonly OverlayHidEndpointEvidence[] | null => {
  if (!Array.isArray(value)) return null;
  const endpoints: OverlayHidEndpointEvidence[] = [];
  for (const item of value) {
    const endpoint = parseHidEndpointEvidence(item);
    if (!endpoint) return null;
    endpoints.push(endpoint);
  }
  for (let index = 1; index < endpoints.length; index += 1) {
    const previous = endpoints[index - 1];
    const current = endpoints[index];
    if (
      !previous ||
      !current ||
      compareEndpointGeneration(previous, current) >= 0
    ) {
      return null;
    }
  }
  return endpoints;
};

const hasExactRoles = (
  modules: readonly OverlayControllerModuleIdentity[],
  backend: OverlayControllerMiddlewareBackend
) => {
  const roles = MODULE_ROLES_BY_BACKEND[backend];
  return (
    modules.length === roles.length &&
    modules.every((module, index) => module.role === roles[index])
  );
};

const parseBackendExpectation = (
  value: unknown,
  architecture: OverlayControllerArchitecture
): OverlayControllerBackendExpectation | null => {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "backend",
      "disposition",
      "modules",
      "interfaceRevision",
      "abiSchemaDigest",
      "hidEndpoints",
    ]) ||
    typeof value.backend !== "string" ||
    !BACKENDS.has(value.backend) ||
    typeof value.disposition !== "string" ||
    !DISPOSITIONS.has(value.disposition)
  ) {
    return null;
  }
  const backend = value.backend as OverlayControllerMiddlewareBackend;
  const disposition =
    value.disposition as OverlayControllerExpectationDisposition;
  const modules = parseModules(value.modules, backend, architecture);
  const hidEndpoints = parseHidEndpointExpectations(value.hidEndpoints);
  if (!modules || !hidEndpoints) return null;

  if (disposition === "absent") {
    if (
      modules.length !== 0 ||
      value.interfaceRevision !== null ||
      value.abiSchemaDigest !== null ||
      hidEndpoints.length !== 0
    ) {
      return null;
    }
  } else {
    // No libScePad ABI schema has passed the independent native audit yet.
    if (backend === "libscepad" || !hasExactRoles(modules, backend)) {
      return null;
    }
    const expectedRevision =
      backend === "hid-overlapped"
        ? "win32-hid-overlapped-v2"
        : backend === "steam-input-006"
          ? "SteamInput006"
          : "SteamController008";
    if (
      value.interfaceRevision !== expectedRevision ||
      typeof value.abiSchemaDigest !== "string" ||
      !SHA256.test(value.abiSchemaDigest) ||
      (backend === "hid-overlapped"
        ? hidEndpoints.length === 0
        : hidEndpoints.length !== 0)
    ) {
      return null;
    }
  }
  return {
    backend,
    disposition,
    modules,
    interfaceRevision: value.interfaceRevision as string | null,
    abiSchemaDigest: value.abiSchemaDigest as string | null,
    hidEndpoints,
  };
};

const methodsForBackend = (
  backend: OverlayControllerMiddlewareBackend
): {
  canonical: readonly OverlayControllerMethod[];
  known: ReadonlySet<string>;
} => {
  if (backend === "steam-input-006") {
    return {
      canonical: OVERLAY_STEAM_INPUT_006_METHODS,
      known: STEAM_INPUT_METHODS,
    };
  }
  if (backend === "steam-controller-008") {
    return {
      canonical: OVERLAY_STEAM_CONTROLLER_008_METHODS,
      known: STEAM_CONTROLLER_METHODS,
    };
  }
  return { canonical: [], known: new Set<string>() };
};

const parseBackendEvidence = (
  value: unknown,
  architecture: OverlayControllerArchitecture
): OverlayControllerBackendEvidence | null => {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "backend",
      "state",
      "modules",
      "interfaceRevision",
      "abiSchemaDigest",
      "hidEndpoints",
      "methods",
      "outputHoldReplay",
    ]) ||
    typeof value.backend !== "string" ||
    !BACKENDS.has(value.backend) ||
    typeof value.state !== "string" ||
    !BACKEND_STATES.has(value.state)
  ) {
    return null;
  }
  const backend = value.backend as OverlayControllerMiddlewareBackend;
  const state = value.state as OverlayControllerEvidenceState;
  if (
    (backend === "libscepad" &&
      state !== "absent" &&
      state !== "abi-unverified") ||
    (backend !== "libscepad" && state === "abi-unverified")
  ) {
    return null;
  }
  const modules = parseModules(value.modules, backend, architecture);
  const hidEndpoints = parseHidEndpointEvidenceSet(value.hidEndpoints);
  const methodProfile = methodsForBackend(backend);
  const methods = parseNamedEvidence(
    value.methods,
    methodProfile.canonical,
    methodProfile.known
  );
  const outputHoldReplay =
    value.outputHoldReplay === null
      ? null
      : parseOutputHoldReplay(value.outputHoldReplay);
  if (!modules || !hidEndpoints || !methods) return null;
  if (value.outputHoldReplay !== null && !outputHoldReplay) return null;

  if (state === "absent") {
    if (
      modules.length !== 0 ||
      value.interfaceRevision !== null ||
      value.abiSchemaDigest !== null ||
      hidEndpoints.length !== 0 ||
      methods.length !== 0 ||
      outputHoldReplay !== null
    ) {
      return null;
    }
  } else {
    if (
      !hasExactRoles(modules, backend) ||
      typeof value.interfaceRevision !== "string" ||
      !INTERFACE_REVISION.test(value.interfaceRevision) ||
      typeof value.abiSchemaDigest !== "string" ||
      !SHA256.test(value.abiSchemaDigest)
    ) {
      return null;
    }
    if (backend === "hid-overlapped") {
      if (
        hidEndpoints.length === 0 ||
        methods.length !== 0 ||
        outputHoldReplay !== null
      ) {
        return null;
      }
    } else if (
      hidEndpoints.length !== 0 ||
      (backend === "libscepad" &&
        (methods.length !== 0 || outputHoldReplay !== null))
    ) {
      return null;
    }
    if (
      state === "covered" &&
      backend !== "hid-overlapped" &&
      !outputHoldReplay
    ) {
      return null;
    }
  }
  return {
    backend,
    state,
    modules,
    interfaceRevision: value.interfaceRevision as string | null,
    abiSchemaDigest: value.abiSchemaDigest as string | null,
    hidEndpoints,
    methods,
    outputHoldReplay,
  };
};

const parseInventoryEntry = (
  value: unknown,
  architecture: OverlayControllerArchitecture
): OverlayControllerObservedInventoryEntry | null => {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "backend",
      "module",
      "interfaceRevision",
      "abiSchemaDigest",
      "state",
    ]) ||
    typeof value.backend !== "string" ||
    !BACKENDS.has(value.backend) ||
    typeof value.interfaceRevision !== "string" ||
    !INTERFACE_REVISION.test(value.interfaceRevision) ||
    typeof value.abiSchemaDigest !== "string" ||
    !SHA256.test(value.abiSchemaDigest) ||
    typeof value.state !== "string" ||
    !OBSERVED_STATES.has(value.state)
  ) {
    return null;
  }
  const module = parseModuleIdentity(value.module, architecture);
  const backend = value.backend as OverlayControllerMiddlewareBackend;
  if (
    !module ||
    !MODULE_ROLES_BY_BACKEND[backend].includes(module.role as never)
  ) {
    return null;
  }
  return {
    backend,
    module,
    interfaceRevision: value.interfaceRevision,
    abiSchemaDigest: value.abiSchemaDigest,
    state: value.state as OverlayControllerObservedState,
  };
};

const inventoryKey = (entry: OverlayControllerObservedInventoryEntry) =>
  `${String(OVERLAY_CONTROLLER_MIDDLEWARE_BACKENDS.indexOf(entry.backend)).padStart(2, "0")}\0${String(OVERLAY_CONTROLLER_MODULE_ROLES.indexOf(entry.module.role)).padStart(2, "0")}\0${entry.module.canonicalPath}\0${entry.interfaceRevision}`;

const parseInventory = (
  value: unknown,
  architecture: OverlayControllerArchitecture
): readonly OverlayControllerObservedInventoryEntry[] | null => {
  if (!Array.isArray(value)) return null;
  const entries: OverlayControllerObservedInventoryEntry[] = [];
  let previousKey: string | null = null;
  for (const item of value) {
    const entry = parseInventoryEntry(item, architecture);
    if (!entry) return null;
    const key = inventoryKey(entry);
    if (previousKey !== null && key <= previousKey) return null;
    previousKey = key;
    entries.push(entry);
  }
  return entries;
};

const parseUnknownObservation = (
  value: unknown,
  architecture: OverlayControllerArchitecture
): OverlayControllerUnknownObservation | null => {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "kind",
      "module",
      "observedInterface",
      "observationDigest",
      "state",
    ]) ||
    typeof value.kind !== "string" ||
    !UNKNOWN_KINDS.has(value.kind) ||
    typeof value.observedInterface !== "string" ||
    !INTERFACE_REVISION.test(value.observedInterface) ||
    typeof value.observationDigest !== "string" ||
    !SHA256.test(value.observationDigest) ||
    typeof value.state !== "string" ||
    !UNKNOWN_STATES.has(value.state)
  ) {
    return null;
  }
  const module = parseModuleIdentity(value.module, architecture);
  if (
    !module ||
    (value.kind === "steam-interface" &&
      (module.role !== "steam-api" || value.state !== "unsupported"))
  ) {
    return null;
  }
  return {
    kind: value.kind as OverlayControllerUnknownObservation["kind"],
    module,
    observedInterface: value.observedInterface,
    observationDigest: value.observationDigest,
    state: value.state as OverlayControllerUnknownObservation["state"],
  };
};

const unknownObservationKey = (item: OverlayControllerUnknownObservation) =>
  `${item.kind}\0${item.module.canonicalPath}\0${item.observedInterface}`;

const parseUnknownObservations = (
  value: unknown,
  architecture: OverlayControllerArchitecture
): readonly OverlayControllerUnknownObservation[] | null => {
  if (!Array.isArray(value)) return null;
  const observations: OverlayControllerUnknownObservation[] = [];
  let previousKey: string | null = null;
  for (const item of value) {
    const observation = parseUnknownObservation(item, architecture);
    if (!observation) return null;
    const key = unknownObservationKey(observation);
    if (previousKey !== null && key <= previousKey) return null;
    previousKey = key;
    observations.push(observation);
  }
  return observations;
};

const inventoryFromExpectations = (
  expectations: readonly OverlayControllerBackendExpectation[]
): OverlayControllerObservedInventoryEntry[] =>
  expectations.flatMap((expectation) =>
    expectation.disposition === "absent"
      ? []
      : expectation.modules.map((module) => ({
          backend: expectation.backend,
          module,
          interfaceRevision: expectation.interfaceRevision as string,
          abiSchemaDigest: expectation.abiSchemaDigest as string,
          state: "covered" as const,
        }))
  );

const inventoryFromEvidence = (
  evidence: readonly OverlayControllerBackendEvidence[]
): OverlayControllerObservedInventoryEntry[] =>
  evidence.flatMap((item) =>
    item.state === "absent"
      ? []
      : item.modules.map((module) => ({
          backend: item.backend,
          module,
          interfaceRevision: item.interfaceRevision as string,
          abiSchemaDigest: item.abiSchemaDigest as string,
          state: item.state as OverlayControllerObservedState,
        }))
  );

const sameModule = (
  left: OverlayControllerModuleIdentity,
  right: OverlayControllerModuleIdentity
) =>
  left.role === right.role &&
  left.moduleName === right.moduleName &&
  left.canonicalPath === right.canonicalPath &&
  left.architecture === right.architecture &&
  left.volumeSerial === right.volumeSerial &&
  left.fileId === right.fileId &&
  left.sha256 === right.sha256 &&
  left.imageSize === right.imageSize &&
  left.loadAddress === right.loadAddress;

const sameInventory = (
  left: readonly OverlayControllerObservedInventoryEntry[],
  right: readonly OverlayControllerObservedInventoryEntry[]
) =>
  left.length === right.length &&
  left.every((entry, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      entry.backend === other.backend &&
      sameModule(entry.module, other.module) &&
      entry.interfaceRevision === other.interfaceRevision &&
      entry.abiSchemaDigest === other.abiSchemaDigest &&
      entry.state === other.state
    );
  });

const parseExpectation = (
  value: unknown
): OverlayControllerMiddlewareCapabilityExpectation | null => {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "identity",
      "inputGeneration",
      "middlewareGeneration",
      "topologyEpoch",
      "nativeCommitSequence",
      "nativeCommitDigest",
      "absenceMonitorEpoch",
      "targetArchitecture",
      "unknownObservationSetDigest",
      "observedInventory",
      "unknownObservations",
      "backendExpectations",
    ]) ||
    !isPositiveUint64Decimal(value.inputGeneration) ||
    !isPositiveUint64Decimal(value.middlewareGeneration) ||
    !isPositiveUint64Decimal(value.topologyEpoch) ||
    !isPositiveUint64Decimal(value.nativeCommitSequence) ||
    typeof value.nativeCommitDigest !== "string" ||
    !SHA256.test(value.nativeCommitDigest) ||
    !isPositiveUint64Decimal(value.absenceMonitorEpoch) ||
    typeof value.targetArchitecture !== "string" ||
    !ARCHITECTURES.has(value.targetArchitecture) ||
    typeof value.unknownObservationSetDigest !== "string" ||
    !SHA256.test(value.unknownObservationSetDigest) ||
    !Array.isArray(value.backendExpectations) ||
    !Array.isArray(value.unknownObservations) ||
    value.unknownObservations.length !== 0 ||
    value.backendExpectations.length !==
      OVERLAY_CONTROLLER_MIDDLEWARE_BACKENDS.length
  ) {
    return null;
  }
  const identity = parseIdentity(value.identity);
  if (!identity) return null;
  const architecture =
    value.targetArchitecture as OverlayControllerArchitecture;
  const backendExpectations: OverlayControllerBackendExpectation[] = [];
  for (
    let index = 0;
    index < OVERLAY_CONTROLLER_MIDDLEWARE_BACKENDS.length;
    index += 1
  ) {
    const rawItem = value.backendExpectations[index];
    const expectedBackend = OVERLAY_CONTROLLER_MIDDLEWARE_BACKENDS[index];
    const item = parseBackendExpectation(rawItem, architecture);
    if (
      !item ||
      expectedBackend === undefined ||
      item.backend !== expectedBackend
    ) {
      return null;
    }
    backendExpectations.push(item);
  }
  const observedInventory = parseInventory(
    value.observedInventory,
    architecture
  );
  if (
    !observedInventory ||
    !sameInventory(
      observedInventory,
      inventoryFromExpectations(backendExpectations)
    )
  ) {
    return null;
  }
  return {
    identity,
    inputGeneration: value.inputGeneration,
    middlewareGeneration: value.middlewareGeneration,
    topologyEpoch: value.topologyEpoch,
    nativeCommitSequence: value.nativeCommitSequence,
    nativeCommitDigest: value.nativeCommitDigest,
    absenceMonitorEpoch: value.absenceMonitorEpoch,
    targetArchitecture: architecture,
    unknownObservationSetDigest: value.unknownObservationSetDigest,
    observedInventory,
    unknownObservations: [],
    backendExpectations,
  };
};

const parseReport = (
  value: unknown
): OverlayControllerMiddlewareCapabilityReport | null => {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "schemaVersion",
      "identity",
      "inputGeneration",
      "middlewareGeneration",
      "topologyEpoch",
      "nativeCommitSequence",
      "nativeCommitDigest",
      "absenceMonitorEpoch",
      "targetArchitecture",
      "unknownObservationSetDigest",
      "completeModuleSnapshot",
      "completeInterfaceInventory",
      "absenceMonitorArmed",
      "preEntryBootstrap",
      "cachedPointerInlineDetours",
      "handleLifecycleFence",
      "completionDrainFence",
      "hookReaderFence",
      "observedInventory",
      "unknownObservations",
      "backendEvidence",
    ]) ||
    value.schemaVersion !== 2 ||
    !isPositiveUint64Decimal(value.inputGeneration) ||
    !isPositiveUint64Decimal(value.middlewareGeneration) ||
    !isPositiveUint64Decimal(value.topologyEpoch) ||
    !isPositiveUint64Decimal(value.nativeCommitSequence) ||
    typeof value.nativeCommitDigest !== "string" ||
    !SHA256.test(value.nativeCommitDigest) ||
    !isPositiveUint64Decimal(value.absenceMonitorEpoch) ||
    typeof value.targetArchitecture !== "string" ||
    !ARCHITECTURES.has(value.targetArchitecture) ||
    typeof value.unknownObservationSetDigest !== "string" ||
    !SHA256.test(value.unknownObservationSetDigest) ||
    typeof value.completeModuleSnapshot !== "boolean" ||
    typeof value.completeInterfaceInventory !== "boolean" ||
    typeof value.absenceMonitorArmed !== "boolean" ||
    typeof value.preEntryBootstrap !== "boolean" ||
    typeof value.cachedPointerInlineDetours !== "boolean" ||
    typeof value.handleLifecycleFence !== "boolean" ||
    typeof value.completionDrainFence !== "boolean" ||
    typeof value.hookReaderFence !== "boolean" ||
    !Array.isArray(value.backendEvidence) ||
    value.backendEvidence.length !==
      OVERLAY_CONTROLLER_MIDDLEWARE_BACKENDS.length
  ) {
    return null;
  }
  const identity = parseIdentity(value.identity);
  if (!identity) return null;
  const architecture =
    value.targetArchitecture as OverlayControllerArchitecture;
  const backendEvidence: OverlayControllerBackendEvidence[] = [];
  for (
    let index = 0;
    index < OVERLAY_CONTROLLER_MIDDLEWARE_BACKENDS.length;
    index += 1
  ) {
    const rawItem = value.backendEvidence[index];
    const expectedBackend = OVERLAY_CONTROLLER_MIDDLEWARE_BACKENDS[index];
    const item = parseBackendEvidence(rawItem, architecture);
    if (
      !item ||
      expectedBackend === undefined ||
      item.backend !== expectedBackend
    ) {
      return null;
    }
    backendEvidence.push(item);
  }
  const observedInventory = parseInventory(
    value.observedInventory,
    architecture
  );
  const unknownObservations = parseUnknownObservations(
    value.unknownObservations,
    architecture
  );
  if (
    !observedInventory ||
    !unknownObservations ||
    !sameInventory(observedInventory, inventoryFromEvidence(backendEvidence))
  ) {
    return null;
  }
  return {
    schemaVersion: 2,
    identity,
    inputGeneration: value.inputGeneration,
    middlewareGeneration: value.middlewareGeneration,
    topologyEpoch: value.topologyEpoch,
    nativeCommitSequence: value.nativeCommitSequence,
    nativeCommitDigest: value.nativeCommitDigest,
    absenceMonitorEpoch: value.absenceMonitorEpoch,
    targetArchitecture: architecture,
    unknownObservationSetDigest: value.unknownObservationSetDigest,
    completeModuleSnapshot: value.completeModuleSnapshot,
    completeInterfaceInventory: value.completeInterfaceInventory,
    absenceMonitorArmed: value.absenceMonitorArmed,
    preEntryBootstrap: value.preEntryBootstrap,
    cachedPointerInlineDetours: value.cachedPointerInlineDetours,
    handleLifecycleFence: value.handleLifecycleFence,
    completionDrainFence: value.completionDrainFence,
    hookReaderFence: value.hookReaderFence,
    observedInventory,
    unknownObservations,
    backendEvidence,
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

const sameModules = (
  left: readonly OverlayControllerModuleIdentity[],
  right: readonly OverlayControllerModuleIdentity[]
) =>
  left.length === right.length &&
  left.every((module, index) => {
    const other = right[index];
    return other !== undefined && sameModule(module, other);
  });

const sameEndpointIdentity = (
  left: OverlayHidEndpointIdentity,
  right: OverlayHidEndpointIdentity
) =>
  left.endpointId === right.endpointId &&
  left.devicePathDigest === right.devicePathDigest &&
  left.containerId === right.containerId &&
  left.vendorId === right.vendorId &&
  left.productId === right.productId &&
  left.versionNumber === right.versionNumber &&
  left.usagePage === right.usagePage &&
  left.usage === right.usage &&
  left.collectionNumber === right.collectionNumber;

const outputHoldReplayReady = (
  evidence: OverlayOutputHoldReplayEvidence | null
) =>
  evidence !== null &&
  evidence.holdWhileBlocked === true &&
  evidence.replayLatestOnceOnRelease === true &&
  evidence.generationBound === true &&
  evidence.endpointBound === true &&
  evidence.dropOnCloseOrDisconnect === true &&
  evidence.orderedAfterInputRelease === true;

const freezeModule = (module: OverlayControllerModuleIdentity) =>
  Object.freeze({ ...module });
const freezeEndpointIdentity = (endpoint: OverlayHidEndpointIdentity) =>
  Object.freeze({ ...endpoint });
const freezeOutput = (output: OverlayOutputHoldReplayEvidence) =>
  Object.freeze({ ...output });
const freezeHidTransferOutput = (
  output: OverlayHidTransferHoldReplayEvidence
) => Object.freeze({ ...output });
const freezeTrackedTransfer = (transfer: OverlayHidTrackedTransferEvidence) =>
  Object.freeze({
    ...transfer,
    outputHoldReplay:
      transfer.outputHoldReplay === null
        ? null
        : freezeHidTransferOutput(transfer.outputHoldReplay),
  });

const freezeHidEndpointEvidence = (endpoint: OverlayHidEndpointEvidence) =>
  Object.freeze({
    ...endpoint,
    endpoint: freezeEndpointIdentity(endpoint.endpoint),
    trackedTransfers: Object.freeze(
      endpoint.trackedTransfers.map(freezeTrackedTransfer)
    ),
    routes: Object.freeze(
      endpoint.routes.map((route) => Object.freeze({ ...route }))
    ),
  });

const freezeInventory = (
  inventory: readonly OverlayControllerObservedInventoryEntry[]
) =>
  Object.freeze(
    inventory.map((entry) =>
      Object.freeze({ ...entry, module: freezeModule(entry.module) })
    )
  );

const freezeUnknownObservations = (
  observations: readonly OverlayControllerUnknownObservation[]
) =>
  Object.freeze(
    observations.map((item) =>
      Object.freeze({ ...item, module: freezeModule(item.module) })
    )
  );

const freezeReport = (
  report: OverlayControllerMiddlewareCapabilityReport
): OverlayControllerMiddlewareCapabilityReport =>
  Object.freeze({
    ...report,
    identity: Object.freeze({ ...report.identity }),
    observedInventory: freezeInventory(report.observedInventory),
    unknownObservations: freezeUnknownObservations(report.unknownObservations),
    backendEvidence: Object.freeze(
      report.backendEvidence.map((evidence) =>
        Object.freeze({
          ...evidence,
          modules: Object.freeze(evidence.modules.map(freezeModule)),
          hidEndpoints: Object.freeze(
            evidence.hidEndpoints.map(freezeHidEndpointEvidence)
          ),
          methods: Object.freeze(
            evidence.methods.map((method) => Object.freeze({ ...method }))
          ),
          outputHoldReplay:
            evidence.outputHoldReplay === null
              ? null
              : freezeOutput(evidence.outputHoldReplay),
        })
      )
    ),
  });

const evaluateParsedReport = (
  report: OverlayControllerMiddlewareCapabilityReport,
  expected: OverlayControllerMiddlewareCapabilityExpectation
): OverlayControllerMiddlewareCapabilityEvaluation => {
  if (!sameIdentity(report.identity, expected.identity)) {
    return { valid: false, reason: "target-identity-mismatch" };
  }
  if (report.inputGeneration !== expected.inputGeneration) {
    return { valid: false, reason: "stale-input-generation" };
  }
  if (report.middlewareGeneration !== expected.middlewareGeneration) {
    return { valid: false, reason: "stale-middleware-generation" };
  }
  if (report.topologyEpoch !== expected.topologyEpoch) {
    return { valid: false, reason: "stale-topology-epoch" };
  }
  if (report.nativeCommitSequence !== expected.nativeCommitSequence) {
    return { valid: false, reason: "stale-commit-sequence" };
  }
  if (report.nativeCommitDigest !== expected.nativeCommitDigest) {
    return { valid: false, reason: "native-commit-digest-mismatch" };
  }
  if (report.absenceMonitorEpoch !== expected.absenceMonitorEpoch) {
    return { valid: false, reason: "stale-absence-monitor-epoch" };
  }
  if (report.targetArchitecture !== expected.targetArchitecture) {
    return { valid: false, reason: "target-architecture-mismatch" };
  }
  if (report.unknownObservations.length !== 0) {
    return { valid: false, reason: "unknown-observation" };
  }
  if (
    report.unknownObservationSetDigest !== expected.unknownObservationSetDigest
  ) {
    return {
      valid: false,
      reason: "unknown-observation-set-digest-mismatch",
    };
  }
  const libScePad = report.backendEvidence[3];
  if (!libScePad || libScePad.backend !== "libscepad") {
    return { valid: false, reason: "invalid-report" };
  }
  if (libScePad.state !== "absent") {
    return {
      valid: false,
      reason: "libscepad-abi-unverified",
      backend: "libscepad",
    };
  }
  if (!sameInventory(report.observedInventory, expected.observedInventory)) {
    return { valid: false, reason: "observed-inventory-mismatch" };
  }
  if (report.completeModuleSnapshot !== true) {
    return { valid: false, reason: "incomplete-module-snapshot" };
  }
  if (report.completeInterfaceInventory !== true) {
    return { valid: false, reason: "incomplete-interface-inventory" };
  }
  if (report.absenceMonitorArmed !== true) {
    return { valid: false, reason: "absence-monitor-unavailable" };
  }
  if (report.preEntryBootstrap !== true) {
    return { valid: false, reason: "pre-entry-bootstrap-required" };
  }
  if (report.cachedPointerInlineDetours !== true) {
    return { valid: false, reason: "cached-pointer-detours-required" };
  }
  if (report.handleLifecycleFence !== true) {
    return { valid: false, reason: "handle-lifecycle-fence-unavailable" };
  }
  if (report.completionDrainFence !== true) {
    return { valid: false, reason: "completion-drain-fence-unavailable" };
  }
  if (report.hookReaderFence !== true) {
    return { valid: false, reason: "hook-reader-fence-unavailable" };
  }

  for (
    let index = 0;
    index < OVERLAY_CONTROLLER_MIDDLEWARE_BACKENDS.length;
    index += 1
  ) {
    const backend = OVERLAY_CONTROLLER_MIDDLEWARE_BACKENDS[index];
    const backendEvidence = report.backendEvidence[index];
    const backendExpected = expected.backendExpectations[index];
    if (
      backend === undefined ||
      backendEvidence === undefined ||
      backendExpected === undefined ||
      backendEvidence.backend !== backend ||
      backendExpected.backend !== backend
    ) {
      return { valid: false, reason: "invalid-report" };
    }
    if (backendExpected.disposition === "absent") {
      if (backendEvidence.state !== "absent") {
        return {
          valid: false,
          reason: "backend-disposition-mismatch",
          backend,
        };
      }
      continue;
    }
    if (backendEvidence.state !== "covered") {
      return {
        valid: false,
        reason:
          backendEvidence.state === "unsupported" ||
          backendEvidence.state === "fault" ||
          backendEvidence.state === "abi-unverified"
            ? "observed-backend-uncovered"
            : "backend-disposition-mismatch",
        backend,
      };
    }
    if (!sameModules(backendEvidence.modules, backendExpected.modules)) {
      return { valid: false, reason: "module-identity-mismatch", backend };
    }
    if (
      backendEvidence.interfaceRevision !== backendExpected.interfaceRevision
    ) {
      return {
        valid: false,
        reason: "interface-revision-mismatch",
        backend,
      };
    }
    if (backendEvidence.abiSchemaDigest !== backendExpected.abiSchemaDigest) {
      return { valid: false, reason: "abi-schema-mismatch", backend };
    }

    if (backend === "hid-overlapped") {
      if (
        backendEvidence.hidEndpoints.length !==
        backendExpected.hidEndpoints.length
      ) {
        return {
          valid: false,
          reason: "hid-endpoint-generation-set-mismatch",
          backend,
        };
      }
      for (
        let endpointIndex = 0;
        endpointIndex < backendExpected.hidEndpoints.length;
        endpointIndex += 1
      ) {
        const endpointExpected = backendExpected.hidEndpoints[endpointIndex];
        const endpointEvidence = backendEvidence.hidEndpoints[endpointIndex];
        if (
          !endpointExpected ||
          !endpointEvidence ||
          !sameEndpointIdentity(
            endpointEvidence.endpoint,
            endpointExpected.endpoint
          ) ||
          endpointEvidence.handleGeneration !==
            endpointExpected.handleGeneration
        ) {
          return {
            valid: false,
            reason: "hid-endpoint-generation-set-mismatch",
            backend,
            endpointId: endpointEvidence?.endpoint.endpointId,
            handleGeneration: endpointEvidence?.handleGeneration,
          };
        }
        const endpointDetails = {
          backend,
          endpointId: endpointEvidence.endpoint.endpointId,
          handleGeneration: endpointEvidence.handleGeneration,
        } as const;
        if (
          endpointEvidence.pendingDrainEpoch !==
            endpointExpected.pendingDrainEpoch ||
          endpointEvidence.lateCompletionEpoch !==
            endpointExpected.lateCompletionEpoch
        ) {
          return {
            valid: false,
            reason: "hid-drain-epoch-mismatch",
            ...endpointDetails,
          };
        }
        if (
          endpointEvidence.trackedTransfers.length !==
          endpointExpected.trackedReports.length
        ) {
          return {
            valid: false,
            reason: "hid-report-schema-mismatch",
            ...endpointDetails,
          };
        }
        for (
          let transferIndex = 0;
          transferIndex < endpointExpected.trackedReports.length;
          transferIndex += 1
        ) {
          const transferExpected =
            endpointExpected.trackedReports[transferIndex];
          const transferEvidence =
            endpointEvidence.trackedTransfers[transferIndex];
          if (!transferExpected || !transferEvidence) {
            return {
              valid: false,
              reason: "hid-report-schema-mismatch",
              ...endpointDetails,
            };
          }
          const transferDetails = {
            ...endpointDetails,
            operation: transferEvidence.operation,
            controlSemantic: transferEvidence.controlSemantic,
            transferDirection: transferEvidence.transferDirection,
            reportId: transferEvidence.reportId,
          } as const;
          if (
            transferEvidence.operation !== transferExpected.operation ||
            transferEvidence.controlSemantic !==
              transferExpected.controlSemantic ||
            transferEvidence.transferDirection !==
              transferExpected.transferDirection ||
            transferEvidence.reportId !== transferExpected.reportId ||
            transferEvidence.byteLength !== transferExpected.byteLength ||
            transferEvidence.schemaDigest !== transferExpected.schemaDigest ||
            transferEvidence.transferBindingDigest !==
              transferExpected.transferBindingDigest
          ) {
            return {
              valid: false,
              reason: "hid-report-schema-mismatch",
              ...transferDetails,
            };
          }
          if (
            transferEvidence.transferDirection === "device-to-host" &&
            transferEvidence.neutralReportDigest === null
          ) {
            return {
              valid: false,
              reason: "hid-neutralization-unavailable",
              ...transferDetails,
            };
          }
          if (
            transferEvidence.neutralReportDigest !==
            transferExpected.neutralReportDigest
          ) {
            return {
              valid: false,
              reason: "hid-report-schema-mismatch",
              ...transferDetails,
            };
          }
          if (
            transferEvidence.transferDirection === "host-to-device" &&
            !outputHoldReplayReady(transferEvidence.outputHoldReplay)
          ) {
            return {
              valid: false,
              reason: "output-hold-replay-unavailable",
              ...transferDetails,
            };
          }
          if (
            transferEvidence.transferDirection === "host-to-device" &&
            transferEvidence.outputHoldReplay?.transferBindingDigest !==
              transferEvidence.transferBindingDigest
          ) {
            return {
              valid: false,
              reason: "hid-output-binding-mismatch",
              ...transferDetails,
            };
          }
        }
        const routes = new Map(
          endpointEvidence.routes.map(
            (route) => [route.name, route.state] as const
          )
        );
        for (const route of OVERLAY_HID_ROUTES) {
          if (routes.get(route) !== "covered") {
            return {
              valid: false,
              reason: "hid-route-uncovered",
              ...endpointDetails,
              route,
            };
          }
        }
        if (endpointEvidence.pendingCompletionsDrained !== true) {
          return {
            valid: false,
            reason: "pending-completion-drain-unavailable",
            ...endpointDetails,
          };
        }
        if (endpointEvidence.lateCompletionFenceArmed !== true) {
          return {
            valid: false,
            reason: "late-completion-fence-unavailable",
            ...endpointDetails,
          };
        }
      }
      continue;
    }

    if (backend === "steam-input-006" || backend === "steam-controller-008") {
      const requiredMethods =
        backend === "steam-input-006"
          ? OVERLAY_STEAM_INPUT_006_METHODS
          : OVERLAY_STEAM_CONTROLLER_008_METHODS;
      const methods = new Map(
        backendEvidence.methods.map(
          (method) => [method.name, method.state] as const
        )
      );
      for (const method of requiredMethods) {
        if (methods.get(method) !== "covered") {
          return {
            valid: false,
            reason: "steam-method-uncovered",
            backend,
            method,
          };
        }
      }
      if (!outputHoldReplayReady(backendEvidence.outputHoldReplay)) {
        return {
          valid: false,
          reason: "output-hold-replay-unavailable",
          backend,
        };
      }
    }
  }

  return { valid: true, report: freezeReport(report) };
};

/**
 * Validates a native controller-middleware evidence matrix against a separately
 * retained launch/input expectation. Native evidence is snapshotted once before
 * parsing. This still does not prove the collector's authenticity/completeness;
 * signatures, monotonic publication and anti-cheat policy remain external.
 * libScePad deliberately cannot authorize until an ABI schema is audited.
 */
export const validateOverlayControllerMiddlewareCapabilityReport = (
  unsafeReport: unknown,
  unsafeExpected: unknown
): OverlayControllerMiddlewareCapabilityEvaluation => {
  const expectedSnapshot = snapshotUnsafe(unsafeExpected);
  if (!expectedSnapshot.ok) {
    return { valid: false, reason: "invalid-expectation" };
  }
  let expected: OverlayControllerMiddlewareCapabilityExpectation | null;
  try {
    expected = parseExpectation(expectedSnapshot.value);
  } catch {
    return { valid: false, reason: "invalid-expectation" };
  }
  if (!expected) return { valid: false, reason: "invalid-expectation" };

  const reportSnapshot = snapshotUnsafe(unsafeReport);
  if (!reportSnapshot.ok) return { valid: false, reason: "invalid-report" };
  let report: OverlayControllerMiddlewareCapabilityReport | null;
  try {
    report = parseReport(reportSnapshot.value);
  } catch {
    return { valid: false, reason: "invalid-report" };
  }
  if (!report) return { valid: false, reason: "invalid-report" };

  try {
    return evaluateParsedReport(report, expected);
  } catch {
    return { valid: false, reason: "invalid-report" };
  }
};
