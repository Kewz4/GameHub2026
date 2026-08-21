const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const buildRoot = path.resolve(process.argv[2] ?? "");
const fixture = path.join(
  buildRoot,
  "gamehub-overlay-qa-dxgi-d3d11-fixture.exe"
);
const launcher = path.join(
  buildRoot,
  "gamehub-overlay-qa-dxgi-d3d11-launcher.exe"
);
const results = path.join(buildRoot, "qa-results");
fs.mkdirSync(results, { recursive: true });
const E_NOINTERFACE = 0x80004002;
const DXGI_ERROR_INVALID_CALL = 0x887a0001;
const DXGI_STATUS_OCCLUDED = 0x087a0001;
const D3D11_BASE_GETTER_VISIBLE_MASK = 0x0000ffff;
const OM_TARGETS_DIFFERENCE_MASK = 1 << 8;

const assertHiddenWindowPresentSucceeded = (result) => {
  assert.ok(
    result === 0 || result === DXGI_STATUS_OCCLUDED,
    `unexpected hidden-window Present result: 0x${result.toString(16)}`
  );
};

const run = (executable, scenario, label) => {
  const result = path.join(results, `${label}.json`);
  fs.rmSync(result, { force: true });
  const child = childProcess.spawnSync(
    executable,
    ["--result", result, "--scenario", scenario],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 30_000,
    }
  );
  const report = fs.existsSync(result)
    ? JSON.parse(fs.readFileSync(result, "utf8"))
    : null;
  return { child, report };
};

const readIdentity = (filePath) => {
  const match = /^(\d+) (\d+)\n$/u.exec(fs.readFileSync(filePath, "utf8"));
  assert.ok(match, `malformed process identity: ${filePath}`);
  return { pid: Number(match[1]), creationTicks: match[2] };
};

const waitForExactExit = (identity) => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const probe = childProcess.spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `$p=Get-Process -Id ${identity.pid} -ErrorAction SilentlyContinue; if ($null -eq $p) { exit 0 }; $ticks=$p.StartTime.ToUniversalTime().ToFileTimeUtc().ToString(); if ($ticks -ne '${identity.creationTicks}') { exit 0 }; exit 1`,
      ],
      { encoding: "utf8", windowsHide: true }
    );
    if (probe.status === 0) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
  return false;
};

const baseline = run(fixture, "normal", "uninjected-negative");
assert.equal(baseline.child.status, 30, baseline.child.stderr);
assert.equal(baseline.report.bootstrapLoaded, false);
assert.equal(baseline.report.proofPassed, false);
process.stdout.write("PASS uninjected D3D11 chain is not intercepted\n");

const late = run(fixture, "late-attach", "late-attach-negative");
assert.equal(late.child.status, 0, late.child.stderr);
assert.equal(late.report.lateAttachNegative, true);
assert.equal(late.report.snapshotAfter, true);
assert.equal(late.report.methodHooksAttached, 0);
assert.equal(late.report.proofPassed, true);
process.stdout.write(
  "PASS late attach cannot claim pre-entry DXGI body coverage\n"
);

const assertInjected = (scenario, label) => {
  const result = run(launcher, scenario, label);
  assert.equal(result.child.status, 0, result.child.stderr);
  const report = result.report;
  assert.equal(report.proofPassed, true);
  assert.equal(report.snapshotBefore, true);
  assert.equal(report.snapshotAfter, true);
  assert.equal(report.restoreAfterWithSucceeded, 1);
  assert.equal(report.dllMainD3dCalls, 0);
  assert.equal(report.entryAttachError, 0);
  assert.equal(report.methodAttachError, 0);
  assert.equal(report.entryHookAttached, 1);
  assert.equal(report.methodDiscoveryBeforeApplicationEntry, 1);
  assert.equal(report.methodHooksAttached, 1);
  assert.ok(report.methodAttachThreadsEnlisted >= 1);
  assert.equal(report.methodIdentity, true);
  assert.equal(report.attachedMethodIdentity, true);
  assert.equal(report.registeredObjectPointersMatched, true);
  assert.equal(report.identityMatched, 1);
  assert.equal(report.deviceIdentityMatched, 1);
  assert.equal(report.immediateContextMatched, 1);
  assert.equal(report.liveMethodBodiesMatched, 1);
  assert.equal(report.releaseTokenBodiesMatched, 1);
  assert.equal(report.deferredContextCreateResult, 0);
  assert.equal(report.deferredContextRegisterResult, E_NOINTERFACE);
  assert.equal(report.seedResult, 0);
  assert.equal(
    report.seededD3d11BaseGetterVisibleMask,
    D3D11_BASE_GETTER_VISIBLE_MASK
  );
  assert.ok(report.stateRestoreChecks >= 2);
  assert.equal(report.stateRestoreMismatches, 0);
  assert.equal(report.lastStateRestoreDifferenceMask, 0);
  assert.equal(
    report.d3d11BaseGetterVisibleStateMask,
    D3D11_BASE_GETTER_VISIBLE_MASK
  );
  assert.deepEqual(report.stageDifferenceMasks, [0, 0, 0, 0, 0, 0]);
  if (scenario === "multisample") {
    assert.equal(report.postDxgiPresentGetterVisibleEqual, true);
    assert.equal(report.postDxgiPresentDifferenceMask, 0);
    assert.equal(report.postDxgiPresentDifferenceCategory, "none");
  } else {
    assert.equal(report.postDxgiPresentGetterVisibleEqual, false);
    assert.equal(
      report.postDxgiPresentDifferenceMask,
      OM_TARGETS_DIFFERENCE_MASK
    );
    assert.equal(
      report.postDxgiPresentDifferenceCategory,
      "omTargetsAfterRealFlipPresent"
    );
  }
  assert.ok(report.overlayDraws >= 2);
  assert.ok(report.competingChainRefusals >= 1);
  assert.ok(report.skippedContention >= 1);
  assert.equal(report.present1Present, 1);
  assertHiddenWindowPresentSucceeded(report.present1Result);
  assert.equal(report.present1Calls, 1);
  assert.equal(report.setSourceSizePresent, 1);
  assert.equal(report.setSourceSizeCalls, 2);
  if (scenario === "multisample") {
    assert.equal(report.sourceSizeSuccessResult, DXGI_ERROR_INVALID_CALL);
    assert.equal(report.sourceSizeFailureResult, DXGI_ERROR_INVALID_CALL);
    assert.equal(report.setSourceSizeSuccesses, 0);
    assert.equal(report.setSourceSizeFailures, 2);
  } else {
    assert.equal(report.sourceSizeSuccessResult, 0);
    assert.equal(report.sourceSizeFailureResult, DXGI_ERROR_INVALID_CALL);
    assert.equal(report.setSourceSizeSuccesses, 1);
    assert.equal(report.setSourceSizeFailures, 1);
  }
  assert.equal(report.fullscreenResult, 0);
  assert.equal(report.fullscreenCalls, 1);
  assert.ok(report.resourceRecreations >= 1);
  return report;
};

const normal = assertInjected("normal", "injected-normal");
assert.equal(normal.resizeBuffersCalls, 2);
assert.equal(normal.resizeBuffersSuccesses, 1);
assert.equal(normal.resizeBuffersFailures, 1);
assert.equal(normal.resizeBuffers1Present, 1);
assert.equal(normal.resizeBuffers1FailureResult, DXGI_ERROR_INVALID_CALL);
assert.equal(normal.resizeBuffers1Result, DXGI_ERROR_INVALID_CALL);
assert.equal(normal.resizeBuffers1Calls, 2);
assert.equal(normal.resizeBuffers1Successes, 0);
assert.equal(normal.resizeBuffers1Failures, 2);
process.stdout.write("PASS real WARP D3D11 identity/state/resize matrix\n");

const multisample = assertInjected("multisample", "injected-multisample");
assert.ok(multisample.multisampleBackbuffers >= 1);
assert.equal(multisample.resizeBuffersCalls, 0);
assert.equal(multisample.resizeBuffers1Calls, 0);
process.stdout.write("PASS multisample backbuffer overlay draw\n");

const destruction = assertInjected("destruction", "injected-destruction");
assert.equal(destruction.destructionProof, true);
assert.equal(destruction.destroyedInvalidations, 1);
assert.equal(destruction.destructionIdentityResult, 0);
assert.ok(destruction.destructionBaseReleaseRemaining >= 1);
assert.equal(destruction.destructionIdentityReleaseRemaining, 0);
assert.equal(destruction.destructionViaControllingUnknown, true);
assert.equal(destruction.registeredAfterScenario, 0);
assert.equal(destruction.invalidatedAfterScenario, 1);
assert.equal(destruction.invalidationReason, 1);
assert.ok(destruction.releaseCalls >= 2);
process.stdout.write("PASS exact swap-chain destruction invalidates state\n");

const deviceLost = assertInjected("device-lost", "injected-device-lost");
assert.equal(deviceLost.terminalPresentResultSeamAccepted, true);
assert.equal(deviceLost.nonterminalPresentResultSeamRejected, true);
assert.equal(deviceLost.deviceLostInvalidations, 1);
assert.equal(deviceLost.registeredAfterScenario, 0);
assert.equal(deviceLost.invalidatedAfterScenario, 1);
assert.equal(deviceLost.invalidationReason, 2);
process.stdout.write("PASS terminal Present-result seam invalidates state\n");

const barrier = assertInjected("detach-barrier", "injected-detach-barrier");
assert.equal(barrier.detachObservedInFlight, true);
assert.equal(barrier.detachBlockedForReader, true);
assert.equal(barrier.detachWaitingExclusiveObserved, true);
assert.equal(barrier.lateEntrantAdmissionAttempted, true);
assert.equal(barrier.lateEntrantWaitingForAdmission, true);
assert.equal(barrier.lateEntrantBlockedBeforeAdmission, true);
assert.equal(barrier.lateEntrantPresentResult, 0);
assert.equal(barrier.lateEntrantForwardedAfterDetach, true);
assert.ok(barrier.postDetachPresentForwards >= 1);
assert.equal(barrier.barrierDetachResult, 0);
assert.equal(barrier.detachQuiesced, 1);
assert.equal(barrier.detachCommitComplete, 1);
assert.ok(barrier.detachThreadsEnlisted >= 1);
process.stdout.write("PASS detach waits for in-flight Present reader\n");

const crashIdentityPath = path.join(results, "launcher-crash-containment.pid");
const crashResultPath = path.join(results, "launcher-crash-containment.json");
fs.rmSync(crashIdentityPath, { force: true });
fs.rmSync(crashResultPath, { force: true });
const crash = childProcess.spawnSync(
  launcher,
  [
    "--result",
    crashResultPath,
    "--scenario",
    "normal",
    "--crash-pid",
    crashIdentityPath,
  ],
  { encoding: "utf8", windowsHide: true, timeout: 5_000 }
);
assert.equal(crash.status, 197, crash.stderr);
assert.equal(waitForExactExit(readIdentity(crashIdentityPath)), true);
assert.equal(fs.existsSync(crashResultPath), false);
process.stdout.write("PASS kill-on-close job survives launcher crash test\n");

for (let index = 0; index < 24; index += 1) {
  assertInjected("normal", `stress-${String(index).padStart(2, "0")}`);
}
process.stdout.write("PASS 24-process fresh WARP attach/detach stress\n");
process.stdout.write("PASS 32 DXGI/D3D11 synthetic acceptance cases\n");
