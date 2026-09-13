const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const buildRoot = path.resolve(process.argv[2] ?? "");
const hostPath = path.join(buildRoot, "gamehub-overlay-qa-secure-channel.exe");
const resultsRoot = path.join(buildRoot, "qa-results");

const resultPath = (label) => path.join(resultsRoot, `${label}.json`);
const identityPath = (label) => path.join(resultsRoot, `${label}.identity`);

const removeIfPresent = (filePath) => {
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
};

const sleep = (milliseconds) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);

const run = (args, timeout = 15_000) =>
  childProcess.spawnSync(hostPath, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout,
    windowsHide: true,
  });

const readCompleteReport = (label) => {
  const value = fs.readFileSync(resultPath(label), "utf8");
  assert.ok(value.endsWith("\n"), `${label}: report was not fully flushed`);
  return JSON.parse(value);
};

const waitForReport = (label, timeoutMs = 5_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(resultPath(label))) {
      try {
        return readCompleteReport(label);
      } catch (error) {
        if (error?.code !== "EBUSY" && error?.code !== "EACCES") throw error;
      }
    }
    sleep(25);
  }
  assert.fail(`${label}: timed out waiting for orphan-safe reader report`);
};

const assertBaseReport = (label, report) => {
  assert.equal(report.schemaVersion, 1);
  for (const field of [
    "bootstrapRead",
    "pipeAllowlisted",
    "ownerHandleAllowlisted",
    "ackHandleAllowlisted",
    "ownerIdentityMatched",
    "decoyExcluded",
    "selfIdentityMatched",
    "mapOpened",
    "blockAuthenticated",
    "blockLatched",
    "exactSlotsAccepted",
    "proofPassed",
  ]) {
    assert.equal(report[field], true, `${label}: ${field}`);
  }
  assert.equal(report.finalLatched, false, `${label}: block latch leaked`);
  assert.ok(report.acceptedPublications >= 2, `${label}: no valid release`);
};

const regularScenarios = [
  ["normal", null],
  ["forged", "macRejected"],
  ["ack-spoof", "macRejected"],
  ["wrong-nonce", "nonceRejected"],
  ["stale-pid", "identityRejected"],
  ["stale-creation", "identityRejected"],
  ["stale-coordinator", "identityRejected"],
  ["wrong-volume", "identityRejected"],
  ["wrong-file-id", "identityRejected"],
  ["wrong-canonical-path", "identityRejected"],
  ["stale-generation", "generationRejected"],
  ["stale-topology", "topologyRejected"],
  ["torn", "tornRejected"],
  ["replay", "replayRejected"],
  ["blocked-release", "slotRejected"],
  ["race", null],
  ["two-writer", null],
];

const testRegularScenario = (scenario, rejectionField) => {
  const label = `scenario-${scenario}`;
  removeIfPresent(resultPath(label));
  const processResult = run([
    "--result",
    resultPath(label),
    "--scenario",
    scenario,
  ]);
  assert.equal(processResult.error, undefined, `${label}: spawn failure`);
  assert.equal(processResult.status, 0, processResult.stderr);
  const report = readCompleteReport(label);
  assert.equal(report.scenario, scenario);
  assertBaseReport(label, report);
  assert.equal(report.releasedAuthenticated, true);
  assert.equal(report.ownerDeathFailOpen, false);
  if (rejectionField !== null) {
    assert.ok(report[rejectionField] > 0, `${label}: ${rejectionField}`);
    assert.equal(report.latchPreserved, true, `${label}: latch was not held`);
  }
  if (scenario === "forged" || scenario === "ack-spoof") {
    assert.equal(report.attackerProbeBits, 0x7f);
  }
  if (scenario === "race") {
    assert.ok(report.acceptedRaceHeartbeats > 0);
    assert.ok(report.acceptedBlockedPublications >= 2);
  }
  if (scenario === "two-writer") {
    assert.ok(report.acceptedConcurrentRaceHeartbeats > 0);
    assert.ok(report.casContention > 0);
    assert.equal(report.latchPreserved, true);
    assert.ok(report.macRejected > 0 || report.tornRejected > 0);
    assert.equal(report.attackerProbeBits, 0x7f);
  }
};

const readIdentity = (filePath) => {
  const match = /^(\d+) (\d+)\n$/u.exec(fs.readFileSync(filePath, "utf8"));
  assert.ok(match, `malformed child identity: ${filePath}`);
  return { pid: Number(match[1]), creationTicks: match[2] };
};

const exactProcessExited = (identity, timeoutMs = 5_000) => {
  const deadline = Date.now() + timeoutMs;
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
    sleep(25);
  }
  return false;
};

const testPrecreated = (scenario) => {
  const label = scenario;
  removeIfPresent(resultPath(label));
  const processResult = run([
    "--result",
    resultPath(label),
    "--scenario",
    scenario,
  ]);
  assert.equal(processResult.error, undefined);
  assert.equal(processResult.status, 0, processResult.stderr);
  assert.match(processResult.stdout, /PREEXISTING_REJECTED/u);
  assert.equal(fs.existsSync(resultPath(label)), false);
};

const testOwnerDeath = () => {
  const label = "owner-death-fail-open";
  removeIfPresent(resultPath(label));
  const processResult = run([
    "--result",
    resultPath(label),
    "--scenario",
    "owner-death",
  ]);
  assert.equal(processResult.error, undefined);
  assert.equal(processResult.status, 198, processResult.stderr);
  const report = waitForReport(label);
  assert.equal(report.scenario, "owner-death");
  assert.equal(report.bootstrapRead, true);
  assert.equal(report.ownerHandleAllowlisted, true);
  assert.equal(report.ackHandleAllowlisted, true);
  assert.equal(report.ownerIdentityMatched, true);
  assert.equal(report.decoyExcluded, true);
  assert.equal(report.blockLatched, true);
  assert.equal(report.ownerDeathFailOpen, true);
  assert.equal(report.releasedAuthenticated, false);
  assert.equal(report.finalLatched, false);
  assert.equal(report.proofPassed, true);
};

const testContainment = (scenario, expectedStatus) => {
  const label = `${scenario}-containment`;
  removeIfPresent(resultPath(label));
  removeIfPresent(identityPath(label));
  const processResult = run(
    [
      "--result",
      resultPath(label),
      "--scenario",
      scenario,
      "--identity",
      identityPath(label),
    ],
    5_000
  );
  assert.equal(processResult.error, undefined);
  assert.equal(processResult.status, expectedStatus, processResult.stderr);
  const identity = readIdentity(identityPath(label));
  assert.equal(
    exactProcessExited(identity),
    true,
    `${label}: exact job-contained child survived`
  );
};

const runParallelStress = async () => {
  const count = 24;
  const processes = [];
  for (let index = 0; index < count; index += 1) {
    const label = `stress-${String(index).padStart(2, "0")}`;
    removeIfPresent(resultPath(label));
    processes.push(
      new Promise((resolve, reject) => {
        const child = childProcess.spawn(
          hostPath,
          ["--result", resultPath(label), "--scenario", "normal"],
          {
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
          }
        );
        let stderr = "";
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk) => {
          stderr += chunk;
        });
        child.on("error", reject);
        child.on("exit", (code) => {
          try {
            assert.equal(code, 0, `${label}: ${stderr}`);
            const report = readCompleteReport(label);
            assertBaseReport(label, report);
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      })
    );
  }
  await Promise.all(processes);
};

const main = async () => {
  fs.mkdirSync(resultsRoot, { recursive: true });
  for (const [scenario, rejectionField] of regularScenarios) {
    testRegularScenario(scenario, rejectionField);
    process.stdout.write(`PASS secure channel ${scenario}\n`);
  }
  for (const scenario of [
    "precreated-map",
    "precreated-update",
    "precreated-wrong-type",
  ]) {
    testPrecreated(scenario);
    process.stdout.write(`PASS ${scenario} is rejected\n`);
  }
  testOwnerDeath();
  process.stdout.write(
    "PASS owner death releases the blocked latch fail-open\n"
  );
  testContainment("timeout", 99);
  process.stdout.write("PASS timeout is job-contained\n");
  testContainment("crash", 197);
  process.stdout.write("PASS coordinator crash is job-contained\n");
  await runParallelStress();
  process.stdout.write("PASS 24-process parallel secure-channel stress\n");
  process.stdout.write("PASS 47 synthetic secure-channel acceptance cases\n");
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
