const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const buildRoot = path.resolve(process.argv[2] ?? "");
const fixturePath = path.join(buildRoot, "gamehub-overlay-qa-wgi-fixture.exe");
const launcherPath = path.join(
  buildRoot,
  "gamehub-overlay-qa-wgi-launcher.exe"
);
const resultsRoot = path.join(buildRoot, "qa-results");
const resultPath = (label) => path.join(resultsRoot, `${label}.json`);

const cleanResult = (label) => {
  const filePath = resultPath(label);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
};

const run = (executable, args, timeout = 15_000) =>
  childProcess.spawnSync(executable, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout,
    windowsHide: true,
  });

const readCompleteResult = (label) => {
  const value = fs.readFileSync(resultPath(label), "utf8");
  assert.ok(value.endsWith("\n"), `${label} result was not fully flushed`);
  return JSON.parse(value);
};

const testUninjected = () => {
  const label = "uninjected-negative";
  cleanResult(label);
  const result = run(fixturePath, [
    "--result",
    resultPath(label),
    "--scenario",
    "normal",
    "--enable",
    "none",
  ]);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 30, result.stderr);
  const report = readCompleteResult(label);
  assert.equal(report.entryReached, true);
  assert.equal(report.bootstrapLoadedBeforeEntry, false);
  assert.equal(report.preBlockPhysical, true);
  assert.equal(report.proofPassed, false);
};

const testLateAttach = () => {
  const label = "late-attach-negative";
  cleanResult(label);
  const result = run(fixturePath, [
    "--result",
    resultPath(label),
    "--scenario",
    "late",
    "--enable",
    "none",
  ]);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 31, result.stderr);
  const report = readCompleteResult(label);
  assert.equal(report.bootstrapLoadedBeforeEntry, false);
  assert.equal(report.latePhysicalCallEscapedBeforeAttach, true);
  assert.equal(report.lateHookCouldOnlyBlockSubsequentCalls, true);
  assert.equal(report.detachError, 0);
  assert.equal(report.proofPassed, false);
};

const assertInjected = (label, scenario) => {
  cleanResult(label);
  const result = run(launcherPath, [
    "--result",
    resultPath(label),
    "--scenario",
    scenario,
    "--enable",
    "none",
  ]);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  const report = readCompleteResult(label);
  for (const field of [
    "entryReached",
    "bootstrapLoadedBeforeEntry",
    "cacheInitializedBeforeBootstrap",
    "cacheIdentityValidated",
    "cachedBodiesStable",
    "hookAttachedBeforeEntry",
    "activationBodyIntercepted",
    "blockedActivationIntercepted",
    "allSixPollBodiesIntercepted",
    "preBlockPhysical",
    "blockedAllNeutral",
    "drainMaskComplete",
    "nonNeutralPreventedRelease",
    "staleIdentityIgnored",
    "releaseFenceCompleted",
    "releaseKeptHooks",
    "releasedCachedPointersReturnedPhysical",
    "detachedCachedPointersReturnedPhysical",
    "comReferencesBalanced",
    "proofPassed",
  ]) {
    assert.equal(report[field], true, `${label}: ${field}`);
  }
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.scenario, scenario);
  assert.equal(report.attachError, 0);
  assert.equal(report.releaseEvent, 4);
  assert.equal(report.detachError, 0);
  assert.equal(report.snapshotCount, 6);
  if (scenario === "rollback") {
    assert.equal(report.timeRollbackRestartedDwell, true);
  } else if (scenario === "invalidation") {
    assert.equal(report.topologyInvalidationKeptLatch, true);
    assert.equal(report.serialRevalidationRequired, true);
    assert.ok(report.finalEpoch > report.initialEpoch);
  } else if (scenario === "replacement") {
    assert.equal(report.topologyInvalidationKeptLatch, true);
    assert.equal(report.serialRevalidationRequired, true);
    assert.equal(report.replacementRetainedOldAndNewIdentities, true);
    assert.equal(report.unregisteredSameBodyRejected, true);
    assert.ok(report.finalEpoch > report.initialEpoch);
  } else if (scenario === "reader-race") {
    assert.equal(report.immutableGenerationRacePassed, true);
    assert.equal(report.activeSnapshotGeneration, 3);
    assert.equal(report.publishedSnapshotCount, 3);
  } else if (scenario === "thread-stress") {
    assert.equal(report.eightThreadStressPassed, true);
  } else if (scenario.startsWith("fault-")) {
    assert.equal(report.malformedRejectedLatched, true);
    assert.equal(report.recoveryRequiredExplicitRevalidation, true);
    assert.equal(report.unknownInputsRejected, true);
    assert.ok(report.finalEpoch >= report.initialEpoch + 2);
  }
};

const testCapacityExhaustion = () => {
  const label = "snapshot-generation-cap-negative";
  cleanResult(label);
  const result = run(launcherPath, [
    "--result",
    resultPath(label),
    "--scenario",
    "capacity",
    "--enable",
    "none",
  ]);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 32, result.stderr);
  const report = readCompleteResult(label);
  assert.equal(report.capacityExhaustionRejectedLatched, true);
  assert.equal(report.activeSnapshotGeneration, 64);
  assert.equal(report.publishedSnapshotCount, 64);
  assert.equal(report.proofPassed, false);
};

const testOverReleaseDetector = () => {
  const label = "com-overrelease-negative";
  cleanResult(label);
  const result = run(fixturePath, [
    "--result",
    resultPath(label),
    "--scenario",
    "overrelease",
    "--enable",
    "none",
  ]);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 33, result.stderr);
  const report = readCompleteResult(label);
  assert.equal(report.comOverReleaseDetected, true);
  assert.equal(report.proofPassed, false);
};

const readIdentity = (filePath) => {
  const match = /^(\d+) (\d+)\n$/u.exec(fs.readFileSync(filePath, "utf8"));
  assert.ok(match, `malformed process identity: ${filePath}`);
  return { pid: Number(match[1]), creationTicks: match[2] };
};

const waitForProcessExit = (pid, creationTicks, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const probe = childProcess.spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($null -eq $p) { exit 0 }; $ticks=$p.StartTime.ToUniversalTime().ToFileTimeUtc().ToString(); if ($ticks -ne '${creationTicks}') { exit 0 }; exit 1`,
      ],
      { encoding: "utf8", windowsHide: true }
    );
    if (probe.status === 0) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
  return false;
};

const testTimeoutContainment = () => {
  const label = "launcher-timeout-containment";
  const identityFile = path.join(resultsRoot, `${label}.identity`);
  cleanResult(label);
  if (fs.existsSync(identityFile)) fs.unlinkSync(identityFile);
  const result = run(
    launcherPath,
    [
      "--result",
      resultPath(label),
      "--scenario",
      "hang",
      "--enable",
      "none",
      "--timeout-ms",
      "200",
      "--identity-file",
      identityFile,
    ],
    5_000
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 99, result.stderr);
  const identity = readIdentity(identityFile);
  assert.equal(
    waitForProcessExit(identity.pid, identity.creationTicks, 5_000),
    true
  );
  assert.equal(fs.existsSync(resultPath(label)), false);
};

const testCrashContainment = () => {
  const label = "launcher-crash-containment";
  const pidFile = path.join(resultsRoot, `${label}.pid`);
  cleanResult(label);
  if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
  const result = run(
    launcherPath,
    [
      "--result",
      resultPath(label),
      "--scenario",
      "hang",
      "--enable",
      "none",
      "--crash-pid",
      pidFile,
    ],
    5_000
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 197, result.stderr);
  const identity = readIdentity(pidFile);
  assert.equal(
    waitForProcessExit(identity.pid, identity.creationTicks, 5_000),
    true
  );
  assert.equal(fs.existsSync(resultPath(label)), false);
};

fs.mkdirSync(resultsRoot, { recursive: true });
testUninjected();
process.stdout.write("PASS uninjected WGI provider is a negative control\n");
testLateAttach();
process.stdout.write("PASS late WGI attach proves physical polling escaped\n");
assertInjected("injected-normal", "normal");
process.stdout.write(
  "PASS exact six-projection WGI cached-body interception\n"
);
assertInjected("injected-time-rollback", "rollback");
process.stdout.write("PASS WGI backwards time restarts the neutral dwell\n");
assertInjected("injected-topology-invalidation", "invalidation");
process.stdout.write(
  "PASS WGI epoch/serial invalidation requires revalidation\n"
);
assertInjected("injected-object-replacement", "replacement");
process.stdout.write(
  "PASS WGI replacement retains old and new cached identities\n"
);
assertInjected("injected-paused-reader-race", "reader-race");
process.stdout.write(
  "PASS immutable snapshots defeat paused-reader two-publication race\n"
);
assertInjected("injected-eight-thread-stress", "thread-stress");
process.stdout.write(
  "PASS eight concurrent WGI polling threads stay neutral\n"
);
for (const scenario of [
  "fault-qi",
  "fault-vtable",
  "fault-body",
  "fault-raw",
  "fault-activation",
  "fault-nonneutral",
]) {
  assertInjected(`injected-${scenario}`, scenario);
}
process.stdout.write(
  "PASS six malformed WGI topologies fail closed and recover explicitly\n"
);
testCapacityExhaustion();
process.stdout.write("PASS 65th snapshot generation fails closed at the cap\n");
testOverReleaseDetector();
process.stdout.write("PASS COM over-release detector catches imbalance\n");
for (let index = 0; index < 20; index += 1) {
  assertInjected(`injected-stress-${String(index).padStart(2, "0")}`, "normal");
}
process.stdout.write("PASS 20-process WGI attach/release/detach stress\n");
testTimeoutContainment();
process.stdout.write("PASS WGI timeout containment closes the exact child\n");
testCrashContainment();
process.stdout.write("PASS WGI launcher crash closes the child job\n");
process.stdout.write("PASS 38 synthetic WGI acceptance cases\n");
