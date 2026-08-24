const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const buildRoot = path.resolve(process.argv[2] ?? "");
const host = path.join(
  buildRoot,
  "gamehub-overlay-qa-supervised-evidence-host.exe"
);
const resultsRoot = path.join(buildRoot, "qa-results");

const scenarios = [
  ["normal", "none"],
  ["forged", "mac"],
  ["wrong-nonce", "nonce"],
  ["wrong-identity", "identity"],
  ["stale-generation", "input-generation"],
  ["stale-topology", "topology"],
  ["wrong-commit", "commit"],
  ["early-timing", "timing"],
  ["late", "publication-timeout"],
  ["early-exit", "publication-premature-exit"],
  ["release-replay", "release-sequence"],
  ["release-refused", "release-timeout"],
  ["late-release", "release-timeout"],
  ["release-early-exit", "release-premature-exit"],
];

const exactProcessExited = (pid, creationTicks) => {
  const script = `try { $p=Get-Process -Id ${pid} -ErrorAction Stop } catch { if ($_.FullyQualifiedErrorId -like 'NoProcessFoundForGivenId*') { exit 0 }; exit 2 }; if ($null -eq $p) { exit 2 }; try { $ticks=$p.StartTime.ToUniversalTime().ToFileTimeUtc().ToString() } catch { exit 2 }; if ($ticks -ne '${creationTicks}') { exit 0 }; exit 1`;
  const result = childProcess.spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { encoding: "utf8", windowsHide: true, timeout: 5_000 }
  );
  return result.status === 0;
};

fs.mkdirSync(resultsRoot, { recursive: true });
for (const [scenario, rejection] of scenarios) {
  const resultPath = path.join(resultsRoot, `${scenario}.json`);
  if (fs.existsSync(resultPath)) fs.unlinkSync(resultPath);
  const result = childProcess.spawnSync(
    host,
    ["--result", resultPath, "--scenario", scenario],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 8_000,
      windowsHide: true,
    }
  );
  assert.equal(result.error, undefined, `${scenario}: spawn failed`);
  assert.equal(result.status, 0, `${scenario}: ${result.stderr}`);
  const raw = fs.readFileSync(resultPath, "utf8");
  assert.ok(raw.endsWith("\n"), `${scenario}: result was not fully flushed`);
  const report = JSON.parse(raw);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.scenario, scenario);
  assert.equal(report.rejection, rejection);
  assert.equal(report.targetCreatedSuspended, true);
  assert.equal(report.bootstrapProvisionedWhileSuspended, true);
  assert.equal(report.oneShotBootstrapConsumed, true);
  assert.equal(report.selfIdentityValidated, true);
  assert.equal(report.exactIdentityMatched, true);
  assert.equal(report.resumedExactlyOnce, true);
  assert.equal(report.exactTargetContained, true);
  assert.equal(report.proofPassed, true);
  assert.equal(
    exactProcessExited(report.pid, report.creationTicks),
    true,
    `${scenario}: exact supervised target survived`
  );
  if (scenario === "normal") {
    for (const field of [
      "readyPublicationObserved",
      "readyMacAuthenticated",
      "bindingAccepted",
      "publishedAfterResume",
      "inputEvidenceAccepted",
      "renderEvidenceAccepted",
      "releaseRequested",
      "releaseAuthenticated",
      "gameEntryReachedAfterRelease",
      "targetExited",
    ]) {
      assert.equal(report[field], true, `normal: ${field}`);
    }
  } else {
    assert.equal(report.gameEntryReachedAfterRelease, false, scenario);
  }
  if (scenario === "late") {
    assert.equal(report.intendedStageReached, true);
    assert.equal(report.targetAliveAtExpectedTimeout, true);
    assert.equal(report.targetStage, 3);
  }
  if (scenario === "release-refused" || scenario === "late-release") {
    assert.equal(report.bindingAccepted, true);
    assert.equal(report.releaseRequested, true);
    assert.equal(report.intendedStageReached, true);
    assert.equal(report.targetAliveAtExpectedTimeout, true);
    assert.equal(report.targetStage, scenario === "release-refused" ? 6 : 7);
  }
  if (scenario === "early-exit") {
    assert.equal(report.readyPublicationObserved, false);
    assert.equal(report.targetAliveAtExpectedTimeout, false);
    assert.equal(report.targetStage, 2);
  }
  if (scenario === "release-early-exit") {
    assert.equal(report.bindingAccepted, true);
    assert.equal(report.releaseRequested, true);
    assert.equal(report.targetAliveAtExpectedTimeout, false);
    assert.equal(report.targetStage, 5);
  }
  process.stdout.write(`PASS supervised evidence ${scenario}\n`);
}

process.stdout.write(
  `PASS ${scenarios.length} same-target supervised evidence cases\n`
);
