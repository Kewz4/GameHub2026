import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  OVERLAY_INPUT_BACKENDS,
  validateOverlayInputCapabilityReport,
  type OverlayInputBackend,
  type OverlayInputBackendState,
  type OverlayInputCapabilityReport,
} from "./overlay-input-capability-contract";

const identity = {
  sessionId: "overlay_capability_session_00000001",
  pid: 42,
  creationTicks: "133700000000000000",
  canonicalExecutablePath: String.raw`C:\Games\Fixture\fixture.exe`,
  volumeSerial: "00000000000000A1",
  fileId: "000000000000000000000000000000B2",
} as const;
const expected = {
  identity,
  generation: 17,
  topologyEpoch: "23",
  nativeCommitSequence: "41",
  absenceMonitorEpoch: "47",
  requiredChildRoutes: [],
} as const;

const report = (
  overrides: Partial<OverlayInputCapabilityReport> = {},
  states: Partial<Record<OverlayInputBackend, OverlayInputBackendState>> = {}
): OverlayInputCapabilityReport => ({
  schemaVersion: 1,
  identity,
  generation: 17,
  topologyEpoch: "23",
  nativeCommitSequence: "41",
  completeModuleSnapshot: true,
  absenceMonitorArmed: true,
  absenceMonitorEpoch: "47",
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

const reason = (unsafeReport: unknown, unsafeExpected: unknown = expected) => {
  const result = validateOverlayInputCapabilityReport(
    unsafeReport,
    unsafeExpected
  );
  return result.valid ? null : result.reason;
};

describe("overlay multi-stack capability contract", () => {
  it("validates one complete pre-entry native commit", () => {
    const result = validateOverlayInputCapabilityReport(report(), expected);
    assert.equal(result.valid, true);
    if (result.valid) {
      assert.equal(result.report.nativeCommitSequence, "41");
      assert.equal(Object.isFrozen(result.report), true);
      assert.equal(Object.isFrozen(result.report.observations), true);
    }
  });

  it("never throws on malformed envelopes, identities, arrays, or booleans", () => {
    const malformed: ReadonlyArray<
      readonly [unknown, "invalid-report" | "invalid-backend-report"]
    > = [
      [null, "invalid-report"],
      [undefined, "invalid-report"],
      [[], "invalid-report"],
      ["report", "invalid-report"],
      [{ ...report(), observations: null }, "invalid-report"],
      [{ ...report(), observations: [null] }, "invalid-backend-report"],
      [{ ...report(), identity: null }, "invalid-report"],
      [{ ...report(), completeModuleSnapshot: "false" }, "invalid-report"],
      [{ ...report(), requiredChildRoutes: true }, "invalid-report"],
      [{ ...report(), extra: true }, "invalid-report"],
      [
        new Proxy(
          {},
          {
            ownKeys() {
              throw new Error("untrusted report trap");
            },
          }
        ),
        "invalid-report",
      ],
    ];
    for (const [value, expectedReason] of malformed) {
      assert.doesNotThrow(() =>
        validateOverlayInputCapabilityReport(value, expected)
      );
      assert.equal(reason(value), expectedReason);
    }
    const throwingExpectation = {
      get identity(): never {
        throw new Error("untrusted expectation getter");
      },
    };
    assert.deepEqual(
      validateOverlayInputCapabilityReport(report(), throwingExpectation),
      { valid: false, reason: "invalid-expectation" }
    );
  });

  it("rejects malformed expectations and exact target/commit mismatches", () => {
    for (const value of [
      null,
      { ...expected, generation: 0 },
      { ...expected, topologyEpoch: "01" },
      { ...expected, nativeCommitSequence: "18446744073709551616" },
      { ...expected, absenceMonitorEpoch: "0" },
      {
        ...expected,
        requiredChildRoutes: ["shell-execute", "create-process-w-a"],
      },
      { ...expected, identity: { ...identity, pid: 0 } },
      { ...expected, identity: { ...identity, volumeSerial: "A1" } },
      { ...expected, identity: { ...identity, fileId: "B2" } },
    ]) {
      assert.equal(reason(report(), value), "invalid-expectation");
    }
    assert.equal(
      reason(report({ identity: { ...identity, creationTicks: "99" } })),
      "target-identity-mismatch"
    );
    assert.equal(
      reason(
        report({
          identity: { ...identity, volumeSerial: "00000000000000A2" },
        })
      ),
      "target-identity-mismatch"
    );
    assert.equal(
      reason(
        report({
          identity: {
            ...identity,
            fileId: "000000000000000000000000000000B3",
          },
        })
      ),
      "target-identity-mismatch"
    );
    assert.equal(reason(report({ generation: 16 })), "stale-generation");
    assert.equal(
      reason(report({ topologyEpoch: "22" })),
      "stale-topology-epoch"
    );
    assert.equal(
      reason(report({ nativeCommitSequence: "40" })),
      "stale-commit-sequence"
    );
    assert.equal(
      reason(report({ absenceMonitorEpoch: "46" })),
      "stale-absence-monitor-epoch"
    );
  });

  it("bounds native u64 fields and rejects leading zeros", () => {
    for (const value of ["0", "01", "18446744073709551616", "-1", "x"]) {
      assert.equal(reason(report({ topologyEpoch: value })), "invalid-report");
      assert.equal(
        reason(report({ nativeCommitSequence: value })),
        "invalid-report"
      );
      assert.equal(
        reason(report({ absenceMonitorEpoch: value })),
        "invalid-report"
      );
    }
    assert.equal(
      reason(report({ topologyEpoch: "18446744073709551615" }), {
        ...expected,
        topologyEpoch: "18446744073709551615",
      }),
      null
    );
  });

  it("requires snapshot, absence monitor, pre-entry detours, and release fence", () => {
    assert.equal(
      reason(report({ completeModuleSnapshot: false })),
      "incomplete-module-snapshot"
    );
    assert.equal(
      reason(report({ absenceMonitorArmed: false })),
      "absence-monitor-unavailable"
    );
    assert.equal(
      reason(report({ preEntryBootstrap: false })),
      "pre-entry-bootstrap-required"
    );
    assert.equal(
      reason(report({ cachedPointerInlineDetours: false })),
      "cached-pointer-detours-required"
    );
    assert.equal(
      reason(report({ releaseFenceReady: false })),
      "release-fence-unavailable"
    );
  });

  it("rejects incomplete, duplicate, unknown, and invalid backend records", () => {
    const complete = report();
    assert.equal(
      reason({ ...complete, observations: complete.observations.slice(1) }),
      "incomplete-backend-report"
    );
    assert.equal(
      reason({
        ...complete,
        observations: [complete.observations[0], ...complete.observations],
      }),
      "duplicate-backend-report"
    );
    assert.equal(
      reason({
        ...complete,
        observations: [
          ...complete.observations.slice(0, -1),
          { backend: "unknown", state: "covered" },
        ],
      }),
      "invalid-backend-report"
    );
    assert.equal(
      reason({
        ...complete,
        observations: [
          ...complete.observations.slice(0, -1),
          { backend: "nt-create-user-process", state: "partial" },
        ],
      }),
      "invalid-backend-report"
    );
  });

  it("requires keyboard, raw input, and loader monitoring in every report", () => {
    for (const backend of [
      "win32-keyboard",
      "raw-input",
      "late-module-resolution",
    ] as const) {
      const result = validateOverlayInputCapabilityReport(
        report({}, { [backend]: "absent" }),
        expected
      );
      assert.deepEqual(result, {
        valid: false,
        reason: "base-backend-uncovered",
        backend,
      });
    }
  });

  it("keeps Spider-Man-like sessions refused on uncovered middleware and HID", () => {
    const result = validateOverlayInputCapabilityReport(
      report(
        {},
        {
          "xinput-1.3": "covered",
          "wgi-gamepad": "covered",
          "wgi-raw-game-controller": "covered",
          "steam-input-interface-revisions": "unsupported",
          libscepad: "unsupported",
          "ds4-dualsense-middleware": "unsupported",
          "hid-input-reports": "unsupported",
        }
      ),
      expected
    );
    assert.deepEqual(result, {
      valid: false,
      reason: "observed-backend-uncovered",
      backend: "steam-input-interface-revisions",
    });
  });

  it("keeps Khazan-like sessions refused without exact W/A and DirectInput", () => {
    const noChild = validateOverlayInputCapabilityReport(
      report(
        { requiredChildRoutes: ["create-process-w-a"] },
        { "xinput-1.3": "covered", "direct-input-8": "unsupported" }
      ),
      { ...expected, requiredChildRoutes: ["create-process-w-a"] }
    );
    assert.deepEqual(noChild, {
      valid: false,
      reason: "child-propagation-uncovered",
      backend: "create-process-w-a",
    });

    const noDirectInput = validateOverlayInputCapabilityReport(
      report(
        { requiredChildRoutes: ["create-process-w-a"] },
        {
          "xinput-1.3": "covered",
          "direct-input-8": "unsupported",
          "create-process-w-a": "covered",
        }
      ),
      { ...expected, requiredChildRoutes: ["create-process-w-a"] }
    );
    assert.deepEqual(noDirectInput, {
      valid: false,
      reason: "observed-backend-uncovered",
      backend: "direct-input-8",
    });
  });

  it("accepts an explicit all-covered synthetic matrix", () => {
    const allCovered = Object.fromEntries(
      OVERLAY_INPUT_BACKENDS.map((backend) => [backend, "covered"])
    ) as Record<OverlayInputBackend, OverlayInputBackendState>;
    assert.equal(
      validateOverlayInputCapabilityReport(
        report(
          {
            requiredChildRoutes: [
              "create-process-w-a",
              "shell-execute",
              "nt-create-user-process",
            ],
          },
          allCovered
        ),
        {
          ...expected,
          requiredChildRoutes: [
            "create-process-w-a",
            "shell-execute",
            "nt-create-user-process",
          ],
        }
      ).valid,
      true
    );
  });

  it("binds exact child routes to the external expectation", () => {
    assert.equal(
      reason(report({ requiredChildRoutes: ["create-process-w-a"] }), {
        ...expected,
        requiredChildRoutes: ["shell-execute"],
      }),
      "child-route-requirement-mismatch"
    );
    const result = validateOverlayInputCapabilityReport(
      report({ requiredChildRoutes: ["shell-execute"] }),
      { ...expected, requiredChildRoutes: ["shell-execute"] }
    );
    assert.deepEqual(result, {
      valid: false,
      reason: "child-propagation-uncovered",
      backend: "shell-execute",
    });
  });
});
