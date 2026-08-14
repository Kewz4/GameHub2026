const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const buildRoot = path.resolve(process.argv[2] ?? "");
const fixturePath = path.join(
  buildRoot,
  "gamehub-overlay-qa-cached-pointer-fixture.exe"
);
const launcherPath = path.join(
  buildRoot,
  "gamehub-overlay-qa-cached-pointer-launcher.exe"
);
const resultsRoot = path.join(buildRoot, "qa-results");

const PRE_ATTACH_PROBE = 0x10203040;
const HOOK_PROBE = 0x11223344;
const RESTORE_PROBE = 0x55667788;
const ORIGINAL_XOR_MASK = 0xa5a55a5a;
const ORIGINAL_BIAS = 0x13579bdf;
const HOOK_XOR_MASK = 0xc0dec0de;

const expectedOriginal = (input) => {
  const mixed = (input ^ ORIGINAL_XOR_MASK) >>> 0;
  const rotated = ((mixed << 7) | (mixed >>> 25)) >>> 0;
  return (rotated + ORIGINAL_BIAS) >>> 0;
};

const expectedHooked = (input) =>
  (expectedOriginal(input) ^ HOOK_XOR_MASK) >>> 0;

const resultPath = (label) => path.join(resultsRoot, `${label}.json`);

const cleanResult = (label) => {
  const filePath = resultPath(label);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
};

const run = (executable, args) =>
  childProcess.spawnSync(executable, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 15_000,
    windowsHide: true,
  });

const readCompleteResult = (label) => {
  const text = fs.readFileSync(resultPath(label), "utf8");
  assert.ok(text.endsWith("\n"), `${label} result was not fully flushed`);
  return JSON.parse(text);
};

const testUninjectedBaseline = () => {
  const label = "uninjected-baseline";
  cleanResult(label);
  const processResult = run(fixturePath, ["--result", resultPath(label)]);
  assert.equal(processResult.error, undefined);
  assert.equal(processResult.status, 30, processResult.stderr);
  const report = readCompleteResult(label);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.entryReached, true);
  assert.equal(report.bootstrapLoadedBeforeEntry, false);
  assert.equal(report.snapshotBeforeAvailable, false);
  assert.equal(report.hookedCallValue, expectedOriginal(HOOK_PROBE));
  assert.notEqual(report.hookedCallValue, expectedHooked(HOOK_PROBE));
  assert.equal(report.cachedCallReachedHook, false);
  assert.equal(report.restoredCallValue, expectedOriginal(RESTORE_PROBE));
  assert.equal(report.proofPassed, false);
};

const assertInjectedProof = (label) => {
  cleanResult(label);
  const processResult = run(launcherPath, [resultPath(label)]);
  assert.equal(processResult.error, undefined);
  assert.equal(processResult.status, 0, processResult.stderr);
  const report = readCompleteResult(label);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.entryReached, true);
  assert.equal(report.bootstrapLoadedBeforeEntry, true);
  assert.equal(report.snapshotBeforeAvailable, true);
  assert.equal(report.restoreAfterWithSucceeded, true);
  assert.equal(report.dependencyInitializedBeforeAttach, true);
  assert.equal(report.cachedPointerMatchedTargetBeforeAttach, true);
  assert.equal(report.preAttachProbeValue, expectedOriginal(PRE_ATTACH_PROBE));
  assert.equal(
    report.expectedPreAttachProbeValue,
    expectedOriginal(PRE_ATTACH_PROBE)
  );
  assert.equal(report.attachError, 0);
  assert.equal(report.hookAttachedBeforeEntry, true);
  assert.equal(report.hookCallsBefore, 0);
  assert.equal(report.hookedCallValue, expectedHooked(HOOK_PROBE));
  assert.notEqual(report.hookedCallValue, expectedOriginal(HOOK_PROBE));
  assert.equal(report.hookCallsAfter, 1);
  assert.equal(report.cachedCallReachedHook, true);
  assert.equal(report.detachError, 0);
  assert.equal(report.detached, true);
  assert.equal(report.restoredCallValue, expectedOriginal(RESTORE_PROBE));
  assert.equal(
    report.expectedRestoredCallValue,
    expectedOriginal(RESTORE_PROBE)
  );
  assert.equal(report.hookCallsAfterRestore, 1);
  assert.equal(report.restoredCallWasOriginal, true);
  assert.match(report.cachedPointerBeforeAttach, /^[1-9]\d*$/u);
  assert.equal(
    report.targetPointerBeforeAttach,
    report.cachedPointerBeforeAttach
  );
  assert.equal(
    report.cachedPointerAfterAttach,
    report.cachedPointerBeforeAttach
  );
  assert.equal(
    report.cachedPointerAfterDetach,
    report.cachedPointerBeforeAttach
  );
  assert.equal(report.currentCachedPointer, report.cachedPointerBeforeAttach);
  assert.equal(report.cachedPointerAddressStable, true);
  assert.equal(report.proofPassed, true);
};

fs.mkdirSync(resultsRoot, { recursive: true });
testUninjectedBaseline();
process.stdout.write(
  "PASS uninjected cached pointer stays on original target\n"
);
assertInjectedProof("injected-proof-1");
process.stdout.write(
  "PASS cached pointer crosses real DetourAttach and DetourDetach\n"
);
assertInjectedProof("injected-proof-2");
process.stdout.write(
  "PASS cached-pointer proof is repeatable in a fresh process\n"
);
for (let index = 0; index < 25; index += 1) {
  assertInjectedProof(`injected-stress-${String(index).padStart(2, "0")}`);
}
process.stdout.write("PASS 25-process cached-pointer attach/detach stress\n");
process.stdout.write("PASS 28 cached-pointer synthetic acceptance cases\n");
