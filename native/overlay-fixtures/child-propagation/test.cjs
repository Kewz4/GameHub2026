const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const buildRoot = path.resolve(process.argv[2] ?? "");
const launcher = path.join(buildRoot, "gamehub-overlay-qa-child-launcher.exe");
const resultsRoot = path.join(buildRoot, "qa-results");

const resultPath = (label, suffix) =>
  path.join(resultsRoot, `${label}-${suffix}.json`);

const clean = (...paths) => {
  for (const filePath of paths) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
};

const run = (mode, label, env = {}) => {
  const parentResult = resultPath(label, "parent");
  const childResult = resultPath(label, "child");
  clean(parentResult, childResult);
  const result = childProcess.spawnSync(
    launcher,
    [mode, parentResult, childResult],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 25_000,
      windowsHide: true,
      env: { ...process.env, ...env },
    }
  );
  return { result, parentResult, childResult };
};

const readCompleteJson = (filePath) => {
  const text = fs.readFileSync(filePath, "utf8");
  assert.ok(text.endsWith("\n"), `${filePath} was not fully flushed`);
  return JSON.parse(text);
};

const assertExact = (mode, label, expectedHook) => {
  const runResult = run(mode, label);
  assert.equal(runResult.result.error, undefined);
  assert.equal(runResult.result.status, 0, runResult.result.stderr);
  const parent = readCompleteJson(runResult.parentResult);
  const child = readCompleteJson(runResult.childResult);
  assert.equal(parent.proofPassed, true);
  assert.equal(parent.cachedCreateProcessPointerProof, true);
  assert.equal(parent.processCreated, true);
  assert.equal(parent.childExited, true);
  assert.equal(parent.childExitCode, 0);
  assert.equal(parent.callerSuspendSemanticsPreserved, true);
  assert.equal(parent.hookForwardingEchoMatches, true);
  assert.equal(parent.exactAttempts, 1);
  assert.equal(parent.instrumentedChildren, 1);
  assert.equal(parent.abortedNeverStartedChildren, 0);
  assert.equal(parent.passthroughChildren, 0);
  assert.equal(parent.capabilityState, 1);
  assert.equal(parent[expectedHook], 1);
  assert.equal(child.proofPassed, true);
  assert.equal(child.expectInjected, true);
  assert.equal(child.markerLoadedBeforeEntry, true);
  assert.equal(child.markerSnapshotAvailable, true);
  assert.equal(child.restoreAfterWithSucceeded, true);
  assert.equal(child.markerHandshakeReleasedBeforeEntry, true);
  assert.equal(child.markerIdentityMatches, true);
  assert.equal(child.environmentAndUnicodeArgumentsPreserved, true);
  assert.equal(child.currentDirectoryPreserved, true);
};

const assertPassthrough = (mode, label) => {
  const runResult = run(mode, label);
  assert.equal(runResult.result.error, undefined);
  assert.equal(runResult.result.status, 0, runResult.result.stderr);
  const parent = readCompleteJson(runResult.parentResult);
  const child = readCompleteJson(runResult.childResult);
  assert.equal(parent.proofPassed, true);
  assert.equal(parent.processCreated, true);
  assert.equal(parent.instrumentedChildren, 0);
  assert.equal(parent.passthroughChildren, 1);
  assert.equal(parent.capabilityState, 2);
  assert.equal(child.proofPassed, true);
  assert.equal(child.expectInjected, false);
  assert.equal(child.markerLoadedBeforeEntry, false);
  assert.equal(child.markerSnapshotAvailable, false);
};

const assertAbort = (mode, label) => {
  const runResult = run(mode, label);
  assert.equal(runResult.result.error, undefined);
  assert.equal(runResult.result.status, 0, runResult.result.stderr);
  const parent = readCompleteJson(runResult.parentResult);
  assert.equal(parent.proofPassed, true);
  assert.equal(parent.processCreated, false);
  assert.equal(parent.exactAttempts, 1);
  assert.equal(parent.instrumentedChildren, 0);
  assert.equal(parent.abortedNeverStartedChildren, 1);
  assert.equal(parent.capabilityState, 2);
  assert.equal(fs.existsSync(runResult.childResult), false);
};

fs.mkdirSync(resultsRoot, { recursive: true });
assertExact("exact-w", "exact-w-immediate", "hookCallsW");
process.stdout.write("PASS exact W child is marked before immediate entry\n");
assertExact("exact-w-suspended", "exact-w-caller-suspended", "hookCallsW");
process.stdout.write("PASS caller CREATE_SUSPENDED count is preserved\n");
assertExact("exact-a", "exact-a", "hookCallsA");
process.stdout.write(
  "PASS exact ANSI cached CreateProcess pointer is hooked\n"
);
assertPassthrough("unknown-w", "unknown-existing-file");
process.stdout.write(
  "PASS unknown existing child passes through and capability fails\n"
);
assertPassthrough("ambiguous-w", "ambiguous-null-app-name");
process.stdout.write(
  "PASS ambiguous null application name passes through and capability fails\n"
);
assertAbort("corrupt-w", "corrupt-handshake");
process.stdout.write(
  "PASS corrupt child identity aborts only never-started exact child\n"
);
assertAbort("timeout-w", "timeout-handshake");
process.stdout.write(
  "PASS marker timeout aborts only never-started exact child\n"
);

const crashProof = path.join(resultsRoot, "parent-death-child-pid.txt");
const crashParentResult = resultPath("parent-death", "parent");
const crashChildResult = resultPath("parent-death", "child");
clean(crashProof, crashParentResult, crashChildResult);
const crashStart = childProcess.spawn(
  launcher,
  ["parent-death-w", crashParentResult, crashChildResult],
  {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: {
      ...process.env,
      GAMEHUB_CHILD_QA_PARENT_CRASH_AFTER_READY: "1",
      GAMEHUB_CHILD_QA_CRASH_PROOF: crashProof,
    },
  }
);
crashStart.unref();
assert.equal(fs.existsSync(crashParentResult), false);
assert.equal(fs.existsSync(crashChildResult), false);
const deadline = Date.now() + 5_000;
while (!fs.existsSync(crashProof) && Date.now() < deadline) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
}
assert.ok(
  fs.existsSync(crashProof),
  "child marker did not observe parent death"
);
const [pidText, creationTicksText] = fs
  .readFileSync(crashProof, "utf8")
  .trim()
  .split(",");
const childPid = Number(pidText);
const childCreationTicks = BigInt(creationTicksText);
assert.ok(Number.isInteger(childPid) && childPid > 0);
assert.ok(childCreationTicks > 0n);
const childExitDeadline = Date.now() + 5_000;
let exactChildAlive = true;
while (exactChildAlive && Date.now() < childExitDeadline) {
  const query = childProcess.spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `$process = Get-Process -Id ${childPid} -ErrorAction SilentlyContinue; if ($null -eq $process) { exit 0 }; $ticks = $process.StartTime.ToUniversalTime().ToFileTimeUtc(); if ($ticks -eq ${childCreationTicks}) { exit 1 } else { exit 0 }`,
    ],
    { windowsHide: true, timeout: 5_000 }
  );
  exactChildAlive = query.status !== 0;
  if (exactChildAlive) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
}
assert.equal(
  exactChildAlive,
  false,
  `child ${childPid} remained after parent death`
);
process.stdout.write(
  "PASS parent death releases marker and exact child exits\n"
);

for (let index = 0; index < 25; index += 1) {
  assertExact(
    "exact-w",
    `stress-${String(index).padStart(2, "0")}`,
    "hookCallsW"
  );
}
process.stdout.write("PASS 25-process immediate child-entry stress\n");
process.stdout.write("PASS 33 child-propagation synthetic acceptance cases\n");
