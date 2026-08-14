const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const fixtureRoot = __dirname;
const projectRoot = path.resolve(fixtureRoot, "..", "..", "..");
const vendorRoot = path.join(projectRoot, "third_party", "microsoft-detours");
const buildRoot = path.join(
  projectRoot,
  "native",
  "overlay-fixtures",
  "target",
  "xinput-qa-x64"
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

const captureMsvc = (vcvars, command, args) => {
  const script = `call "${vcvars}" >nul && ${command} ${args
    .map(commandQuote)
    .join(" ")}`;
  return childProcess.execFileSync(
    process.env.ComSpec ?? "cmd.exe",
    ["/d", "/c", script],
    {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsVerbatimArguments: true,
    }
  );
};

const runMsvc = (vcvars, command, args) => {
  const script = `call "${vcvars}" >nul && ${command} ${args
    .map(commandQuote)
    .join(" ")}`;
  childProcess.execFileSync(
    process.env.ComSpec ?? "cmd.exe",
    ["/d", "/c", script],
    {
      cwd: projectRoot,
      stdio: "inherit",
      windowsVerbatimArguments: true,
    }
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
  assert.ok(fs.existsSync(vcvars), `vcvars64.bat was not found at ${vcvars}`);
  return vcvars;
};

const compileObject = (
  vcvars,
  source,
  object,
  includes = [],
  extra = [],
  languageStandard = "/std:c++20",
  optimization = "/O2"
) => {
  runMsvc(vcvars, "cl.exe", [
    "/nologo",
    "/c",
    ...(languageStandard ? [languageStandard] : []),
    "/EHsc",
    "/W4",
    "/WX",
    "/DUNICODE",
    "/D_UNICODE",
    "/DWIN32_LEAN_AND_MEAN",
    "/D_WIN32_WINNT=0x0A00",
    "/MT",
    ...(optimization ? [optimization] : []),
    ...includes.map((include) => `/I${include}`),
    ...extra,
    `/Fo${object}`,
    source,
  ]);
};

const linkDll = (
  vcvars,
  output,
  importLibrary,
  definition,
  objects,
  libraries
) => {
  runMsvc(vcvars, "link.exe", [
    "/nologo",
    "/DLL",
    "/INCREMENTAL:NO",
    "/OPT:NOICF",
    `/OUT:${output}`,
    `/IMPLIB:${importLibrary}`,
    `/DEF:${definition}`,
    ...objects,
    ...libraries,
  ]);
};

const verifyPinnedDetours = () => {
  const metadata = JSON.parse(
    fs.readFileSync(path.join(vendorRoot, "UPSTREAM.json"), "utf8")
  );
  assert.equal(metadata.commit, "e4bfd6b03e50de46b47abfbd1e46b384f0c5f833");
  assert.equal(metadata.tree, "600b4d42793cbefd55070c43b8d4b3d4a569cb8c");
  assert.equal(metadata.license, "MIT");
  const exactVendorFiles = [
    "LICENSE.md",
    "system.mak",
    "src/Makefile",
    "src/creatwth.cpp",
    "src/detours.cpp",
    "src/detours.h",
    "src/detver.h",
    "src/disasm.cpp",
    "src/disolarm.cpp",
    "src/disolarm64.cpp",
    "src/disolia64.cpp",
    "src/disolx64.cpp",
    "src/disolx86.cpp",
    "src/image.cpp",
    "src/modules.cpp",
    "src/uimports.cpp",
  ];
  const manifest = fs
    .readFileSync(path.join(vendorRoot, "SOURCE_MANIFEST.sha256"), "utf8")
    .trim()
    .split(/\r?\n/u)
    .map((line) => {
      const match = /^([a-f\d]{64}) {2}(.+)$/u.exec(line);
      assert.ok(match, `malformed Detours manifest line: ${line}`);
      return [match[2], match[1]];
    });
  assert.deepEqual(
    manifest.map(([relativePath]) => relativePath).sort(),
    [...exactVendorFiles].sort(),
    "Detours manifest does not match the exact source allowlist"
  );
  for (const [relativePath, expectedHash] of manifest) {
    const absolutePath = path.join(vendorRoot, ...relativePath.split("/"));
    assert.ok(fs.existsSync(absolutePath), `missing Detours: ${relativePath}`);
    const actualHash = crypto
      .createHash("sha256")
      .update(fs.readFileSync(absolutePath))
      .digest("hex");
    assert.equal(actualHash, expectedHash, `Detours hash: ${relativePath}`);
  }
};

const parseDumpbinExports = (output) => {
  const exports = [];
  for (const line of output.split(/\r?\n/u)) {
    const named = /^\s+(\d+)\s+(\d+)\s+([0-9A-F]+)\s+([A-Za-z_]\w*)\s*$/u.exec(
      line
    );
    if (named) {
      exports.push({ ordinal: Number(named[1]), name: named[4] });
      continue;
    }
    const noname = /^\s+(\d+)\s+([0-9A-F]+)\s+\[NONAME\]\s*$/u.exec(line);
    if (noname) {
      exports.push({ ordinal: Number(noname[1]), name: "[NONAME]" });
    }
  }
  return exports.sort((left, right) => left.ordinal - right.ordinal);
};

const build = () => {
  assert.equal(
    process.platform,
    "win32",
    "synthetic XInput QA is Windows-only"
  );
  verifyPinnedDetours();
  const vcvars = findVisualStudio();
  const expectedBuildRoot = path.join(
    projectRoot,
    "native",
    "overlay-fixtures",
    "target",
    "xinput-qa-x64"
  );
  assert.equal(
    path.resolve(buildRoot),
    path.resolve(expectedBuildRoot),
    "refusing to clean an unexpected build directory"
  );
  fs.rmSync(buildRoot, { recursive: true, force: true });
  fs.mkdirSync(objectRoot, { recursive: true });
  fs.mkdirSync(resultsRoot, { recursive: true });

  const detoursSources = [
    "detours.cpp",
    "modules.cpp",
    "disasm.cpp",
    "image.cpp",
    "creatwth.cpp",
    "disolx86.cpp",
    "disolx64.cpp",
    "disolia64.cpp",
    "disolarm.cpp",
    "disolarm64.cpp",
  ];
  const detoursObjects = detoursSources.map((source) =>
    path.join(objectRoot, `detours-${path.basename(source, ".cpp")}.obj`)
  );
  for (let index = 0; index < detoursSources.length; index += 1) {
    compileObject(
      vcvars,
      path.join(vendorRoot, "src", detoursSources[index]),
      detoursObjects[index],
      [path.join(vendorRoot, "src")],
      ["/Zl", "/Gy"],
      null
    );
  }
  const detoursLibrary = path.join(buildRoot, "detours.lib");
  runMsvc(vcvars, "lib.exe", [
    "/nologo",
    `/OUT:${detoursLibrary}`,
    ...detoursObjects,
  ]);

  const providerObject = path.join(objectRoot, "xinput-provider.obj");
  const providerDll = path.join(buildRoot, "xinput1_3.dll");
  const providerLibrary = path.join(buildRoot, "xinput1_3.lib");
  compileObject(
    vcvars,
    path.join(fixtureRoot, "provider.cpp"),
    providerObject,
    [fixtureRoot],
    ["/DGAMEHUB_XINPUT_PROVIDER_DEFINITIONS", "/GS-", "/Oi-"]
  );
  linkDll(
    vcvars,
    providerDll,
    providerLibrary,
    path.join(fixtureRoot, "provider.def"),
    [providerObject],
    ["kernel32.lib"]
  );
  const providerExports = captureMsvc(vcvars, "dumpbin.exe", [
    "/exports",
    providerDll,
  ]);
  assert.deepEqual(parseDumpbinExports(providerExports), [
    { ordinal: 2, name: "XInputGetState" },
    { ordinal: 3, name: "XInputSetState" },
    { ordinal: 5, name: "XInputEnable" },
    { ordinal: 8, name: "XInputGetKeystroke" },
    { ordinal: 100, name: "[NONAME]" },
    { ordinal: 1001, name: "GameHubSyntheticXInputGetProviderSnapshot" },
    { ordinal: 1002, name: "GameHubSyntheticXInputSetPhysical" },
    { ordinal: 1003, name: "GameHubSyntheticXInputQueueKeystrokes" },
  ]);
  assert.doesNotMatch(providerExports, /XInputGetStateEx/iu);

  const cacheObject = path.join(objectRoot, "xinput-cache.obj");
  const cacheDll = path.join(buildRoot, "gamehub-xinput-qa-cache64.dll");
  const cacheLibrary = path.join(buildRoot, "gamehub-xinput-qa-cache64.lib");
  compileObject(
    vcvars,
    path.join(fixtureRoot, "cache.cpp"),
    cacheObject,
    [fixtureRoot],
    ["/DGAMEHUB_XINPUT_CACHE_EXPORTS", "/GS-", "/Oi-"]
  );
  linkDll(
    vcvars,
    cacheDll,
    cacheLibrary,
    path.join(fixtureRoot, "cache.def"),
    [cacheObject],
    [providerLibrary, "kernel32.lib"]
  );
  const cacheImports = captureMsvc(vcvars, "dumpbin.exe", [
    "/imports",
    cacheDll,
  ]);
  assert.match(cacheImports, /xinput1_3\.dll/iu);
  for (const ordinal of [2, 3, 5, 8, 1001, 1002, 1003]) {
    assert.match(
      cacheImports,
      new RegExp(`^\\s+Ordinal\\s+${ordinal}\\s*$`, "mu")
    );
  }
  assert.doesNotMatch(cacheImports, /^\s+Ordinal\s+100\s*$/mu);
  assert.doesNotMatch(cacheImports, /XInputGetStateEx/u);

  const bootstrapObject = path.join(objectRoot, "xinput-bootstrap.obj");
  const bootstrapDll = path.join(
    buildRoot,
    "gamehub-overlay-qa-xinput-bootstrap64.dll"
  );
  const bootstrapLibrary = path.join(
    buildRoot,
    "gamehub-overlay-qa-xinput-bootstrap64.lib"
  );
  compileObject(
    vcvars,
    path.join(fixtureRoot, "bootstrap.cpp"),
    bootstrapObject,
    [fixtureRoot, path.join(vendorRoot, "src")],
    ["/GS-", "/Oi-"]
  );
  linkDll(
    vcvars,
    bootstrapDll,
    bootstrapLibrary,
    path.join(fixtureRoot, "bootstrap.def"),
    [bootstrapObject],
    [cacheLibrary, detoursLibrary, "kernel32.lib"]
  );
  const bootstrapImports = captureMsvc(vcvars, "dumpbin.exe", [
    "/imports",
    bootstrapDll,
  ]);
  assert.match(bootstrapImports, /gamehub-xinput-qa-cache64\.dll/iu);
  assert.match(bootstrapImports, /GameHubXInputQaGetCacheSnapshot/u);

  const fixtureObject = path.join(objectRoot, "xinput-fixture.obj");
  const fixtureExecutable = path.join(
    buildRoot,
    "gamehub-overlay-qa-xinput-fixture.exe"
  );
  compileObject(
    vcvars,
    path.join(fixtureRoot, "fixture.cpp"),
    fixtureObject,
    [fixtureRoot],
    ["/GS-", "/Oi-"],
    "/std:c++20",
    "/Od"
  );
  runMsvc(vcvars, "link.exe", [
    "/nologo",
    "/INCREMENTAL:NO",
    "/OPT:NOICF",
    `/OUT:${fixtureExecutable}`,
    fixtureObject,
    cacheLibrary,
    "kernel32.lib",
    "shell32.lib",
  ]);

  const launcherObject = path.join(objectRoot, "xinput-launcher.obj");
  const launcherExecutable = path.join(
    buildRoot,
    "gamehub-overlay-qa-xinput-launcher.exe"
  );
  compileObject(
    vcvars,
    path.join(fixtureRoot, "launcher.cpp"),
    launcherObject,
    [path.join(vendorRoot, "src")]
  );
  runMsvc(vcvars, "link.exe", [
    "/nologo",
    "/INCREMENTAL:NO",
    "/OPT:NOICF",
    `/OUT:${launcherExecutable}`,
    launcherObject,
    detoursLibrary,
    "kernel32.lib",
  ]);

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
