const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

// One fail-closed gate for Windows and Linux. Do not let a later successful
// command hide an earlier test failure (notably in a PowerShell CI step).
const suites = [
  "test:spotify",
  "test:r2-credentials",
  "test:downloads",
  "test:upstream-parity",
  "test:python-rpc",
  "test:steam-emulator",
  "test:overlay",
  "test:recorder",
  "test:cloud-sync",
  "test:cloud-save-v2",
  "test:features",
  "test:maintenance",
  "test:linux-parity",
];
const results = [];
for (const suite of suites) {
  const started = Date.now();
  const result = spawnSync(
    process.platform === "win32" ? "yarn.cmd" : "yarn",
    [suite],
    {
      stdio: "inherit",
      shell: process.platform === "win32",
      timeout: 900_000,
    }
  );
  results.push({
    suite,
    exitCode: result.status,
    error: result.error?.message ?? null,
    durationMs: Date.now() - started,
  });
}
const output = path.join(
  "artifacts",
  "linux-parity",
  `tests-${process.platform}.json`
);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(
  output,
  JSON.stringify(
    { platform: process.platform, arch: process.arch, results },
    null,
    2
  )
);
const failed = results.filter(
  (result) => result.exitCode !== 0 || result.error
);
console.log(
  `Parity suites: ${results.length - failed.length}/${results.length} passed. Report: ${output}`
);
process.exitCode = failed.length ? 1 : 0;
