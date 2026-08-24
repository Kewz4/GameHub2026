const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const buildRoot = path.resolve(process.argv[2] ?? "");
const supervisorPath = path.join(
  buildRoot,
  "gamehub-overlay-supervisor-qa.exe"
);
const fixturePath = path.join(
  buildRoot,
  "gamehub-overlay-preentry-fixture.exe"
);
const markerPath = path.join(buildRoot, "gamehub-overlay-qa-marker64.dll");
const resultsRoot = path.join(buildRoot, "qa-results");
const fixtureImageName = path.basename(fixturePath);

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const sessionId = (label) => {
  const digest = crypto.createHash("sha256").update(label).digest("hex");
  return `qa_${digest}`;
};

const resultPath = (label) => path.join(resultsRoot, `${label}.json`);

const launchFrame = (label, args = []) => ({
  version: 1,
  type: "launch",
  sessionId: sessionId(label),
  executablePath: fixturePath,
  args: ["--result", resultPath(label), "--", ...args],
  workingDirectory: buildRoot,
  decisionTimeoutMs: 20_000,
});

const identityFrame = (type, suspended, extra = {}) => ({
  version: 1,
  type,
  sessionId: suspended.sessionId,
  pid: suspended.pid,
  creationTicks: suspended.creationTicks,
  canonicalExecutablePath: suspended.canonicalExecutablePath,
  volumeSerial: suspended.volumeSerial,
  fileId: suspended.fileId,
  ...extra,
});

const spawnSupervisor = (extraArgs = [], environment = {}) => {
  const child = childProcess.spawn(
    supervisorPath,
    ["--stdio-json-v1", ...extraArgs],
    {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, ...environment },
    }
  );
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stdoutBuffer = "";
  let stderr = "";
  const frames = [];
  const waiters = [];
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk;
    for (;;) {
      const newline = stdoutBuffer.indexOf("\n");
      if (newline < 0) break;
      let line = stdoutBuffer.slice(0, newline);
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      frames.push(JSON.parse(line));
      while (waiters.length > 0 && frames.length > 0) {
        waiters.shift()(frames.shift());
      }
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const nextFrame = (timeoutMs = 5_000) =>
    new Promise((resolve, reject) => {
      if (frames.length > 0) {
        resolve(frames.shift());
        return;
      }
      const timeout = setTimeout(
        () =>
          reject(new Error(`timed out waiting for frame; stderr=${stderr}`)),
        timeoutMs
      );
      waiters.push((frame) => {
        clearTimeout(timeout);
        resolve(frame);
      });
    });
  const exit = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      resolve({ code, signal, stderr, stdoutBuffer })
    );
  });
  const write = (value) => child.stdin.write(`${JSON.stringify(value)}\n`);
  return { child, nextFrame, exit, write };
};

const assertIdentity = (frame, type, launch) => {
  assert.deepEqual(Object.keys(frame).sort(), [
    "canonicalExecutablePath",
    "creationTicks",
    "fileId",
    "pid",
    "sessionId",
    "type",
    "version",
    "volumeSerial",
  ]);
  assert.equal(frame.version, 1);
  assert.equal(frame.type, type);
  assert.equal(frame.sessionId, launch.sessionId);
  assert.ok(Number.isInteger(frame.pid) && frame.pid > 4);
  assert.match(frame.creationTicks, /^[1-9]\d*$/u);
  assert.match(frame.volumeSerial, /^(?!0{16}$)[0-9A-F]{16}$/u);
  assert.match(frame.fileId, /^(?!0{32}$)[0-9A-F]{32}$/u);
  assert.equal(
    path.normalize(frame.canonicalExecutablePath).toLowerCase(),
    path.normalize(fixturePath).toLowerCase()
  );
};

const processExists = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
};

const waitForFile = async (filePath, timeoutMs = 5_000) => {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) {
      try {
        const text = fs.readFileSync(filePath, "utf8");
        if (text.endsWith("\n")) return JSON.parse(text);
      } catch (error) {
        lastError = error;
      }
    }
    await sleep(20);
  }
  throw new Error(
    `timed out waiting for complete ${filePath}: ${lastError ?? ""}`
  );
};

const waitForProcessExit = async (pid, timeoutMs = 5_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processExists(pid)) return;
    await sleep(20);
  }
  throw new Error(`process ${pid} remained alive`);
};

const fixtureProcessCount = () => {
  const result = childProcess.spawnSync(
    "tasklist.exe",
    ["/FI", `IMAGENAME eq ${fixtureImageName}`, "/FO", "CSV", "/NH"],
    { encoding: "utf8", windowsHide: true, timeout: 5_000 }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const processName = path.parse(fixtureImageName).name.replaceAll("'", "''");
    const fallback = childProcess.spawnSync(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$ErrorActionPreference = 'Stop'; @((Get-Process -Name '${processName}' -ErrorAction SilentlyContinue)).Count`,
      ],
      { encoding: "utf8", windowsHide: true, timeout: 5_000 }
    );
    if (fallback.error) throw fallback.error;
    const fallbackCount = fallback.stdout.trim();
    if (fallback.status === 0 && /^(?:0|[1-9]\d*)$/u.test(fallbackCount)) {
      return Number(fallbackCount);
    }
    throw new Error(
      `process enumeration failed: tasklist ${result.status}: ${result.stderr || result.stdout}; PowerShell ${fallback.status}: ${fallback.stderr || fallback.stdout}`
    );
  }
  let count = 0;
  for (const rawLine of result.stdout.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("INFO:")) continue;
    const match = /^"((?:[^"]|"")*)",/u.exec(line);
    if (!match) throw new Error(`unexpected tasklist output: ${line}`);
    if (
      match[1].replaceAll('""', '"').toLowerCase() !==
      fixtureImageName.toLowerCase()
    ) {
      throw new Error(`tasklist returned unexpected image: ${line}`);
    }
    count += 1;
  }
  return count;
};

const waitForNoFixtureProcesses = async (timeoutMs = 5_000) => {
  const deadline = Date.now() + timeoutMs;
  let count = fixtureProcessCount();
  while (count !== 0 && Date.now() < deadline) {
    await sleep(50);
    count = fixtureProcessCount();
  }
  assert.equal(count, 0, `${fixtureImageName} remained alive`);
};

const cleanResult = (label) => {
  const filePath = resultPath(label);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
};

const testCommitAndQuoting = async () => {
  const label = "commit-quoting";
  cleanResult(label);
  const expectedArguments = [
    "",
    "plain",
    "two words",
    'embedded"quote',
    "trailing\\",
    'slashes\\\\before"quote',
    "Grüße-東京-🎮",
  ];
  const launch = launchFrame(label, expectedArguments);
  const supervisor = spawnSupervisor();
  supervisor.write(launch);
  const suspended = await supervisor.nextFrame();
  assertIdentity(suspended, "suspended", launch);
  assert.equal(
    fs.existsSync(resultPath(label)),
    false,
    "fixture ran while suspended"
  );
  supervisor.write(identityFrame("commit", suspended));
  const resumed = await supervisor.nextFrame();
  assertIdentity(resumed, "resumed", launch);
  assert.deepEqual(resumed, { ...suspended, type: "resumed" });
  const processResult = await supervisor.exit;
  assert.equal(processResult.code, 0, processResult.stderr);
  const fixture = await waitForFile(resultPath(label));
  assert.equal(fixture.entryReached, true);
  assert.equal(fixture.markerLoadedBeforeEntry, true);
  assert.equal(fixture.markerMagic, 0x47485141);
  assert.equal(fixture.pid, suspended.pid);
  assert.equal(fixture.creationTicks, suspended.creationTicks);
  assert.equal(
    path.normalize(fixture.canonicalExecutablePath).toLowerCase(),
    path.normalize(suspended.canonicalExecutablePath).toLowerCase()
  );
  assert.deepEqual(fixture.args, expectedArguments);
};

const testAbort = async () => {
  const label = "abort";
  cleanResult(label);
  const launch = launchFrame(label, ["must-not-run"]);
  const supervisor = spawnSupervisor();
  supervisor.write(launch);
  const suspended = await supervisor.nextFrame();
  supervisor.write(identityFrame("abort", suspended, { reason: "qa-abort" }));
  const aborted = await supervisor.nextFrame();
  assertIdentity(aborted, "aborted", launch);
  assert.deepEqual(aborted, { ...suspended, type: "aborted" });
  assert.equal((await supervisor.exit).code, 0);
  await waitForProcessExit(suspended.pid);
  assert.equal(fs.existsSync(resultPath(label)), false);
};

const testPinnedFilesRejectReplacement = async () => {
  const label = "pinned-file-share";
  cleanResult(label);
  const launch = launchFrame(label, ["must-not-run"]);
  const supervisor = spawnSupervisor();
  supervisor.write(launch);
  const suspended = await supervisor.nextFrame();

  for (const pinnedPath of [fixturePath, markerPath]) {
    let writableHandle;
    let openError;
    try {
      writableHandle = fs.openSync(pinnedPath, "r+");
    } catch (error) {
      openError = error;
    } finally {
      if (writableHandle !== undefined) fs.closeSync(writableHandle);
    }
    assert.ok(
      openError &&
        typeof openError === "object" &&
        ["EBUSY", "EACCES", "EPERM"].includes(openError.code),
      `${path.basename(pinnedPath)} unexpectedly allowed writable access`
    );
  }

  supervisor.write(identityFrame("abort", suspended, { reason: "qa-abort" }));
  const aborted = await supervisor.nextFrame();
  assertIdentity(aborted, "aborted", launch);
  assert.equal((await supervisor.exit).code, 0);
  await waitForProcessExit(suspended.pid);
  assert.equal(fs.existsSync(resultPath(label)), false);
};

const testEof = async () => {
  const label = "eof";
  cleanResult(label);
  const launch = launchFrame(label, ["must-not-run"]);
  const supervisor = spawnSupervisor();
  supervisor.write(launch);
  const suspended = await supervisor.nextFrame();
  supervisor.child.stdin.end();
  const error = await supervisor.nextFrame();
  assert.equal(error.type, "error");
  assert.equal(error.sessionId, launch.sessionId);
  assert.equal(error.stage, "decision");
  assert.equal(error.message, "decision-eof");
  assert.notEqual((await supervisor.exit).code, 0);
  await waitForProcessExit(suspended.pid);
  assert.equal(fs.existsSync(resultPath(label)), false);
};

const testTimeout = async () => {
  const label = "timeout";
  cleanResult(label);
  const launch = launchFrame(label, ["must-not-run"]);
  const supervisor = spawnSupervisor();
  supervisor.write(launch);
  const suspended = await supervisor.nextFrame();
  const error = await supervisor.nextFrame(25_000);
  assert.equal(error.type, "error");
  assert.equal(error.sessionId, launch.sessionId);
  assert.equal(error.stage, "decision");
  assert.equal(error.message, "decision-timeout");
  assert.notEqual((await supervisor.exit).code, 0);
  await waitForProcessExit(suspended.pid);
  assert.equal(fs.existsSync(resultPath(label)), false);
};

const testIdentityAndOneShot = async () => {
  const mutations = [
    [
      "ticks",
      (suspended) => ({
        creationTicks: `${BigInt(suspended.creationTicks) + 1n}`,
      }),
    ],
    [
      "volume",
      (suspended) => ({
        volumeSerial:
          suspended.volumeSerial === "FFFFFFFFFFFFFFFF"
            ? "FFFFFFFFFFFFFFFE"
            : "FFFFFFFFFFFFFFFF",
      }),
    ],
    [
      "file",
      (suspended) => ({
        fileId:
          suspended.fileId === "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"
            ? "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE"
            : "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF",
      }),
    ],
  ];
  for (const [suffix, mutate] of mutations) {
    const label = `identity-mismatch-${suffix}`;
    cleanResult(label);
    const launch = launchFrame(label, ["must-not-run"]);
    const supervisor = spawnSupervisor();
    supervisor.write(launch);
    const suspended = await supervisor.nextFrame();
    supervisor.write({
      ...identityFrame("commit", suspended),
      ...mutate(suspended),
    });
    const error = await supervisor.nextFrame();
    assert.equal(error.type, "error");
    assert.equal(error.stage, "decision");
    assert.match(error.message, /decision|identity|invalid/u);
    assert.notEqual((await supervisor.exit).code, 0);
    await waitForProcessExit(suspended.pid);
    assert.equal(fs.existsSync(resultPath(label)), false);
  }
};

const testFixtureBoundary = async () => {
  const label = "fixture-boundary";
  cleanResult(label);
  const launch = launchFrame(label);
  // An existing adjacent executable proves rejection is an identity boundary,
  // not merely an existence check.
  launch.executablePath = supervisorPath;
  const supervisor = spawnSupervisor();
  supervisor.write(launch);
  const error = await supervisor.nextFrame();
  assert.equal(error.type, "error");
  assert.equal(error.sessionId, launch.sessionId);
  assert.equal(error.stage, "launch");
  assert.notEqual((await supervisor.exit).code, 0);
  assert.equal(fs.existsSync(resultPath(label)), false);
};

const testArgvBoundary = async () => {
  const supervisor = spawnSupervisor([fixturePath]);
  const error = await supervisor.nextFrame();
  assert.equal(error.type, "error");
  assert.equal(error.stage, "protocol");
  assert.equal(error.message, "argv-not-allowed");
  assert.notEqual((await supervisor.exit).code, 0);
};

const testDecisionTimeoutBoundary = async () => {
  for (const [suffix, timeoutMs] of [
    ["low", 19_999],
    ["high", 20_001],
  ]) {
    const label = `deadline-${suffix}`;
    cleanResult(label);
    const launch = launchFrame(label, ["must-not-run"]);
    launch.decisionTimeoutMs = timeoutMs;
    const supervisor = spawnSupervisor();
    supervisor.write(launch);
    const error = await supervisor.nextFrame();
    assert.equal(error.type, "error");
    assert.equal(error.sessionId, launch.sessionId);
    assert.equal(error.stage, "protocol");
    assert.equal(error.message, "invalid launch object values");
    assert.notEqual((await supervisor.exit).code, 0);
    assert.equal(fs.existsSync(resultPath(label)), false);
  }
  assert.equal(fixtureProcessCount(), 0);
};

const testSupervisorCrashKillsSuspendedChild = async () => {
  const label = "job-crash";
  cleanResult(label);
  const launch = launchFrame(label, ["must-not-run"]);
  const supervisor = spawnSupervisor();
  supervisor.write(launch);
  const suspended = await supervisor.nextFrame();
  supervisor.child.kill();
  await supervisor.exit;
  await waitForProcessExit(suspended.pid);
  assert.equal(fs.existsSync(resultPath(label)), false);
};

const testAtomicJobCrashWindow = async () => {
  const label = "job-atomic-crash";
  cleanResult(label);
  assert.equal(
    fixtureProcessCount(),
    0,
    `atomic crash test requires no pre-existing ${fixtureImageName}`
  );
  const launch = launchFrame(label, ["must-not-run"]);
  const supervisor = spawnSupervisor([], {
    GAMEHUB_QA_CRASH_AFTER_CREATE: "1",
  });
  supervisor.write(launch);
  const processResult = await supervisor.exit;
  assert.notEqual(processResult.code, 0);
  // No identity event is available by design: the injected hard crash occurs
  // immediately after CreateProcess. This serialized suite owns the fixture's
  // unique image name, so tasklist can prove that the child did not survive.
  assert.equal(fs.existsSync(resultPath(label)), false);
  await waitForNoFixtureProcesses();
  assert.equal(fs.existsSync(resultPath(label)), false);
};

const tests = [
  ["commit + Windows quoting + loader-order marker", testCommitAndQuoting],
  ["abort kills never-started fixture", testAbort],
  [
    "target and marker stay write/delete pinned",
    testPinnedFilesRejectReplacement,
  ],
  ["EOF kills never-started fixture", testEof],
  ["timeout kills never-started fixture", testTimeout],
  ["full identity mismatch fails closed", testIdentityAndOneShot],
  ["fixture-only canonical boundary", testFixtureBoundary],
  ["argv cannot carry target path", testArgvBoundary],
  [
    "fixed decision deadline rejects adjacent values",
    testDecisionTimeoutBoundary,
  ],
  ["supervisor crash closes armed job", testSupervisorCrashKillsSuspendedChild],
  [
    "atomic job association closes post-CreateProcess crash window",
    testAtomicJobCrashWindow,
  ],
];

(async () => {
  assert.equal(
    fixtureProcessCount(),
    0,
    `suite requires no pre-existing ${fixtureImageName}`
  );
  for (const [name, test] of tests) {
    await test();
    process.stdout.write(`PASS ${name}\n`);
  }
  await waitForNoFixtureProcesses();
  process.stdout.write(
    `PASS ${tests.length} overlay QA supervisor acceptance cases\n`
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
