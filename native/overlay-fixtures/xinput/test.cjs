const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const buildRoot = path.resolve(process.argv[2] ?? "");
const fixturePath = path.join(
  buildRoot,
  "gamehub-overlay-qa-xinput-fixture.exe"
);
const launcherPath = path.join(
  buildRoot,
  "gamehub-overlay-qa-xinput-launcher.exe"
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
  const processResult = run(fixturePath, [
    "--result",
    resultPath(label),
    "--scenario",
    "normal",
    "--enable",
    "none",
  ]);
  assert.equal(processResult.error, undefined);
  assert.equal(processResult.status, 30, processResult.stderr);
  const report = readCompleteResult(label);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.entryReached, true);
  assert.equal(report.bootstrapLoadedBeforeEntry, false);
  assert.equal(report.preBlockPhysicalConnected, true);
  assert.equal(report.proofPassed, false);
};

const testLateAttach = () => {
  const label = "late-attach-negative";
  cleanResult(label);
  const processResult = run(fixturePath, [
    "--result",
    resultPath(label),
    "--scenario",
    "late",
    "--enable",
    "none",
  ]);
  assert.equal(processResult.error, undefined);
  assert.equal(processResult.status, 31, processResult.stderr);
  const report = readCompleteResult(label);
  assert.equal(report.entryReached, true);
  assert.equal(report.bootstrapLoadedBeforeEntry, false);
  assert.equal(report.latePhysicalCallEscapedBeforeAttach, true);
  assert.equal(report.lateHookCouldOnlyBlockSubsequentCall, true);
  assert.equal(report.detachError, 0);
  assert.equal(report.proofPassed, false);
};

const assertInjected = (label, scenario, enableMode) => {
  cleanResult(label);
  const processResult = run(launcherPath, [
    "--result",
    resultPath(label),
    "--scenario",
    scenario,
    "--enable",
    enableMode,
  ]);
  assert.equal(processResult.error, undefined);
  assert.equal(processResult.status, 0, processResult.stderr);
  const report = readCompleteResult(label);
  const alwaysTrue = [
    "entryReached",
    "bootstrapLoadedBeforeEntry",
    "cacheInitializedBeforeBootstrap",
    "cachedPointersMatchedProvider",
    "bootstrapAttachedExactCachedBodies",
    "cachedPointersStable",
    "hookAttachedBeforeEntry",
    "preBlockPhysicalConnected",
    "absentUserStayedDisconnected",
    "physicalVibrationAForwarded",
    "blockStoppedVibration",
    "blockedStateConnectedNeutral",
    "blockedStateExConnectedNeutral",
    "blockedPacketTransitioned",
    "blockedPacketStableAcrossHiddenChange",
    "blockedAbsentUserStayedDisconnected",
    "blockedKeystrokeEmptyAndZero",
    "blockedQueueDrained",
    "blockedVibrationBRememberedNotForwarded",
    "enableCallsSwallowedWhileBlocked",
    "releaseFenceCompleted",
    "releaseKeptDetoursAttached",
    "requestedEnableRestored",
    "rememberedVibrationRestored",
    "noStaleKeystrokeAfterRelease",
    "releasedCachedPointerReturnedPhysical",
    "detachedCachedPointerReturnedPhysical",
    "proofPassed",
  ];
  for (const field of alwaysTrue) {
    assert.equal(report[field], true, `${label}: ${field}`);
  }
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.scenario, scenario);
  assert.equal(report.enableMode, enableMode);
  assert.equal(report.attachError, 0);
  assert.equal(report.releaseEvent, 4);
  assert.equal(report.detachError, 0);
  assert.notEqual(
    report.blockedPacket,
    report.physicalPacketBeforeBlock,
    `${label}: blocked packet must represent the neutral transition`
  );
  assert.equal(
    report.providerSetStateCallsAfterBlockedRequest,
    report.providerSetStateCallsBeforeBlockedRequest,
    `${label}: SetState leaked to provider while blocked`
  );
  assert.equal(
    report.providerEnableCallsAfterBlockedRequests,
    report.providerEnableCallsBeforeBlockedRequests,
    `${label}: XInputEnable leaked to provider while blocked`
  );
  if (scenario === "normal") {
    assert.equal(report.pendingAndNonNeutralPreventedRelease, true);
    assert.equal(report.staleIdentityIgnored, true);
    assert.equal(report.repeatedCloseWasIdempotent, true);
  } else if (scenario === "rollback") {
    assert.equal(report.timeRollbackRestartedDwell, true);
  } else if (scenario === "invalidation") {
    assert.equal(report.topologyInvalidationKeptLatch, true);
  }
  assert.equal(report.finalProviderEnabled, 1);
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

const testCrashContainment = () => {
  const label = "launcher-crash-containment";
  const pidFile = path.join(resultsRoot, `${label}.pid`);
  cleanResult(label);
  if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
  const launcher = childProcess.spawnSync(
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
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5_000,
      windowsHide: true,
    }
  );
  assert.equal(launcher.error, undefined);
  assert.equal(launcher.status, 197, launcher.stderr);
  const identity = readIdentity(pidFile);
  assert.ok(Number.isInteger(identity.pid) && identity.pid > 0);
  assert.equal(
    waitForProcessExit(identity.pid, identity.creationTicks, 5_000),
    true,
    "exact crash-contained fixture identity survived launcher death"
  );
  assert.equal(fs.existsSync(resultPath(label)), false);
};

const testTimeoutContainment = () => {
  const label = "launcher-timeout-containment";
  const identityFile = path.join(resultsRoot, `${label}.identity`);
  cleanResult(label);
  if (fs.existsSync(identityFile)) fs.unlinkSync(identityFile);
  const processResult = run(
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
  assert.equal(processResult.error, undefined);
  assert.equal(processResult.status, 99, processResult.stderr);
  const identity = readIdentity(identityFile);
  assert.equal(
    waitForProcessExit(identity.pid, identity.creationTicks, 5_000),
    true,
    "exact timeout-contained fixture identity survived launcher return"
  );
  assert.equal(fs.existsSync(resultPath(label)), false);
};

fs.mkdirSync(resultsRoot, { recursive: true });
testUninjected();
process.stdout.write("PASS uninjected provider is a negative control\n");
testLateAttach();
process.stdout.write("PASS late attach proves one physical call escapes\n");
assertInjected("injected-normal-none", "normal", "none");
assertInjected("injected-normal-false", "normal", "false");
assertInjected("injected-normal-true", "normal", "true");
process.stdout.write("PASS XInputEnable none/FALSE/TRUE restore semantics\n");
assertInjected("injected-time-rollback", "rollback", "true");
process.stdout.write("PASS backwards time restarts neutral dwell\n");
assertInjected("injected-topology-invalidation", "invalidation", "true");
process.stdout.write("PASS topology invalidation keeps the block latch\n");
for (let index = 0; index < 25; index += 1) {
  assertInjected(
    `injected-stress-${String(index).padStart(2, "0")}`,
    "normal",
    index % 3 === 0 ? "none" : index % 3 === 1 ? "false" : "true"
  );
}
process.stdout.write("PASS 25-process XInput attach/release/detach stress\n");
testTimeoutContainment();
process.stdout.write("PASS timeout containment leaves no fixture result\n");
testCrashContainment();
process.stdout.write("PASS launcher crash closes the child job\n");
process.stdout.write("PASS 34 synthetic XInput acceptance cases\n");
