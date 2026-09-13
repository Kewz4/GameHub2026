const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const fixtureRoot = __dirname;
const projectRoot = path.resolve(fixtureRoot, "..", "..", "..");
const buildRoot = path.join(
  projectRoot,
  "native",
  "overlay-fixtures",
  "target",
  "secure-channel-qa-x64"
);
const objectRoot = path.join(buildRoot, "obj");
const resultsRoot = path.join(buildRoot, "qa-results");

const commandQuote = (value) => `"${String(value).replaceAll('"', '""')}"`;

const capture = (command, args) =>
  childProcess.execFileSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

const runMsvc = (vcvars, command, args, captureOutput = false) => {
  const script = `call "${vcvars}" >nul && ${command} ${args
    .map(commandQuote)
    .join(" ")}`;
  const options = {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: captureOutput ? ["ignore", "pipe", "pipe"] : "inherit",
    windowsVerbatimArguments: true,
  };
  return childProcess.execFileSync(
    process.env.ComSpec ?? "cmd.exe",
    ["/d", "/c", script],
    options
  );
};

const findVisualStudio = () => {
  const vswhere = path.join(
    process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
    "Microsoft Visual Studio",
    "Installer",
    "vswhere.exe"
  );
  assert.ok(fs.existsSync(vswhere), "vswhere.exe was not found");
  const installationPath = capture(vswhere, [
    "-latest",
    "-products",
    "*",
    "-requires",
    "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
    "-property",
    "installationPath",
  ]).trim();
  assert.ok(installationPath, "Visual C++ x64 Build Tools are not installed");
  const vcvars = path.join(
    installationPath,
    "VC",
    "Auxiliary",
    "Build",
    "vcvars64.bat"
  );
  assert.ok(fs.existsSync(vcvars), `vcvars64.bat not found at ${vcvars}`);
  return vcvars;
};

const compile = (vcvars, source, object) => {
  runMsvc(vcvars, "cl.exe", [
    "/nologo",
    "/c",
    "/std:c++20",
    "/EHsc",
    "/W4",
    "/WX",
    "/sdl",
    "/guard:cf",
    "/DUNICODE",
    "/D_UNICODE",
    "/DWIN32_LEAN_AND_MEAN",
    "/DNOMINMAX",
    "/D_WIN32_WINNT=0x0A00",
    "/MT",
    "/O2",
    `/I${fixtureRoot}`,
    `/Fo${object}`,
    source,
  ]);
};

const link = (vcvars, output, objects) => {
  runMsvc(vcvars, "link.exe", [
    "/nologo",
    "/INCREMENTAL:NO",
    "/DYNAMICBASE",
    "/NXCOMPAT",
    "/HIGHENTROPYVA",
    "/guard:cf",
    `/OUT:${output}`,
    ...objects,
    "kernel32.lib",
    "advapi32.lib",
    "bcrypt.lib",
  ]);
};

const build = () => {
  assert.equal(
    process.platform,
    "win32",
    "secure-channel synthetic QA is Windows-only"
  );
  const expectedBuildRoot = path.join(
    projectRoot,
    "native",
    "overlay-fixtures",
    "target",
    "secure-channel-qa-x64"
  );
  assert.equal(
    path.resolve(buildRoot),
    path.resolve(expectedBuildRoot),
    "refusing to clean an unexpected build directory"
  );
  const vcvars = findVisualStudio();
  fs.rmSync(buildRoot, { recursive: true, force: true });
  fs.mkdirSync(objectRoot, { recursive: true });
  fs.mkdirSync(resultsRoot, { recursive: true });

  const commonObject = path.join(objectRoot, "secure-common.obj");
  const hostObject = path.join(objectRoot, "secure-host.obj");
  const readerObject = path.join(objectRoot, "secure-reader.obj");
  const attackerObject = path.join(objectRoot, "secure-attacker.obj");
  compile(vcvars, path.join(fixtureRoot, "common.cpp"), commonObject);
  compile(vcvars, path.join(fixtureRoot, "host.cpp"), hostObject);
  compile(vcvars, path.join(fixtureRoot, "reader.cpp"), readerObject);
  compile(vcvars, path.join(fixtureRoot, "attacker.cpp"), attackerObject);

  const host = path.join(buildRoot, "gamehub-overlay-qa-secure-channel.exe");
  const reader = path.join(buildRoot, "gamehub-overlay-qa-secure-reader.exe");
  const attacker = path.join(
    buildRoot,
    "gamehub-overlay-qa-secure-attacker.exe"
  );
  link(vcvars, host, [hostObject, commonObject]);
  link(vcvars, reader, [readerObject, commonObject]);
  link(vcvars, attacker, [attackerObject, commonObject]);

  for (const executable of [host, reader, attacker]) {
    const headers = runMsvc(
      vcvars,
      "dumpbin.exe",
      ["/headers", executable],
      true
    );
    assert.match(headers, /machine \(x64\)/iu, `${executable} must be x64`);
    assert.match(headers, /Dynamic base/iu, `${executable} must use ASLR`);
    assert.match(headers, /NX compatible/iu, `${executable} must use NX`);
    assert.match(headers, /Control Flow Guard/iu, `${executable} must use CFG`);
  }

  childProcess.execFileSync(
    process.execPath,
    [path.join(fixtureRoot, "test.cjs"), buildRoot],
    { cwd: projectRoot, stdio: "inherit" }
  );
};

try {
  build();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
