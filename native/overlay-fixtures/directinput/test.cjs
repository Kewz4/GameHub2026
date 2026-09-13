const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const buildRoot = path.resolve(process.argv[2] ?? "");
const fixturePath = path.join(
  buildRoot,
  "gamehub-overlay-qa-directinput-fixture.exe"
);
const launcherPath = path.join(
  buildRoot,
  "gamehub-overlay-qa-directinput-launcher.exe"
);
const resultsRoot = path.join(buildRoot, "qa-results");
const resultPath = (label) => path.join(resultsRoot, `${label}.json`);
let sharingViolationRetries = 0;

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

const runFixture = (executable, label, scenario, expectedStatus) => {
  cleanResult(label);
  let result;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    result = run(executable, [
      "--result",
      resultPath(label),
      "--scenario",
      scenario,
    ]);
    const transientSharingViolation =
      executable === launcherPath &&
      result.status === 96 &&
      /DetourCreateProcessWithDllW failed: 32\s*$/u.test(result.stderr) &&
      !fs.existsSync(resultPath(label));
    if (!transientSharingViolation) break;
    sharingViolationRetries += 1;
    Atomics.wait(
      new Int32Array(new SharedArrayBuffer(4)),
      0,
      0,
      50 * (attempt + 1)
    );
  }
  assert.equal(result.error, undefined);
  assert.equal(result.status, expectedStatus, result.stderr);
  return readCompleteResult(label);
};

const testUninjected = () => {
  const report = runFixture(fixturePath, "uninjected-negative", "normal", 30);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.entryReached, true);
  assert.equal(report.bootstrapLoadedBeforeEntry, false);
  assert.equal(report.preBlockPhysicalObserved, true);
  assert.equal(report.proofPassed, false);
};

const testLateAttach = () => {
  const report = runFixture(fixturePath, "late-attach-negative", "late", 31);
  assert.equal(report.bootstrapLoadedBeforeEntry, false);
  assert.equal(report.latePhysicalCallEscaped, true);
  assert.equal(report.lateOnlyBlockedSubsequentCall, true);
  assert.equal(report.proofPassed, false);
  assert.equal(report.detachError, 0);
};

const testMalformed = () => {
  const report = runFixture(
    launcherPath,
    "malformed-negative",
    "malformed",
    40
  );
  assert.equal(report.bootstrapLoadedBeforeEntry, true);
  assert.equal(report.malformedFormatRejected, true);
  assert.equal(report.finalFaultCode, 0);
  assert.equal(report.proofPassed, false);
  assert.equal(report.detachError, 0);
};

const testUnsupported = (scenario, field, status) => {
  const report = runFixture(
    launcherPath,
    `${scenario}-unsupported-negative`,
    scenario,
    status
  );
  assert.equal(report.bootstrapLoadedBeforeEntry, true);
  assert.equal(report[field], true);
  if (scenario === "registry-exhaustion") {
    assert.equal(report.registryExhaustionCleanupPassed, true);
  }
  assert.notEqual(report.finalFaultCode, 0);
  assert.equal(report.proofPassed, false);
  assert.equal(report.detachError, scenario === "drain" ? 5023 : 0);
};

const testSafetyNegative = (scenario, field, status, faultCode) => {
  const report = runFixture(
    launcherPath,
    `${scenario}-negative`,
    scenario,
    status
  );
  assert.equal(report.bootstrapLoadedBeforeEntry, true);
  assert.equal(report[field], true);
  assert.equal(report.finalFaultCode, faultCode);
  assert.equal(report.proofPassed, false);
  assert.equal(report.detachError, 0);
};

const assertInjected = (label, scenario) => {
  const report = runFixture(launcherPath, label, scenario, 0);
  const alwaysTrue = [
    "entryReached",
    "bootstrapLoadedBeforeEntry",
    "cacheInitializedBeforeBootstrap",
    "preAttachPhysicalObserved",
    "exactProviderResolved",
    "hookAttachedBeforeEntry",
    "exactBodiesValidated",
    "cachedFactoryIntercepted",
    "cachedRootBodyIntercepted",
    "rootComIdentityExact",
    "deviceComIdentityExact",
    "refcountsBalanced",
    "customFormatAccepted",
    "malformedFormatRejected",
    "rangeSemanticsPreserved",
    "preBlockPhysicalObserved",
    "blockedKeyboardNeutral",
    "blockedJoystickNeutral",
    "blockedCustomNeutral",
    "blockedPaddingPreserved",
    "blockedQueryAliasNeutral",
    "bufferedDataDrained",
    "pollCoveredWhileLatched",
    "releaseFenceCompleted",
    "noStaleDataAfterRelease",
    "releasedCachedPointerPhysical",
    "rearmRejectedBadAuth",
    "skippedRearmGenerationRejected",
    "skippedRearmEpochRejected",
    "replayedRearmIgnored",
    "staleGenerationRejectedAfterRearm",
    "secondCycleReleased",
    "concurrentHotCallsPassed",
    "detachQuiescencePassed",
    "detachedCachedPointerPhysical",
    "providerObjectsReleased",
    "proofPassed",
  ];
  for (const field of alwaysTrue) {
    assert.equal(report[field], true, `${label}: ${field}`);
  }
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.scenario, scenario);
  assert.equal(report.attachError, 0);
  assert.equal(report.beginEvent, 1);
  assert.equal(report.releaseEvent, 4);
  assert.equal(report.detachError, 0);
  assert.equal(report.finalFaultCode, 0);
  if (scenario === "normal") {
    assert.equal(report.staleIdentityIgnored, true);
    assert.equal(report.nonNeutralPreventedRelease, true);
  } else if (scenario === "rollback") {
    assert.equal(report.rollbackRestartedDwell, true);
  } else {
    assert.equal(report.topologyInvalidationKeptLatch, true);
    assert.equal(report.topologyRevalidatedExactEpoch, true);
  }
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
    true,
    "exact timeout-contained fixture identity survived launcher return"
  );
  assert.equal(fs.existsSync(resultPath(label)), false);
};

const testCrashContainment = () => {
  const label = "launcher-crash-containment";
  const pidFile = path.join(resultsRoot, `${label}.pid`);
  cleanResult(label);
  if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
  const result = childProcess.spawnSync(
    launcherPath,
    [
      "--result",
      resultPath(label),
      "--scenario",
      "hang",
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
  assert.equal(result.error, undefined);
  assert.equal(result.status, 197, result.stderr);
  const identity = readIdentity(pidFile);
  assert.equal(
    waitForProcessExit(identity.pid, identity.creationTicks, 5_000),
    true,
    "exact crash-contained fixture identity survived launcher death"
  );
  assert.equal(fs.existsSync(resultPath(label)), false);
};

fs.mkdirSync(resultsRoot, { recursive: true });
testUninjected();
process.stdout.write("PASS uninjected DI8 provider is a negative control\n");
testLateAttach();
process.stdout.write(
  "PASS late attach proves one physical cached call escapes\n"
);
testMalformed();
process.stdout.write(
  "PASS malformed DIDATAFORMAT is rejected without corruption\n"
);
testUnsupported("unknown", "unknownFormatFailedClosed", 41);
testUnsupported("action", "actionMapFailedClosed", 42);
testUnsupported("event", "eventNotificationFailedClosed", 43);
testUnsupported("drain", "drainFailureFailedClosed", 44);
process.stdout.write(
  "PASS unknown/action-map/event/drain failures fail closed\n"
);
testSafetyNegative("slot-tamper", "slotTamperFailedClosed", 45, 3);
testSafetyNegative(
  "registry-exhaustion",
  "registryExhaustionFailedClosed",
  46,
  4
);
process.stdout.write(
  "PASS slot topology tamper and >8-device registry exhaustion fail closed\n"
);
assertInjected("injected-normal", "normal");
assertInjected("injected-time-rollback", "rollback");
assertInjected("injected-topology-invalidation", "invalidation");
process.stdout.write("PASS DI8 neutralization and release-fence scenarios\n");
for (let index = 0; index < 20; index += 1) {
  const scenario =
    index % 3 === 0 ? "normal" : index % 3 === 1 ? "rollback" : "invalidation";
  assertInjected(`injected-stress-${String(index).padStart(2, "0")}`, scenario);
}
process.stdout.write(
  "PASS 20-process DirectInput attach/release/detach stress\n"
);
testTimeoutContainment();
process.stdout.write("PASS timeout containment leaves no fixture result\n");
testCrashContainment();
process.stdout.write("PASS launcher crash closes the exact child job\n");
process.stdout.write(
  `PASS bounded pre-child sharing retries: ${sharingViolationRetries}\n`
);
process.stdout.write("PASS 34 synthetic DirectInput acceptance cases\n");
