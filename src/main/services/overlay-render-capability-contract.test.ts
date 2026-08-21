import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  OVERLAY_RENDER_BACKENDS,
  OVERLAY_RENDER_SURFACES,
  validateOverlayRenderCapabilityReport,
  type OverlayRenderBackend,
  type OverlayRenderCapabilityExpectation,
  type OverlayRenderCapabilityReport,
  type OverlayRenderEvidence,
  type OverlayRenderSurface,
} from "./overlay-render-capability-contract";

const identity = {
  sessionId: "overlay_render_contract_session_0001",
  pid: 4421,
  creationTicks: "132456789012345678",
  canonicalExecutablePath: "C:\\Games\\Fixture\\fixture.exe",
  volumeSerial: "000000000000A1B2",
  fileId: "00112233445566778899AABBCCDDEEFF",
} as const;

const requiredSurfaces = [
  "present",
  "resize-buffers",
  "swap-chain-destruction",
  "device-removal",
  "pipeline-state-restore",
  "multi-swap-chain-selection",
  "late-module-resolution",
] as const satisfies readonly OverlayRenderSurface[];

const expectation = (): OverlayRenderCapabilityExpectation => ({
  identity: { ...identity },
  inputGeneration: 7,
  renderGeneration: 3,
  topologyEpoch: "9",
  nativeCommitSequence: "14",
  targetArchitecture: "x64",
  activeBackend: "dxgi-d3d11",
  requiredSurfaces: [...requiredSurfaces],
});

const backendEvidence = () =>
  OVERLAY_RENDER_BACKENDS.map<OverlayRenderEvidence<OverlayRenderBackend>>(
    (name) => ({
      name,
      state: name === "dxgi-d3d11" ? "covered" : "absent",
    })
  );

const surfaceEvidence = () =>
  OVERLAY_RENDER_SURFACES.map<OverlayRenderEvidence<OverlayRenderSurface>>(
    (name) => ({
      name,
      state: requiredSurfaces.includes(
        name as (typeof requiredSurfaces)[number]
      )
        ? "covered"
        : "absent",
    })
  );

const report = (): OverlayRenderCapabilityReport => ({
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
  backendEvidence: backendEvidence(),
  surfaceEvidence: surfaceEvidence(),
});

describe("overlay render capability contract", () => {
  it("accepts a complete identity- and input-generation-fenced report", () => {
    const result = validateOverlayRenderCapabilityReport(
      report(),
      expectation()
    );
    assert.equal(result.valid, true);
    if (result.valid) {
      assert.ok(Object.isFrozen(result.report));
      assert.ok(Object.isFrozen(result.report.backendEvidence));
    }
  });

  it("never throws for malformed runtime values", () => {
    const throwingReport = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("untrusted report trap");
        },
      }
    );
    for (const value of [
      null,
      [],
      {},
      { ...report(), identity: null },
      throwingReport,
    ]) {
      assert.doesNotThrow(() =>
        validateOverlayRenderCapabilityReport(value, expectation())
      );
      assert.deepEqual(
        validateOverlayRenderCapabilityReport(value, expectation()),
        {
          valid: false,
          reason: "invalid-report",
        }
      );
    }
    const throwingExpectation = {
      get identity(): never {
        throw new Error("untrusted expectation getter");
      },
    };
    assert.deepEqual(
      validateOverlayRenderCapabilityReport(report(), throwingExpectation),
      { valid: false, reason: "invalid-expectation" }
    );
  });

  it("requires an independently valid expectation", () => {
    assert.deepEqual(
      validateOverlayRenderCapabilityReport(report(), {
        ...expectation(),
        requiredSurfaces: ["present"],
      }),
      { valid: false, reason: "invalid-expectation" }
    );
  });

  it("requires D3D12 queue identity and resource fencing", () => {
    const value = report();
    value.activeBackend = "dxgi-d3d12";
    value.backendEvidence = value.backendEvidence.map((item) => ({
      ...item,
      state: item.name === "dxgi-d3d12" ? "covered" : "absent",
    }));
    assert.deepEqual(
      validateOverlayRenderCapabilityReport(value, {
        ...expectation(),
        activeBackend: "dxgi-d3d12",
      }),
      { valid: false, reason: "invalid-expectation" }
    );
  });

  it("fences the full pinned target identity", () => {
    const value = report();
    value.identity.fileId = "FFEEDDCCBBAA99887766554433221100";
    assert.deepEqual(
      validateOverlayRenderCapabilityReport(value, expectation()),
      {
        valid: false,
        reason: "target-identity-mismatch",
      }
    );
  });

  it("binds rendering to the authorized input generation", () => {
    const value = report();
    value.inputGeneration += 1;
    assert.deepEqual(
      validateOverlayRenderCapabilityReport(value, expectation()),
      {
        valid: false,
        reason: "stale-input-generation",
      }
    );
  });

  it("requires an exact target/payload architecture match", () => {
    const value = report();
    value.payloadArchitecture = "x86";
    assert.deepEqual(
      validateOverlayRenderCapabilityReport(value, expectation()),
      {
        valid: false,
        reason: "payload-architecture-mismatch",
      }
    );
  });

  it("rejects incomplete backend evidence", () => {
    const value = report();
    value.backendEvidence = value.backendEvidence.slice(1);
    assert.deepEqual(
      validateOverlayRenderCapabilityReport(value, expectation()),
      {
        valid: false,
        reason: "invalid-report",
      }
    );
  });

  it("requires the selected backend to be covered", () => {
    const value = report();
    value.backendEvidence = value.backendEvidence.map((item) =>
      item.name === "dxgi-d3d11" ? { ...item, state: "absent" } : item
    );
    assert.deepEqual(
      validateOverlayRenderCapabilityReport(value, expectation()),
      {
        valid: false,
        reason: "active-backend-uncovered",
        backend: "dxgi-d3d11",
      }
    );
  });

  it("fails when any observed backend is unsupported", () => {
    const value = report();
    value.backendEvidence = value.backendEvidence.map((item) =>
      item.name === "dxgi-d3d12" ? { ...item, state: "unsupported" } : item
    );
    assert.deepEqual(
      validateOverlayRenderCapabilityReport(value, expectation()),
      {
        valid: false,
        reason: "observed-backend-uncovered",
        backend: "dxgi-d3d12",
      }
    );
  });

  it("requires every independently selected lifecycle surface", () => {
    const value = report();
    value.surfaceEvidence = value.surfaceEvidence.map((item) =>
      item.name === "pipeline-state-restore"
        ? { ...item, state: "absent" }
        : item
    );
    assert.deepEqual(
      validateOverlayRenderCapabilityReport(value, expectation()),
      {
        valid: false,
        reason: "required-surface-uncovered",
        surface: "pipeline-state-restore",
      }
    );
  });

  it("refuses a fault on an optional observed surface", () => {
    const value = report();
    value.surfaceEvidence = value.surfaceEvidence.map((item) =>
      item.name === "present1" ? { ...item, state: "fault" } : item
    );
    assert.deepEqual(
      validateOverlayRenderCapabilityReport(value, expectation()),
      {
        valid: false,
        reason: "observed-surface-uncovered",
        surface: "present1",
      }
    );
  });

  it("accepts only literal hot-path safety booleans", () => {
    const value = {
      ...report(),
      nonblockingPresentPath: "true",
    };
    assert.deepEqual(
      validateOverlayRenderCapabilityReport(value, expectation()),
      {
        valid: false,
        reason: "invalid-report",
      }
    );
  });

  it("refuses multiple covered rendering backends", () => {
    const value = report();
    value.backendEvidence = value.backendEvidence.map((item) =>
      item.name === "dxgi-d3d12" ? { ...item, state: "covered" } : item
    );
    assert.deepEqual(
      validateOverlayRenderCapabilityReport(value, expectation()),
      {
        valid: false,
        reason: "multiple-render-backends",
        backend: "dxgi-d3d12",
      }
    );
  });
});
