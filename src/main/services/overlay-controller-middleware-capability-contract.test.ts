import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  OVERLAY_CONTROLLER_MIDDLEWARE_BACKENDS,
  OVERLAY_CONTROLLER_SNAPSHOT_LIMITS,
  OVERLAY_HID_ROUTES,
  OVERLAY_STEAM_CONTROLLER_008_METHODS,
  OVERLAY_STEAM_INPUT_006_METHODS,
  validateOverlayControllerMiddlewareCapabilityReport,
  type OverlayControllerBackendEvidence,
  type OverlayControllerBackendExpectation,
  type OverlayControllerMiddlewareBackend,
  type OverlayControllerMiddlewareCapabilityExpectation,
  type OverlayControllerMiddlewareCapabilityReport,
  type OverlayControllerModuleIdentity,
  type OverlayControllerModuleRole,
  type OverlayControllerNamedEvidence,
  type OverlayControllerObservedInventoryEntry,
  type OverlayHidEndpointEvidence,
  type OverlayHidEndpointExpectation,
  type OverlayHidEndpointIdentity,
  type OverlayHidTrackedReportSchema,
  type OverlayHidTrackedTransferEvidence,
} from "./overlay-controller-middleware-capability-contract";

const digest = (character: string) => character.repeat(64);

const identity = {
  sessionId: "controller_middleware_contract_session_0002",
  pid: 7421,
  creationTicks: "132456789012345678",
  canonicalExecutablePath: "C:\\Games\\Fixture\\fixture.exe",
  volumeSerial: "000000000000A1B2",
  fileId: "00112233445566778899AABBCCDDEEFF",
} as const;

const moduleIdentity = (
  role: OverlayControllerModuleRole,
  moduleName: string,
  canonicalPath: string,
  discriminator: string,
  loadAddress: string
): OverlayControllerModuleIdentity => ({
  role,
  moduleName,
  canonicalPath,
  architecture: "x64",
  volumeSerial: discriminator.padStart(16, "0"),
  fileId: discriminator.repeat(32),
  sha256: discriminator.repeat(64),
  imageSize: 65_536 + Number.parseInt(discriminator, 16),
  loadAddress,
});

const hidModules = (): OverlayControllerModuleIdentity[] => [
  moduleIdentity(
    "hid-api",
    "hid.dll",
    "C:\\Windows\\System32\\hid.dll",
    "A",
    "140716013518848"
  ),
  moduleIdentity(
    "setupapi",
    "setupapi.dll",
    "C:\\Windows\\System32\\setupapi.dll",
    "B",
    "140716014567424"
  ),
  moduleIdentity(
    "kernel-io",
    "kernelbase.dll",
    "C:\\Windows\\System32\\kernelbase.dll",
    "C",
    "140716015616000"
  ),
];

const steamModule = (): OverlayControllerModuleIdentity =>
  moduleIdentity(
    "steam-api",
    "steam_api64.dll",
    "C:\\Games\\Fixture\\steam_api64.dll",
    "D",
    "140716016664576"
  );

const scePadModule = (): OverlayControllerModuleIdentity =>
  moduleIdentity(
    "libscepad",
    "libscepad.dll",
    "C:\\Games\\Fixture\\libscepad.dll",
    "E",
    "140716017713152"
  );

const endpointIdentity = (
  idCharacter: "A" | "B",
  collectionNumber: number
): OverlayHidEndpointIdentity => ({
  endpointId: digest(idCharacter),
  devicePathDigest: digest(idCharacter === "A" ? "C" : "D"),
  containerId:
    idCharacter === "A"
      ? "{AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA}"
      : "{BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB}",
  vendorId: idCharacter === "A" ? 0x054c : 0x045e,
  productId: idCharacter === "A" ? 0x0ce6 : 0x0b13,
  versionNumber: 0x0100,
  usagePage: 0x01,
  usage: 0x05,
  collectionNumber,
});

const trackedReports = (
  schemaCharacter: string
): OverlayHidTrackedReportSchema[] => [
  {
    operation: "read-file",
    controlSemantic: "none",
    transferDirection: "device-to-host",
    reportId: 0,
    byteLength: 64,
    schemaDigest: digest(schemaCharacter),
    transferBindingDigest: digest("1"),
    neutralReportDigest: digest("1"),
  },
  {
    operation: "read-file-ex",
    controlSemantic: "none",
    transferDirection: "device-to-host",
    reportId: 0,
    byteLength: 64,
    schemaDigest: digest("2"),
    transferBindingDigest: digest("2"),
    neutralReportDigest: digest("3"),
  },
  {
    operation: "write-file",
    controlSemantic: "none",
    transferDirection: "host-to-device",
    reportId: 0,
    byteLength: 32,
    schemaDigest: digest("4"),
    transferBindingDigest: digest("3"),
    neutralReportDigest: null,
  },
  {
    operation: "write-file-ex",
    controlSemantic: "none",
    transferDirection: "host-to-device",
    reportId: 0,
    byteLength: 32,
    schemaDigest: digest("5"),
    transferBindingDigest: digest("4"),
    neutralReportDigest: null,
  },
  {
    operation: "device-io-control",
    controlSemantic: "get-feature",
    transferDirection: "device-to-host",
    reportId: 1,
    byteLength: 56,
    schemaDigest: digest("6"),
    transferBindingDigest: digest("5"),
    neutralReportDigest: digest("6"),
  },
  {
    operation: "device-io-control",
    controlSemantic: "set-feature",
    transferDirection: "host-to-device",
    reportId: 1,
    byteLength: 56,
    schemaDigest: digest("7"),
    transferBindingDigest: digest("6"),
    neutralReportDigest: null,
  },
  {
    operation: "device-io-control",
    controlSemantic: "get-input-report",
    transferDirection: "device-to-host",
    reportId: 1,
    byteLength: 64,
    schemaDigest: digest("8"),
    transferBindingDigest: digest("7"),
    neutralReportDigest: digest("D"),
  },
  {
    operation: "device-io-control",
    controlSemantic: "set-output-report",
    transferDirection: "host-to-device",
    reportId: 1,
    byteLength: 32,
    schemaDigest: digest("9"),
    transferBindingDigest: digest("8"),
    neutralReportDigest: null,
  },
];

const outputHoldReplay = () => ({
  holdWhileBlocked: true,
  replayLatestOnceOnRelease: true,
  generationBound: true,
  endpointBound: true,
  dropOnCloseOrDisconnect: true,
  orderedAfterInputRelease: true,
});

const hidOutputHoldReplay = (transferBindingDigest: string) => ({
  ...outputHoldReplay(),
  transferBindingDigest,
});

const trackedTransfers = (
  schemaCharacter: string
): OverlayHidTrackedTransferEvidence[] =>
  trackedReports(schemaCharacter).map((report) => ({
    ...report,
    outputHoldReplay:
      report.transferDirection === "host-to-device"
        ? hidOutputHoldReplay(report.transferBindingDigest)
        : null,
  }));

const namedEvidence = <TName extends string>(
  names: readonly TName[]
): OverlayControllerNamedEvidence<TName>[] =>
  names.map((name) => ({ name, state: "covered" }));

const hidEndpointExpectation = (
  endpoint: OverlayHidEndpointIdentity,
  handleGeneration: string,
  schemaCharacter: string,
  epochBase: number
): OverlayHidEndpointExpectation => ({
  endpoint,
  handleGeneration,
  pendingDrainEpoch: String(epochBase),
  lateCompletionEpoch: String(epochBase + 1),
  trackedReports: trackedReports(schemaCharacter),
});

const hidEndpointEvidence = (
  endpoint: OverlayHidEndpointIdentity,
  handleGeneration: string,
  schemaCharacter: string,
  epochBase: number
): OverlayHidEndpointEvidence => {
  const expected = hidEndpointExpectation(
    endpoint,
    handleGeneration,
    schemaCharacter,
    epochBase
  );
  return {
    endpoint: expected.endpoint,
    handleGeneration: expected.handleGeneration,
    pendingDrainEpoch: expected.pendingDrainEpoch,
    lateCompletionEpoch: expected.lateCompletionEpoch,
    pendingCompletionsDrained: true,
    lateCompletionFenceArmed: true,
    routes: namedEvidence(OVERLAY_HID_ROUTES),
    trackedTransfers: trackedTransfers(schemaCharacter),
  };
};

const hidEndpointExpectations = (): OverlayHidEndpointExpectation[] => [
  hidEndpointExpectation(endpointIdentity("A", 1), "41", "9", 101),
  hidEndpointExpectation(endpointIdentity("A", 1), "42", "A", 103),
  hidEndpointExpectation(endpointIdentity("B", 2), "7", "B", 201),
];

const hidEndpointEvidenceSet = (): OverlayHidEndpointEvidence[] => [
  hidEndpointEvidence(endpointIdentity("A", 1), "41", "9", 101),
  hidEndpointEvidence(endpointIdentity("A", 1), "42", "A", 103),
  hidEndpointEvidence(endpointIdentity("B", 2), "7", "B", 201),
];

const absentExpectation = (
  backend: OverlayControllerMiddlewareBackend
): OverlayControllerBackendExpectation => ({
  backend,
  disposition: "absent",
  modules: [],
  interfaceRevision: null,
  abiSchemaDigest: null,
  hidEndpoints: [],
});

const backendExpectations = (): OverlayControllerBackendExpectation[] => [
  {
    backend: "hid-overlapped",
    disposition: "required",
    modules: hidModules(),
    interfaceRevision: "win32-hid-overlapped-v2",
    abiSchemaDigest: digest("5"),
    hidEndpoints: hidEndpointExpectations(),
  },
  {
    backend: "steam-input-006",
    disposition: "required",
    modules: [steamModule()],
    interfaceRevision: "SteamInput006",
    abiSchemaDigest: digest("6"),
    hidEndpoints: [],
  },
  {
    backend: "steam-controller-008",
    disposition: "required",
    modules: [steamModule()],
    interfaceRevision: "SteamController008",
    abiSchemaDigest: digest("7"),
    hidEndpoints: [],
  },
  absentExpectation("libscepad"),
];

const absentEvidence = (
  backend: OverlayControllerMiddlewareBackend
): OverlayControllerBackendEvidence => ({
  backend,
  state: "absent",
  modules: [],
  interfaceRevision: null,
  abiSchemaDigest: null,
  hidEndpoints: [],
  methods: [],
  outputHoldReplay: null,
});

const backendEvidence = (): OverlayControllerBackendEvidence[] => [
  {
    backend: "hid-overlapped",
    state: "covered",
    modules: hidModules(),
    interfaceRevision: "win32-hid-overlapped-v2",
    abiSchemaDigest: digest("5"),
    hidEndpoints: hidEndpointEvidenceSet(),
    methods: [],
    outputHoldReplay: null,
  },
  {
    backend: "steam-input-006",
    state: "covered",
    modules: [steamModule()],
    interfaceRevision: "SteamInput006",
    abiSchemaDigest: digest("6"),
    hidEndpoints: [],
    methods: namedEvidence(OVERLAY_STEAM_INPUT_006_METHODS),
    outputHoldReplay: outputHoldReplay(),
  },
  {
    backend: "steam-controller-008",
    state: "covered",
    modules: [steamModule()],
    interfaceRevision: "SteamController008",
    abiSchemaDigest: digest("7"),
    hidEndpoints: [],
    methods: namedEvidence(OVERLAY_STEAM_CONTROLLER_008_METHODS),
    outputHoldReplay: outputHoldReplay(),
  },
  absentEvidence("libscepad"),
];

const inventoryFromExpectations = (
  backends: readonly OverlayControllerBackendExpectation[]
): OverlayControllerObservedInventoryEntry[] =>
  backends.flatMap((backend) =>
    backend.disposition === "absent"
      ? []
      : backend.modules.map((module) => ({
          backend: backend.backend,
          module: { ...module },
          interfaceRevision: backend.interfaceRevision as string,
          abiSchemaDigest: backend.abiSchemaDigest as string,
          state: "covered" as const,
        }))
  );

const inventoryFromEvidence = (
  backends: readonly OverlayControllerBackendEvidence[]
): OverlayControllerObservedInventoryEntry[] =>
  backends.flatMap((backend) =>
    backend.state === "absent"
      ? []
      : backend.modules.map((module) => ({
          backend: backend.backend,
          module: { ...module },
          interfaceRevision: backend.interfaceRevision as string,
          abiSchemaDigest: backend.abiSchemaDigest as string,
          state:
            backend.state as OverlayControllerObservedInventoryEntry["state"],
        }))
  );

const expectation = (): OverlayControllerMiddlewareCapabilityExpectation => {
  const backends = backendExpectations();
  return {
    identity: { ...identity },
    inputGeneration: "11",
    middlewareGeneration: "4",
    topologyEpoch: "27",
    nativeCommitSequence: "39",
    nativeCommitDigest: digest("8"),
    absenceMonitorEpoch: "16",
    targetArchitecture: "x64",
    unknownObservationSetDigest: digest("F"),
    observedInventory: inventoryFromExpectations(backends),
    unknownObservations: [],
    backendExpectations: backends,
  };
};

const report = (): OverlayControllerMiddlewareCapabilityReport => {
  const backends = backendEvidence();
  return {
    schemaVersion: 2,
    identity: { ...identity },
    inputGeneration: "11",
    middlewareGeneration: "4",
    topologyEpoch: "27",
    nativeCommitSequence: "39",
    nativeCommitDigest: digest("8"),
    absenceMonitorEpoch: "16",
    targetArchitecture: "x64",
    unknownObservationSetDigest: digest("F"),
    completeModuleSnapshot: true,
    completeInterfaceInventory: true,
    absenceMonitorArmed: true,
    preEntryBootstrap: true,
    cachedPointerInlineDetours: true,
    handleLifecycleFence: true,
    completionDrainFence: true,
    hookReaderFence: true,
    observedInventory: inventoryFromEvidence(backends),
    unknownObservations: [],
    backendEvidence: backends,
  };
};

const evidenceFor = (
  value: OverlayControllerMiddlewareCapabilityReport,
  backend: OverlayControllerMiddlewareBackend
) => {
  const evidence = value.backendEvidence.find(
    (item) => item.backend === backend
  );
  assert.ok(evidence);
  return evidence;
};

const endpointFor = (
  value: OverlayControllerMiddlewareCapabilityReport,
  endpointId: string,
  handleGeneration: string
) => {
  const endpoint = evidenceFor(value, "hid-overlapped").hidEndpoints.find(
    (item) =>
      item.endpoint.endpointId === endpointId &&
      item.handleGeneration === handleGeneration
  );
  assert.ok(endpoint);
  return endpoint;
};

const synchronizeInventory = (
  value: OverlayControllerMiddlewareCapabilityReport
) => {
  value.observedInventory = inventoryFromEvidence(value.backendEvidence);
};

describe("overlay controller middleware capability contract", () => {
  it("accepts a fully synthetic exact endpoint/generation and Steam matrix", () => {
    const result = validateOverlayControllerMiddlewareCapabilityReport(
      report(),
      expectation()
    );
    assert.equal(result.valid, true);
    if (result.valid) {
      assert.ok(Object.isFrozen(result.report));
      assert.ok(Object.isFrozen(result.report.observedInventory));
      assert.ok(Object.isFrozen(result.report.backendEvidence));
      const hid = result.report.backendEvidence[0];
      assert.ok(hid);
      assert.ok(Object.isFrozen(hid.hidEndpoints));
      assert.ok(Object.isFrozen(hid.hidEndpoints[0]?.routes));
      assert.ok(Object.isFrozen(hid.hidEndpoints[0]?.trackedTransfers));
    }
  });

  it("snapshots a type-changing boolean getter exactly once", () => {
    const value = report() as unknown as Record<string, unknown>;
    let reads = 0;
    Object.defineProperty(value, "completeModuleSnapshot", {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1;
        return reads === 1 ? true : "true";
      },
    });
    assert.equal(
      validateOverlayControllerMiddlewareCapabilityReport(value, expectation())
        .valid,
      true
    );
    assert.equal(reads, 1);
  });

  it("reads moving array length/items once and never consumes its iterator", () => {
    const value = report();
    const target = value.backendEvidence as OverlayControllerBackendEvidence[];
    let lengthReads = 0;
    let iteratorReads = 0;
    const itemReads = new Map<string, number>();
    value.backendEvidence = new Proxy(target, {
      get(array, property, receiver) {
        if (property === "length") {
          lengthReads += 1;
          return lengthReads === 1 ? array.length : 0;
        }
        if (property === Symbol.iterator) {
          iteratorReads += 1;
          return Reflect.get(array, property, receiver);
        }
        if (typeof property === "string" && /^\d+$/u.test(property)) {
          const count = (itemReads.get(property) ?? 0) + 1;
          itemReads.set(property, count);
          return count === 1 ? Reflect.get(array, property, receiver) : null;
        }
        return Reflect.get(array, property, receiver);
      },
    });
    assert.equal(
      validateOverlayControllerMiddlewareCapabilityReport(value, expectation())
        .valid,
      true
    );
    assert.equal(lengthReads, 1);
    assert.equal(iteratorReads, 0);
    assert.deepEqual([...itemReads.values()], [1, 1, 1, 1]);
  });

  it("snapshots nested type-changing accessors exactly once", () => {
    const value = report();
    const hid = evidenceFor(value, "hid-overlapped");
    const firstModule = { ...hid.modules[0] } as Record<string, unknown>;
    const expectedFileId = firstModule.fileId;
    let reads = 0;
    hid.modules = [
      firstModule as unknown as OverlayControllerModuleIdentity,
      ...hid.modules.slice(1),
    ];
    synchronizeInventory(value);
    Object.defineProperty(firstModule, "fileId", {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1;
        return reads === 1 ? expectedFileId : null;
      },
    });
    assert.equal(
      validateOverlayControllerMiddlewareCapabilityReport(value, expectation())
        .valid,
      true
    );
    assert.equal(reads, 1);
  });

  it("never throws for nested or revoked proxies", () => {
    const nested = report();
    const nestedTarget = evidenceFor(nested, "hid-overlapped").hidEndpoints;
    const nestedProxy = new Proxy(nestedTarget, {
      ownKeys() {
        throw new Error("nested ownKeys trap");
      },
    });
    evidenceFor(nested, "hid-overlapped").hidEndpoints = nestedProxy;
    assert.doesNotThrow(() =>
      validateOverlayControllerMiddlewareCapabilityReport(nested, expectation())
    );
    assert.deepEqual(
      validateOverlayControllerMiddlewareCapabilityReport(
        nested,
        expectation()
      ),
      { valid: false, reason: "invalid-report" }
    );

    const revocable = Proxy.revocable([], {});
    revocable.revoke();
    const revoked = report();
    revoked.backendEvidence =
      revocable.proxy as unknown as OverlayControllerBackendEvidence[];
    assert.doesNotThrow(() =>
      validateOverlayControllerMiddlewareCapabilityReport(
        revoked,
        expectation()
      )
    );
    assert.deepEqual(
      validateOverlayControllerMiddlewareCapabilityReport(
        revoked,
        expectation()
      ),
      { valid: false, reason: "invalid-report" }
    );

    const expectedRevocable = Proxy.revocable(expectation(), {});
    expectedRevocable.revoke();
    assert.doesNotThrow(() =>
      validateOverlayControllerMiddlewareCapabilityReport(
        report(),
        expectedRevocable.proxy
      )
    );
    assert.deepEqual(
      validateOverlayControllerMiddlewareCapabilityReport(
        report(),
        expectedRevocable.proxy
      ),
      { valid: false, reason: "invalid-expectation" }
    );
  });

  it("fails closed when the snapshot exceeds its maximum depth", () => {
    const deepRoot: Record<string, unknown> = {};
    let cursor = deepRoot;
    for (
      let depth = 0;
      depth < OVERLAY_CONTROLLER_SNAPSHOT_LIMITS.maxDepth + 2;
      depth += 1
    ) {
      const next: Record<string, unknown> = {};
      cursor.next = next;
      cursor = next;
    }
    assert.doesNotThrow(() =>
      validateOverlayControllerMiddlewareCapabilityReport(
        deepRoot,
        expectation()
      )
    );
    assert.deepEqual(
      validateOverlayControllerMiddlewareCapabilityReport(
        deepRoot,
        expectation()
      ),
      { valid: false, reason: "invalid-report" }
    );
  });

  it("fails closed when the snapshot exceeds its aggregate node limit", () => {
    const width =
      Math.floor(OVERLAY_CONTROLLER_SNAPSHOT_LIMITS.maxTotalNodes / 5) + 1;
    assert.ok(width <= OVERLAY_CONTROLLER_SNAPSHOT_LIMITS.maxCollectionEntries);
    const wide = Array.from({ length: width }, (_, index) => ({
      first: index,
      second: index,
      third: index,
      fourth: index,
    }));
    assert.doesNotThrow(() =>
      validateOverlayControllerMiddlewareCapabilityReport(wide, expectation())
    );
    assert.deepEqual(
      validateOverlayControllerMiddlewareCapabilityReport(wide, expectation()),
      { valid: false, reason: "invalid-report" }
    );
  });

  it("fails closed when aggregate UTF-8 string bytes exceed the limit", () => {
    const oversized = "A".repeat(
      OVERLAY_CONTROLLER_SNAPSHOT_LIMITS.maxAggregateStringBytes + 1
    );
    assert.doesNotThrow(() =>
      validateOverlayControllerMiddlewareCapabilityReport(
        oversized,
        expectation()
      )
    );
    assert.deepEqual(
      validateOverlayControllerMiddlewareCapabilityReport(
        oversized,
        expectation()
      ),
      { valid: false, reason: "invalid-report" }
    );
  });

  it("independently requires four canonical expectation and evidence entries", () => {
    assert.deepEqual(OVERLAY_CONTROLLER_MIDDLEWARE_BACKENDS, [
      "hid-overlapped",
      "steam-input-006",
      "steam-controller-008",
      "libscepad",
    ]);
    const expected = expectation();
    expected.backendExpectations = [
      expected.backendExpectations[1],
      expected.backendExpectations[0],
      ...expected.backendExpectations.slice(2),
    ];
    assert.deepEqual(
      validateOverlayControllerMiddlewareCapabilityReport(report(), expected),
      { valid: false, reason: "invalid-expectation" }
    );

    const value = report();
    value.backendEvidence = [
      value.backendEvidence[1],
      value.backendEvidence[0],
      ...value.backendEvidence.slice(2),
    ];
    assert.deepEqual(
      validateOverlayControllerMiddlewareCapabilityReport(value, expectation()),
      { valid: false, reason: "invalid-report" }
    );
  });

  it("uses exact-key parsing after the immutable snapshot", () => {
    assert.deepEqual(
      validateOverlayControllerMiddlewareCapabilityReport(
        { ...report(), extra: true },
        expectation()
      ),
      { valid: false, reason: "invalid-report" }
    );
    const value = report();
    const endpoint = endpointFor(value, digest("A"), "41");
    endpoint.endpoint = { ...endpoint.endpoint, extra: true } as never;
    assert.deepEqual(
      validateOverlayControllerMiddlewareCapabilityReport(value, expectation()),
      { valid: false, reason: "invalid-report" }
    );
  });

  it("binds native-width generations and every retained epoch/commit field", () => {
    const mutations = [
      ["inputGeneration", "12", "stale-input-generation"],
      ["middlewareGeneration", "5", "stale-middleware-generation"],
      ["topologyEpoch", "28", "stale-topology-epoch"],
      ["nativeCommitSequence", "40", "stale-commit-sequence"],
      ["nativeCommitDigest", digest("9"), "native-commit-digest-mismatch"],
      ["absenceMonitorEpoch", "17", "stale-absence-monitor-epoch"],
    ] as const;
    for (const [key, changed, reason] of mutations) {
      const value = report() as unknown as Record<string, unknown>;
      value[key] = changed;
      assert.deepEqual(
        validateOverlayControllerMiddlewareCapabilityReport(
          value,
          expectation()
        ),
        { valid: false, reason }
      );
    }
  });

  it("requires literal true for all global completeness/fence booleans", () => {
    const mutations = [
      ["completeModuleSnapshot", "incomplete-module-snapshot"],
      ["completeInterfaceInventory", "incomplete-interface-inventory"],
      ["absenceMonitorArmed", "absence-monitor-unavailable"],
      ["preEntryBootstrap", "pre-entry-bootstrap-required"],
      ["cachedPointerInlineDetours", "cached-pointer-detours-required"],
      ["handleLifecycleFence", "handle-lifecycle-fence-unavailable"],
      ["completionDrainFence", "completion-drain-fence-unavailable"],
      ["hookReaderFence", "hook-reader-fence-unavailable"],
    ] as const;
    for (const [key, reason] of mutations) {
      const value = report() as unknown as Record<string, unknown>;
      value[key] = false;
      assert.deepEqual(
        validateOverlayControllerMiddlewareCapabilityReport(
          value,
          expectation()
        ),
        { valid: false, reason }
      );
    }
  });

  it("rejects x64 and x86 image ranges that overflow their address width", () => {
    const x64 = report();
    const hid = evidenceFor(x64, "hid-overlapped");
    hid.modules = hid.modules.map((module, index) =>
      index === 0
        ? {
            ...module,
            loadAddress: "18446744073709551615",
            imageSize: 2,
          }
        : module
    );
    synchronizeInventory(x64);
    assert.deepEqual(
      validateOverlayControllerMiddlewareCapabilityReport(x64, expectation()),
      { valid: false, reason: "invalid-report" }
    );

    const x86 = expectation() as unknown as Record<string, unknown>;
    x86.targetArchitecture = "x86";
    const profiles = x86.backendExpectations as Array<Record<string, unknown>>;
    const firstProfile = profiles[0];
    assert.ok(firstProfile);
    const modules = firstProfile.modules as OverlayControllerModuleIdentity[];
    firstProfile.modules = modules.map((module, index) => ({
      ...module,
      architecture: "x86",
      loadAddress: index === 0 ? "4294967295" : String(1_048_576 * (index + 1)),
      imageSize: index === 0 ? 2 : module.imageSize,
    }));
    assert.deepEqual(
      validateOverlayControllerMiddlewareCapabilityReport(report(), x86),
      { valid: false, reason: "invalid-expectation" }
    );
  });

  it("allows report ID 0 independently on two devices and generations", () => {
    const value = report();
    const hid = evidenceFor(value, "hid-overlapped");
    assert.deepEqual(
      hid.hidEndpoints.map((endpoint) => ({
        endpoint: endpoint.endpoint.endpointId,
        generation: endpoint.handleGeneration,
        reportIds: endpoint.trackedTransfers
          .filter((schema) => schema.operation === "read-file")
          .map((schema) => schema.reportId),
      })),
      [
        { endpoint: digest("A"), generation: "41", reportIds: [0] },
        { endpoint: digest("A"), generation: "42", reportIds: [0] },
        { endpoint: digest("B"), generation: "7", reportIds: [0] },
      ]
    );
    assert.equal(
      validateOverlayControllerMiddlewareCapabilityReport(value, expectation())
        .valid,
      true
    );
  });

  it("rejects missing, extra, duplicate or changed endpoint generations", () => {
    const missing = report();
    evidenceFor(missing, "hid-overlapped").hidEndpoints = evidenceFor(
      missing,
      "hid-overlapped"
    ).hidEndpoints.slice(1);
    assert.deepEqual(
      validateOverlayControllerMiddlewareCapabilityReport(
        missing,
        expectation()
      ),
      {
        valid: false,
        reason: "hid-endpoint-generation-set-mismatch",
        backend: "hid-overlapped",
      }
    );

    const changed = report();
    endpointFor(changed, digest("A"), "42").handleGeneration = "43";
    assert.deepEqual(
      validateOverlayControllerMiddlewareCapabilityReport(
        changed,
        expectation()
      ),
      {
        valid: false,
        reason: "hid-endpoint-generation-set-mismatch",
        backend: "hid-overlapped",
        endpointId: digest("A"),
        handleGeneration: "43",
      }
    );

    const duplicate = report();
    const duplicateHid = evidenceFor(duplicate, "hid-overlapped");
    duplicateHid.hidEndpoints = [
      duplicateHid.hidEndpoints[0],
      structuredClone(duplicateHid.hidEndpoints[0]),
      duplicateHid.hidEndpoints[2],
    ];
    assert.deepEqual(
      validateOverlayControllerMiddlewareCapabilityReport(
        duplicate,
        expectation()
      ),
      { valid: false, reason: "invalid-report" }
    );
  });

  it("does not borrow a complete HID route from another endpoint/generation", () => {
    const value = report();
    const first = endpointFor(value, digest("A"), "41");
    first.routes = first.routes.filter(
      (route) => route.name !== "get-queued-completion-status-ex"
    );
    assert.equal(
      endpointFor(value, digest("B"), "7").routes.find(
        (route) => route.name === "get-queued-completion-status-ex"
      )?.state,
      "covered"
    );
    assert.deepEqual(
      validateOverlayControllerMiddlewareCapabilityReport(value, expectation()),
      {
        valid: false,
        reason: "hid-route-uncovered",
        backend: "hid-overlapped",
        endpointId: digest("A"),
        handleGeneration: "41",
        route: "get-queued-completion-status-ex",
      }
    );
  });

  it("does not borrow a report-ID schema from another endpoint", () => {
    const value = report();
    endpointFor(value, digest("A"), "41").trackedTransfers = structuredClone(
      endpointFor(value, digest("B"), "7").trackedTransfers
    );
    assert.deepEqual(
      validateOverlayControllerMiddlewareCapabilityReport(value, expectation()),
      {
        valid: false,
        reason: "hid-report-schema-mismatch",
        backend: "hid-overlapped",
        endpointId: digest("A"),
        handleGeneration: "41",
        operation: "read-file",
        controlSemantic: "none",
        transferDirection: "device-to-host",
        reportId: 0,
      }
    );
  });

  it("keys HID report schemas by operation, control semantic, transfer direction and report ID", () => {
    const duplicate = report();
    const endpoint = endpointFor(duplicate, digest("A"), "41");
    endpoint.trackedTransfers = [
      endpoint.trackedTransfers[0],
      { ...endpoint.trackedTransfers[0] },
      ...endpoint.trackedTransfers.slice(1),
    ];
    assert.deepEqual(
      validateOverlayControllerMiddlewareCapabilityReport(
        duplicate,
        expectation()
      ),
      { valid: false, reason: "invalid-report" }
    );

    const invalidDirection = report();
    const invalidEndpoint = endpointFor(invalidDirection, digest("A"), "41");
    invalidEndpoint.trackedTransfers = invalidEndpoint.trackedTransfers.map(
      (schema) =>
        schema.operation === "read-file"
          ? {
              ...schema,
              transferDirection: "host-to-device",
              neutralReportDigest: null,
              outputHoldReplay: hidOutputHoldReplay(
                schema.transferBindingDigest
              ),
            }
          : schema
    );
    assert.deepEqual(
      validateOverlayControllerMiddlewareCapabilityReport(
        invalidDirection,
        expectation()
      ),
      { valid: false, reason: "invalid-report" }
    );
  });

  it("tracks feature and input/output GET/SET controls independently at the same report ID", () => {
    const value = report();
    const featureTransfers = endpointFor(
      value,
      digest("A"),
      "41"
    ).trackedTransfers.filter(
      (transfer) => transfer.controlSemantic !== "none"
    );
    assert.deepEqual(
      featureTransfers.map((transfer) => ({
        operation: transfer.operation,
        controlSemantic: transfer.controlSemantic,
        transferDirection: transfer.transferDirection,
        reportId: transfer.reportId,
      })),
      [
        {
          operation: "device-io-control",
          controlSemantic: "get-feature",
          transferDirection: "device-to-host",
          reportId: 1,
        },
        {
          operation: "device-io-control",
          controlSemantic: "set-feature",
          transferDirection: "host-to-device",
          reportId: 1,
        },
        {
          operation: "device-io-control",
          controlSemantic: "get-input-report",
          transferDirection: "device-to-host",
          reportId: 1,
        },
        {
          operation: "device-io-control",
          controlSemantic: "set-output-report",
          transferDirection: "host-to-device",
          reportId: 1,
        },
      ]
    );
    assert.equal(
      validateOverlayControllerMiddlewareCapabilityReport(value, expectation())
        .valid,
      true
    );
  });

  it("requires GET_FEATURE neutralization independently from SET_FEATURE", () => {
    const missing = report();
    const missingGet = endpointFor(
      missing,
      digest("A"),
      "41"
    ).trackedTransfers.find(
      (transfer) => transfer.controlSemantic === "get-feature"
    );
    assert.ok(missingGet);
    missingGet.neutralReportDigest = null;
    assert.deepEqual(
      validateOverlayControllerMiddlewareCapabilityReport(
        missing,
        expectation()
      ),
      {
        valid: false,
        reason: "hid-neutralization-unavailable",
        backend: "hid-overlapped",
        endpointId: digest("A"),
        handleGeneration: "41",
        operation: "device-io-control",
        controlSemantic: "get-feature",
        transferDirection: "device-to-host",
        reportId: 1,
      }
    );

    const changed = report();
    const changedGet = endpointFor(
      changed,
      digest("A"),
      "41"
    ).trackedTransfers.find(
      (transfer) => transfer.controlSemantic === "get-feature"
    );
    assert.ok(changedGet);
    changedGet.neutralReportDigest = digest("E");
    assert.deepEqual(
      validateOverlayControllerMiddlewareCapabilityReport(
        changed,
        expectation()
      ),
      {
        valid: false,
        reason: "hid-report-schema-mismatch",
        backend: "hid-overlapped",
        endpointId: digest("A"),
        handleGeneration: "41",
        operation: "device-io-control",
        controlSemantic: "get-feature",
        transferDirection: "device-to-host",
        reportId: 1,
      }
    );
  });

  it("requires per-transfer hold/replay independently for SET_FEATURE", () => {
    const missing = report();
    const missingSet = endpointFor(
      missing,
      digest("B"),
      "7"
    ).trackedTransfers.find(
      (transfer) => transfer.controlSemantic === "set-feature"
    );
    assert.ok(missingSet);
    missingSet.outputHoldReplay = null;
    assert.deepEqual(
      validateOverlayControllerMiddlewareCapabilityReport(
        missing,
        expectation()
      ),
      {
        valid: false,
        reason: "output-hold-replay-unavailable",
        backend: "hid-overlapped",
        endpointId: digest("B"),
        handleGeneration: "7",
        operation: "device-io-control",
        controlSemantic: "set-feature",
        transferDirection: "host-to-device",
        reportId: 1,
      }
    );

    const changed = report();
    const changedSet = endpointFor(
      changed,
      digest("B"),
      "7"
    ).trackedTransfers.find(
      (transfer) => transfer.controlSemantic === "set-feature"
    );
    assert.ok(changedSet?.outputHoldReplay);
    changedSet.outputHoldReplay.replayLatestOnceOnRelease = false;
    assert.deepEqual(
      validateOverlayControllerMiddlewareCapabilityReport(
        changed,
        expectation()
      ),
      {
        valid: false,
        reason: "output-hold-replay-unavailable",
        backend: "hid-overlapped",
        endpointId: digest("B"),
        handleGeneration: "7",
        operation: "device-io-control",
        controlSemantic: "set-feature",
        transferDirection: "host-to-device",
        reportId: 1,
      }
    );
  });

  it("requires GET_INPUT_REPORT neutralization and rejects cross-borrowed neutral data", () => {
    const missing = report();
    const missingGet = endpointFor(
      missing,
      digest("A"),
      "41"
    ).trackedTransfers.find(
      (transfer) => transfer.controlSemantic === "get-input-report"
    );
    assert.ok(missingGet);
    missingGet.neutralReportDigest = null;
    assert.deepEqual(
      validateOverlayControllerMiddlewareCapabilityReport(
        missing,
        expectation()
      ),
      {
        valid: false,
        reason: "hid-neutralization-unavailable",
        backend: "hid-overlapped",
        endpointId: digest("A"),
        handleGeneration: "41",
        operation: "device-io-control",
        controlSemantic: "get-input-report",
        transferDirection: "device-to-host",
        reportId: 1,
      }
    );

    const borrowed = report();
    const borrowedEndpoint = endpointFor(borrowed, digest("A"), "41");
    const getFeature = borrowedEndpoint.trackedTransfers.find(
      (transfer) => transfer.controlSemantic === "get-feature"
    );
    const getInput = borrowedEndpoint.trackedTransfers.find(
      (transfer) => transfer.controlSemantic === "get-input-report"
    );
    assert.ok(getFeature?.neutralReportDigest);
    assert.ok(getInput);
    getInput.neutralReportDigest = getFeature.neutralReportDigest;
    assert.deepEqual(
      validateOverlayControllerMiddlewareCapabilityReport(
        borrowed,
        expectation()
      ),
      {
        valid: false,
        reason: "hid-report-schema-mismatch",
        backend: "hid-overlapped",
        endpointId: digest("A"),
        handleGeneration: "41",
        operation: "device-io-control",
        controlSemantic: "get-input-report",
        transferDirection: "device-to-host",
        reportId: 1,
      }
    );
  });

  it("requires SET_OUTPUT_REPORT hold/replay and rejects cross-borrowed output evidence", () => {
    const missing = report();
    const missingSet = endpointFor(
      missing,
      digest("B"),
      "7"
    ).trackedTransfers.find(
      (transfer) => transfer.controlSemantic === "set-output-report"
    );
    assert.ok(missingSet);
    missingSet.outputHoldReplay = null;
    assert.deepEqual(
      validateOverlayControllerMiddlewareCapabilityReport(
        missing,
        expectation()
      ),
      {
        valid: false,
        reason: "output-hold-replay-unavailable",
        backend: "hid-overlapped",
        endpointId: digest("B"),
        handleGeneration: "7",
        operation: "device-io-control",
        controlSemantic: "set-output-report",
        transferDirection: "host-to-device",
        reportId: 1,
      }
    );

    const changed = report();
    const changedSet = endpointFor(
      changed,
      digest("B"),
      "7"
    ).trackedTransfers.find(
      (transfer) => transfer.controlSemantic === "set-output-report"
    );
    assert.ok(changedSet?.outputHoldReplay);
    changedSet.outputHoldReplay.holdWhileBlocked = false;
    assert.deepEqual(
      validateOverlayControllerMiddlewareCapabilityReport(
        changed,
        expectation()
      ),
      {
        valid: false,
        reason: "output-hold-replay-unavailable",
        backend: "hid-overlapped",
        endpointId: digest("B"),
        handleGeneration: "7",
        operation: "device-io-control",
        controlSemantic: "set-output-report",
        transferDirection: "host-to-device",
        reportId: 1,
      }
    );

    const borrowed = report();
    const borrowedEndpoint = endpointFor(borrowed, digest("B"), "7");
    const setFeature = borrowedEndpoint.trackedTransfers.find(
      (transfer) => transfer.controlSemantic === "set-feature"
    );
    const setOutput = borrowedEndpoint.trackedTransfers.find(
      (transfer) => transfer.controlSemantic === "set-output-report"
    );
    assert.ok(setFeature?.outputHoldReplay);
    assert.ok(setOutput);
    setOutput.outputHoldReplay = structuredClone(setFeature.outputHoldReplay);
    assert.deepEqual(
      validateOverlayControllerMiddlewareCapabilityReport(
        borrowed,
        expectation()
      ),
      {
        valid: false,
        reason: "hid-output-binding-mismatch",
        backend: "hid-overlapped",
        endpointId: digest("B"),
        handleGeneration: "7",
        operation: "device-io-control",
        controlSemantic: "set-output-report",
        transferDirection: "host-to-device",
        reportId: 1,
      }
    );
  });

  it("rejects duplicate input-report controls and does not accept generic route coverage alone", () => {
    const duplicate = report();
    const duplicateEndpoint = endpointFor(duplicate, digest("A"), "41");
    const getInput = duplicateEndpoint.trackedTransfers.find(
      (transfer) => transfer.controlSemantic === "get-input-report"
    );
    assert.ok(getInput);
    const getInputIndex = duplicateEndpoint.trackedTransfers.indexOf(getInput);
    duplicateEndpoint.trackedTransfers = [
      ...duplicateEndpoint.trackedTransfers.slice(0, getInputIndex + 1),
      structuredClone(getInput),
      ...duplicateEndpoint.trackedTransfers.slice(getInputIndex + 1),
    ];
    assert.deepEqual(
      validateOverlayControllerMiddlewareCapabilityReport(
        duplicate,
        expectation()
      ),
      { valid: false, reason: "invalid-report" }
    );

    const routeOnly = report();
    const routeOnlyEndpoint = endpointFor(routeOnly, digest("A"), "41");
    assert.equal(
      routeOnlyEndpoint.routes.find(
        (route) => route.name === "device-io-control"
      )?.state,
      "covered"
    );
    routeOnlyEndpoint.trackedTransfers =
      routeOnlyEndpoint.trackedTransfers.filter(
        (transfer) =>
          transfer.controlSemantic !== "get-input-report" &&
          transfer.controlSemantic !== "set-output-report"
      );
    assert.deepEqual(
      validateOverlayControllerMiddlewareCapabilityReport(
        routeOnly,
        expectation()
      ),
      {
        valid: false,
        reason: "hid-report-schema-mismatch",
        backend: "hid-overlapped",
        endpointId: digest("A"),
        handleGeneration: "41",
      }
    );
  });

  it("requires WriteFileEx transfer, route and APC completion evidence", () => {
    const missingTransfer = report();
    const missingEndpoint = endpointFor(missingTransfer, digest("A"), "41");
    missingEndpoint.trackedTransfers = missingEndpoint.trackedTransfers.filter(
      (transfer) => transfer.operation !== "write-file-ex"
    );
    assert.deepEqual(
      validateOverlayControllerMiddlewareCapabilityReport(
        missingTransfer,
        expectation()
      ),
      {
        valid: false,
        reason: "hid-report-schema-mismatch",
        backend: "hid-overlapped",
        endpointId: digest("A"),
        handleGeneration: "41",
      }
    );

    for (const route of ["write-file-ex", "apc-completion"] as const) {
      const uncovered = report();
      const uncoveredEndpoint = endpointFor(uncovered, digest("A"), "41");
      uncoveredEndpoint.routes = uncoveredEndpoint.routes.map((item) =>
        item.name === route ? { ...item, state: "unsupported" } : item
      );
      assert.deepEqual(
        validateOverlayControllerMiddlewareCapabilityReport(
          uncovered,
          expectation()
        ),
        {
          valid: false,
          reason: "hid-route-uncovered",
          backend: "hid-overlapped",
          endpointId: digest("A"),
          handleGeneration: "41",
          route,
        }
      );
    }
  });

  it("binds each handle generation's drain and late-completion epochs", () => {
    const value = report();
    endpointFor(value, digest("A"), "42").lateCompletionEpoch = "999";
    assert.deepEqual(
      validateOverlayControllerMiddlewareCapabilityReport(value, expectation()),
      {
        valid: false,
        reason: "hid-drain-epoch-mismatch",
        backend: "hid-overlapped",
        endpointId: digest("A"),
        handleGeneration: "42",
      }
    );
  });

  it("requires per-generation pending drain, late fence and output replay", () => {
    const pending = report();
    endpointFor(pending, digest("B"), "7").pendingCompletionsDrained = false;
    assert.deepEqual(
      validateOverlayControllerMiddlewareCapabilityReport(
        pending,
        expectation()
      ),
      {
        valid: false,
        reason: "pending-completion-drain-unavailable",
        backend: "hid-overlapped",
        endpointId: digest("B"),
        handleGeneration: "7",
      }
    );

    const late = report();
    endpointFor(late, digest("A"), "41").lateCompletionFenceArmed = false;
    assert.deepEqual(
      validateOverlayControllerMiddlewareCapabilityReport(late, expectation()),
      {
        valid: false,
        reason: "late-completion-fence-unavailable",
        backend: "hid-overlapped",
        endpointId: digest("A"),
        handleGeneration: "41",
      }
    );

    const output = report();
    const outputTransfer = endpointFor(
      output,
      digest("A"),
      "42"
    ).trackedTransfers.find(
      (transfer) => transfer.controlSemantic === "set-feature"
    );
    assert.ok(outputTransfer?.outputHoldReplay);
    outputTransfer.outputHoldReplay.endpointBound = false;
    assert.deepEqual(
      validateOverlayControllerMiddlewareCapabilityReport(
        output,
        expectation()
      ),
      {
        valid: false,
        reason: "output-hold-replay-unavailable",
        backend: "hid-overlapped",
        endpointId: digest("A"),
        handleGeneration: "42",
        operation: "device-io-control",
        controlSemantic: "set-feature",
        transferDirection: "host-to-device",
        reportId: 1,
      }
    );
  });

  it("requires every HID discovery, handle, completion and cancellation route per generation", () => {
    for (const route of OVERLAY_HID_ROUTES) {
      const value = report();
      const endpoint = endpointFor(value, digest("A"), "41");
      endpoint.routes = endpoint.routes.map((item) =>
        item.name === route ? { ...item, state: "unsupported" } : item
      );
      assert.deepEqual(
        validateOverlayControllerMiddlewareCapabilityReport(
          value,
          expectation()
        ),
        {
          valid: false,
          reason: "hid-route-uncovered",
          backend: "hid-overlapped",
          endpointId: digest("A"),
          handleGeneration: "41",
          route,
        }
      );
    }
  });

  it("requires every SteamInput006 and SteamController008 method separately", () => {
    for (const [backend, methods] of [
      ["steam-input-006", OVERLAY_STEAM_INPUT_006_METHODS],
      ["steam-controller-008", OVERLAY_STEAM_CONTROLLER_008_METHODS],
    ] as const) {
      for (const method of methods) {
        const value = report();
        const steam = evidenceFor(value, backend);
        steam.methods = steam.methods.map((item) =>
          item.name === method ? { ...item, state: "fault" } : item
        );
        assert.deepEqual(
          validateOverlayControllerMiddlewareCapabilityReport(
            value,
            expectation()
          ),
          {
            valid: false,
            reason: "steam-method-uncovered",
            backend,
            method,
          }
        );
      }
    }
  });

  it("never aliases SteamInput008 into either accepted Steam revision", () => {
    for (const backend of [
      "steam-input-006",
      "steam-controller-008",
    ] as const) {
      const value = report();
      evidenceFor(value, backend).interfaceRevision = "SteamInput008";
      synchronizeInventory(value);
      assert.deepEqual(
        validateOverlayControllerMiddlewareCapabilityReport(
          value,
          expectation()
        ),
        { valid: false, reason: "observed-inventory-mismatch" }
      );
    }
  });

  it("requires an exact observed module/interface inventory", () => {
    const value = report();
    value.observedInventory = value.observedInventory.map((item, index) =>
      index === 0
        ? {
            ...item,
            module: { ...item.module, fileId: "F".repeat(32) },
          }
        : item
    );
    assert.deepEqual(
      validateOverlayControllerMiddlewareCapabilityReport(value, expectation()),
      { valid: false, reason: "invalid-report" }
    );

    const changed = report();
    const steam = evidenceFor(changed, "steam-input-006");
    steam.modules = steam.modules.map((module) => ({
      ...module,
      fileId: "F".repeat(32),
    }));
    synchronizeInventory(changed);
    assert.deepEqual(
      validateOverlayControllerMiddlewareCapabilityReport(
        changed,
        expectation()
      ),
      { valid: false, reason: "observed-inventory-mismatch" }
    );
  });

  it("authenticates an exact empty unknown-observation set", () => {
    const digestMismatch = report();
    digestMismatch.unknownObservationSetDigest = digest("A");
    assert.deepEqual(
      validateOverlayControllerMiddlewareCapabilityReport(
        digestMismatch,
        expectation()
      ),
      {
        valid: false,
        reason: "unknown-observation-set-digest-mismatch",
      }
    );

    const invalidExpected = expectation() as unknown as Record<string, unknown>;
    invalidExpected.unknownObservations = [
      {
        kind: "controller-module",
        module: scePadModule(),
        observedInterface: "unknown-controller-v1",
        observationDigest: digest("A"),
        state: "unsupported",
      },
    ];
    assert.deepEqual(
      validateOverlayControllerMiddlewareCapabilityReport(
        report(),
        invalidExpected
      ),
      { valid: false, reason: "invalid-expectation" }
    );
  });

  it("requires an unknown Steam interface to be explicit and fails it closed", () => {
    const value = report();
    value.unknownObservations = [
      {
        kind: "steam-interface",
        module: steamModule(),
        observedInterface: "SteamInput008",
        observationDigest: digest("A"),
        state: "unsupported",
      },
    ];
    assert.deepEqual(
      validateOverlayControllerMiddlewareCapabilityReport(value, expectation()),
      { valid: false, reason: "unknown-observation" }
    );
  });

  it("fails an observed libScePad module as explicitly ABI-unverified", () => {
    const value = report();
    value.backendEvidence = value.backendEvidence.map((item) =>
      item.backend === "libscepad"
        ? {
            backend: "libscepad",
            state: "abi-unverified",
            modules: [scePadModule()],
            interfaceRevision: "libScePad:observed-exports-v1",
            abiSchemaDigest: digest("B"),
            hidEndpoints: [],
            methods: [],
            outputHoldReplay: null,
          }
        : item
    );
    synchronizeInventory(value);
    assert.deepEqual(
      validateOverlayControllerMiddlewareCapabilityReport(value, expectation()),
      {
        valid: false,
        reason: "libscepad-abi-unverified",
        backend: "libscepad",
      }
    );
  });

  it("will not accept required libScePad without an audited ABI schema", () => {
    const expected = expectation();
    expected.backendExpectations = expected.backendExpectations.map((item) =>
      item.backend === "libscepad"
        ? {
            backend: "libscepad",
            disposition: "required",
            modules: [scePadModule()],
            interfaceRevision: "libScePad:observed-exports-v1",
            abiSchemaDigest: digest("B"),
            hidEndpoints: [],
          }
        : item
    );
    expected.observedInventory = inventoryFromExpectations(
      expected.backendExpectations
    );
    assert.deepEqual(
      validateOverlayControllerMiddlewareCapabilityReport(report(), expected),
      { valid: false, reason: "invalid-expectation" }
    );
  });

  it("fails Spider-Man-like libScePad and Khazan-like missing IOCP evidence", () => {
    const spider = report();
    spider.backendEvidence = spider.backendEvidence.map((item) =>
      item.backend === "libscepad"
        ? {
            ...absentEvidence("libscepad"),
            state: "abi-unverified",
            modules: [scePadModule()],
            interfaceRevision: "libScePad:unknown-abi",
            abiSchemaDigest: digest("C"),
          }
        : item
    );
    synchronizeInventory(spider);
    assert.deepEqual(
      validateOverlayControllerMiddlewareCapabilityReport(
        spider,
        expectation()
      ),
      {
        valid: false,
        reason: "libscepad-abi-unverified",
        backend: "libscepad",
      }
    );

    const khazan = report();
    const endpoint = endpointFor(khazan, digest("B"), "7");
    endpoint.routes = endpoint.routes.filter(
      (route) => route.name !== "get-overlapped-result-ex"
    );
    assert.deepEqual(
      validateOverlayControllerMiddlewareCapabilityReport(
        khazan,
        expectation()
      ),
      {
        valid: false,
        reason: "hid-route-uncovered",
        backend: "hid-overlapped",
        endpointId: digest("B"),
        handleGeneration: "7",
        route: "get-overlapped-result-ex",
      }
    );
  });
});
