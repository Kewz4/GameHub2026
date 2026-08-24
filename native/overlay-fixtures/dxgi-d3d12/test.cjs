const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const buildRoot = path.resolve(process.argv[2] ?? "");
const fixture = path.join(
  buildRoot,
  "gamehub-overlay-qa-dxgi-d3d12-fixture.exe"
);
const launcher = path.join(
  buildRoot,
  "gamehub-overlay-qa-dxgi-d3d12-launcher.exe"
);
const results = path.join(buildRoot, "qa-results");
fs.mkdirSync(results, { recursive: true });

const bootstrapSource = fs.readFileSync(
  path.join(__dirname, "bootstrap.cpp"),
  "utf8"
);
const submitOverlaySource =
  /bool SubmitOverlay\(\) noexcept \{([\s\S]*?)\n\}/u.exec(bootstrapSource);
assert.ok(submitOverlaySource, "SubmitOverlay body was not found");
assert.doesNotMatch(
  submitOverlaySource[1],
  /\b(?:new|HeapAlloc|HeapReAlloc|LocalAlloc|GlobalAlloc|CoTaskMemAlloc|CoTaskMemRealloc|malloc|calloc|realloc|aligned_alloc|_aligned_malloc|VirtualAlloc|VirtualAlloc2|MapViewOfFile|CreateEvent|WaitForSingleObject|WaitForMultipleObjects|MsgWaitForMultipleObjects|SignalObjectAndWait|WaitOnAddress|Sleep|SleepConditionVariableSRW|AcquireSRWLock|EnterCriticalSection)\b/u,
  "D3D12 overlay submission introduced an explicit allocation or wait API"
);

const E_NOINTERFACE = 0x80004002;
const E_OUTOFMEMORY = 0x8007000e;
const DXGI_ERROR_INVALID_CALL = 0x887a0001;
const DXGI_ERROR_UNSUPPORTED = 0x887a0004;
const DXGI_ERROR_DEVICE_REMOVED = 0x887a0005;
const DXGI_STATUS_OCCLUDED = 0x087a0001;
const ERROR_BUSY = 170;

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
    { encoding: "utf8", windowsHide: true, timeout: 45_000 }
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
        `$probeErrors=@(); $p=Get-Process -Id ${identity.pid} -ErrorAction SilentlyContinue -ErrorVariable +probeErrors; if ($probeErrors.Count -gt 0) { $unexpected=@($probeErrors | Where-Object { $_.FullyQualifiedErrorId -notlike 'NoProcessFoundForGivenId,*' }); if ($unexpected.Count -gt 0) { exit 2 }; exit 0 }; if ($null -eq $p) { exit 2 }; try { $ticks=$p.StartTime.ToUniversalTime().ToFileTimeUtc().ToString() } catch { exit 2 }; if ($ticks -ne '${identity.creationTicks}') { exit 0 }; exit 1`,
      ],
      { encoding: "utf8", windowsHide: true }
    );
    if (probe.status === 0) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
  return false;
};

const simulatedHardFailure = run(
  fixture,
  "setup-hard-failure",
  "setup-hard-failure"
);
assert.equal(simulatedHardFailure.child.status, 21);
assert.equal(simulatedHardFailure.report.unsupported, false);
assert.equal(simulatedHardFailure.report.setupFailed, true);
assert.equal(simulatedHardFailure.report.createStage, "primary-command-queue");
assert.equal(simulatedHardFailure.report.createResult, E_OUTOFMEMORY);
process.stdout.write("PASS setup hard failures cannot become skips\n");

const simulatedUnsupported = run(
  fixture,
  "setup-unsupported",
  "setup-unsupported"
);
assert.equal(simulatedUnsupported.child.status, 77);
assert.equal(simulatedUnsupported.report.unsupported, true);
assert.equal(simulatedUnsupported.report.setupFailed, true);
assert.equal(simulatedUnsupported.report.createStage, "d3d12-device");
assert.equal(simulatedUnsupported.report.createResult, DXGI_ERROR_UNSUPPORTED);
process.stdout.write(
  "PASS allowlisted D3D12 unavailability is an honest skip\n"
);

const baseline = run(fixture, "normal", "uninjected-negative");
if (baseline.child.status === 77 && baseline.report?.unsupported === true) {
  process.stdout.write(
    `SKIP DXGI/D3D12 WARP unavailable at ${baseline.report.createStage} (HRESULT 0x${baseline.report.createResult.toString(16)})\n`
  );
  process.exit(0);
}
assert.equal(baseline.child.status, 30, baseline.child.stderr);
assert.equal(baseline.report.unsupported, false);
assert.equal(baseline.report.bootstrapLoaded, false);
assert.equal(baseline.report.proofPassed, false);
process.stdout.write("PASS uninjected D3D12 chain is not intercepted\n");

const late = run(fixture, "late-attach", "late-attach-negative");
assert.equal(late.child.status, 0, late.child.stderr);
assert.equal(late.report.lateAttachNegative, true);
assert.equal(late.report.methodHooksAttached, 0);
assert.equal(late.report.proofPassed, true);
process.stdout.write(
  "PASS late attach cannot claim pre-entry D3D12 cached-pointer coverage\n"
);

const assertInjectedBase = (scenario, label) => {
  const result = run(launcher, scenario, label);
  assert.equal(result.child.status, 0, result.child.stderr);
  const report = result.report;
  assert.equal(report.unsupported, false);
  assert.equal(report.setupFailed, false);
  assert.equal(report.createStage, "complete");
  assert.equal(report.createResult, 0);
  assert.equal(report.proofPassed, true);
  assert.equal(report.snapshotBefore, true);
  assert.equal(report.snapshotPreDetach, true);
  assert.equal(report.snapshotAfter, true);
  assert.equal(report.restoreAfterWithSucceeded, 1);
  assert.equal(report.dllMainGraphicsCalls, 0);
  assert.equal(report.entryAttachError, 0);
  assert.equal(report.methodAttachError, 0);
  assert.equal(report.entryHookAttached, 1);
  assert.equal(report.methodDiscoveryBeforeApplicationEntry, 1);
  assert.equal(report.methodHooksAttached, 1);
  assert.ok(report.methodAttachThreadsEnlisted >= 1);
  assert.equal(report.present1Present, 1);
  assert.equal(report.createSwapChainHookPresent, 1);
  assert.equal(report.methodIdentity, true);
  assert.equal(report.attachedMethodIdentity, true);
  assert.equal(report.wrongQueueRegisterResult, E_NOINTERFACE);
  assert.equal(report.registerResult, 0);
  assert.equal(report.registeredPointersMatch, true);
  assert.equal(report.identityMatched, 1);
  assert.equal(report.deviceIdentityMatched, 1);
  assert.equal(report.commandQueueIdentityMatched, 1);
  assert.equal(report.creationRecordMatched, 1);
  assert.equal(report.liveMethodBodiesMatched, 1);
  assert.equal(report.preallocatedHotPathResources, 1);
  assert.equal(report.separateCommandListSubmission, 1);
  assertHiddenWindowPresentSucceeded(report.primaryPresentResult);
  assertHiddenWindowPresentSucceeded(report.competingPresentResult);
  assertHiddenWindowPresentSucceeded(report.contentionPresentResult);
  assertHiddenWindowPresentSucceeded(report.present1Result);
  assert.ok(report.presentCalls >= (scenario === "idle-stale-timeout" ? 3 : 4));
  assert.equal(report.present1Calls, 1);
  assert.equal(
    report.commandListsExecuted,
    report.overlaySubmissions + report.submissionSignalFailures
  );
  assert.ok(report.commandQueueSignals >= report.overlaySubmissions);
  assert.equal(report.presentBlockingWaitCalls, 0);
  assert.ok(report.skippedContention >= 1);
  assert.ok(report.competingChainRefusals >= 1);
  assert.equal(report.resizeBuffersCalls, 2);
  assert.equal(report.fullscreenResult, 0);
  assert.equal(report.fullscreenQueryResult, 0);
  assert.equal(report.fullscreenState, false);
  assert.equal(report.fullscreenCalls, 1);
  assert.ok(report.creationRecords >= 2);
  assert.equal(report.creationRecordOverflows, 0);
  assert.equal(report.windowsCreated, true);
  assert.equal(report.windowRectRead, true);
  assert.ok(report.windowWidth > 0);
  assert.ok(report.windowHeight > 0);
  assert.equal(report.windowsDestroyed, true);
  assert.equal(report.detachQuiesced, 1);
  assert.equal(report.detachCommitComplete, 1);
  assert.ok(report.detachThreadsEnlisted >= 1);
  return report;
};

const assertCleanInjected = (scenario, label) => {
  const report = assertInjectedBase(scenario, label);
  assert.equal(report.resizeFailure, DXGI_ERROR_INVALID_CALL);
  assert.equal(report.resizeSuccess, 0);
  assert.equal(report.resizeBuffersSuccesses, 1);
  assert.equal(report.resizeBuffersFailures, 1);
  assert.ok(report.overlaySubmissions >= (scenario === "signal-fault" ? 1 : 2));
  assert.ok(report.resourceIdleSignals >= 2);
  assert.equal(report.resourceIdleCompletions, report.resourceIdleSignals);
  assert.equal(report.resourceIdleFailures, 0);
  assert.equal(report.resourceIdleTimeouts, 0);
  assert.equal(report.staleWakeRejections, 0);
  assert.equal(report.retiredWaitEvents, 0);
  assert.equal(report.idleWaitPoisoned, 0);
  assert.equal(report.registeredResourcesRetired, 0);
  assert.ok(report.resourceRecreations >= 3);
  assert.equal(report.detachResult, 0);
  assert.equal(report.registeredAfterDetach, 0);
  return report;
};

assertCleanInjected("normal", "injected-normal");
process.stdout.write(
  "PASS real WARP D3D12 queue identity, Present/Present1, resize, fence, and window lifecycle\n"
);

const signalFault = assertCleanInjected(
  "signal-fault",
  "injected-signal-fault"
);
assert.equal(signalFault.faultArmResult, true);
assert.equal(signalFault.snapshotFirstFault, true);
assert.equal(signalFault.snapshotRepeatedFault, true);
assertHiddenWindowPresentSucceeded(signalFault.faultRepeatPresentResult);
assert.equal(signalFault.firstFaultCommandListsExecuted, 1);
assert.equal(signalFault.repeatedFaultCommandListsExecuted, 1);
assert.equal(signalFault.firstFaultOverlaySubmissions, 0);
assert.equal(signalFault.firstFaultUntrackedSubmission, 1);
assert.equal(signalFault.firstFaultRetiredSubmissionSlots, 1);
assert.equal(signalFault.firstFaultRegisteredResourcesRetired, 1);
assert.equal(signalFault.firstFaultOverlayReady, 0);
assert.equal(signalFault.submissionSignalFailures, 1);
assert.equal(signalFault.submissionSlotRetirements, 1);
assert.equal(signalFault.independentIdleRecoveries, 1);
assert.equal(signalFault.untrackedSubmission, 0);
assert.equal(signalFault.retiredSubmissionSlots, 0);
process.stdout.write(
  "PASS failed post-execute Signal retires the slot until an exact idle fence\n"
);

const staleWaitFault = assertInjectedBase(
  "idle-stale-timeout",
  "injected-idle-stale-timeout"
);
assert.equal(staleWaitFault.faultArmResult, true);
assert.equal(staleWaitFault.snapshotFirstIdleFault, true);
assert.equal(staleWaitFault.firstIdleFaultOverlayReady, 0);
assert.equal(staleWaitFault.firstIdleFaultResourceIdleFailures, 1);
assert.equal(staleWaitFault.firstIdleFaultResourceIdleTimeouts, 1);
assert.equal(staleWaitFault.firstIdleFaultStaleWakeRejections, 1);
assert.equal(staleWaitFault.firstIdleFaultRetiredWaitEvents, 1);
assert.equal(staleWaitFault.resizeFailure, DXGI_ERROR_DEVICE_REMOVED);
assert.equal(staleWaitFault.resizeSuccess, DXGI_ERROR_DEVICE_REMOVED);
assert.equal(staleWaitFault.resizeBuffersSuccesses, 0);
assert.equal(staleWaitFault.resizeBuffersFailures, 2);
assert.equal(staleWaitFault.resourceIdleSignals, 1);
assert.equal(staleWaitFault.resourceIdleCompletions, 0);
assert.ok(staleWaitFault.resourceIdleFailures >= 3);
assert.ok(staleWaitFault.resourceIdleWaitsOutsidePresent >= 2);
assert.equal(staleWaitFault.resourceIdleTimeouts, 1);
assert.equal(staleWaitFault.staleWakeRejections, 1);
assert.equal(staleWaitFault.retiredWaitEvents, 1);
assert.equal(staleWaitFault.idleWaitPoisoned, 1);
assert.equal(staleWaitFault.registeredResourcesRetired, 1);
assert.equal(staleWaitFault.resourceRecreations, 1);
assert.equal(staleWaitFault.detachResult, ERROR_BUSY);
assert.equal(staleWaitFault.registeredAfterDetach, 1);
assert.equal(staleWaitFault.idleWaitPoisonedAfterDetach, 1);
assert.equal(staleWaitFault.registeredResourcesRetiredAfterDetach, 1);
process.stdout.write(
  "PASS stale fence wake plus timeout permanently retires unsafe resources\n"
);

const barrier = assertCleanInjected(
  "detach-barrier",
  "injected-detach-barrier"
);
assert.equal(barrier.detachObservedInFlight, true);
assert.equal(barrier.detachBlockedForReader, true);
assert.equal(barrier.detachWaitingExclusiveObserved, true);
assert.equal(barrier.lateEntrantAdmissionAttempted, true);
assert.equal(barrier.lateEntrantWaitingForAdmission, true);
assert.equal(barrier.lateEntrantBlockedBeforeAdmission, true);
assertHiddenWindowPresentSucceeded(barrier.lateEntrantPresentResult);
assert.equal(barrier.lateEntrantForwardedAfterDetach, true);
assert.ok(barrier.postDetachPresentForwards >= 1);
process.stdout.write(
  "PASS detach waits for an in-flight D3D12 Present reader\n"
);

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

for (let index = 0; index < 12; index += 1) {
  assertCleanInjected("normal", `stress-${String(index).padStart(2, "0")}`);
}
process.stdout.write("PASS 12-process fresh WARP D3D12 attach/detach stress\n");
process.stdout.write("PASS 21 DXGI/D3D12 synthetic acceptance cases\n");
