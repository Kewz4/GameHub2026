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
  "directinput-qa-x64"
);
const objectRoot = path.join(buildRoot, "obj");
const resultsRoot = path.join(buildRoot, "qa-results");
const reuseDetours = process.env.GAMEHUB_DI_QA_REUSE_DETOURS === "1";

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
  const license = fs.readFileSync(path.join(vendorRoot, "LICENSE.md"), "utf8");
  assert.match(license, /MIT License/u);
  assert.match(license, /Microsoft Corporation/u);
};

const parseDumpbinExports = (output) => {
  const exports = [];
  for (const line of output.split(/\r?\n/u)) {
    const match =
      /^\s+(\d+)\s+[0-9A-F]+\s+[0-9A-F]+\s+([A-Za-z_]\w*)\s*$/u.exec(line);
    if (match) exports.push({ ordinal: Number(match[1]), name: match[2] });
  }
  return exports.sort((left, right) => left.ordinal - right.ordinal);
};

const parseDumpbinImports = (output) => {
  const imports = new Map();
  let moduleName = null;
  for (const line of output.split(/\r?\n/u)) {
    const moduleMatch = /^\s{4}([A-Za-z\d_.-]+\.dll)\s*$/iu.exec(line);
    if (moduleMatch) {
      moduleName = moduleMatch[1];
      imports.set(moduleName, []);
      continue;
    }
    if (moduleName === null) continue;
    const ordinalMatch = /^\s+Ordinal\s+(\d+)\s*$/u.exec(line);
    if (ordinalMatch) {
      imports.get(moduleName).push(`#${ordinalMatch[1]}`);
      continue;
    }
    const nameMatch = /^\s+[0-9A-F]+\s+([A-Za-z_]\w*)\s*$/u.exec(line);
    if (nameMatch) imports.get(moduleName).push(nameMatch[1]);
  }
  return Object.fromEntries(
    [...imports.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([module, symbols]) => [module, symbols.sort()])
  );
};

const assertExactImports = (
  vcvars,
  binary,
  expectedModules,
  expectedGraphHash,
  expectedPrivateImports = {}
) => {
  const output = captureMsvc(vcvars, "dumpbin.exe", ["/imports", binary]);
  const imports = parseDumpbinImports(output);
  assert.deepEqual(
    Object.keys(imports),
    expectedModules,
    `${path.basename(binary)} dependency allowlist changed`
  );
  for (const [module, symbols] of Object.entries(expectedPrivateImports)) {
    assert.deepEqual(
      imports[module],
      [...symbols].sort(),
      `${path.basename(binary)} imports from ${module} changed`
    );
  }
  const actualGraphHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(imports))
    .digest("hex");
  assert.equal(
    actualGraphHash,
    expectedGraphHash,
    `${path.basename(binary)} exact import graph changed: ${JSON.stringify(imports)}`
  );
};

const assertX64 = (vcvars, binary) => {
  const headers = captureMsvc(vcvars, "dumpbin.exe", ["/headers", binary]);
  assert.match(
    headers,
    /^\s+8664 machine \(x64\)\s*$/mu,
    `${binary} is not x64`
  );
};

const build = () => {
  assert.equal(
    process.platform,
    "win32",
    "synthetic DirectInput QA is Windows-only"
  );
  verifyPinnedDetours();
  const vcvars = findVisualStudio();
  const expectedBuildRoot = path.join(
    projectRoot,
    "native",
    "overlay-fixtures",
    "target",
    "directinput-qa-x64"
  );
  assert.equal(path.resolve(buildRoot), path.resolve(expectedBuildRoot));
  if (!reuseDetours) fs.rmSync(buildRoot, { recursive: true, force: true });
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
  const detoursLibrary = path.join(buildRoot, "detours.lib");
  if (reuseDetours) {
    assert.ok(
      fs.existsSync(detoursLibrary),
      "reused Detours library is missing"
    );
  } else {
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
    runMsvc(vcvars, "lib.exe", [
      "/nologo",
      `/OUT:${detoursLibrary}`,
      ...detoursObjects,
    ]);
  }

  const providerObject = path.join(objectRoot, "directinput-provider.obj");
  const providerDll = path.join(buildRoot, "dinput8.dll");
  const providerLibrary = path.join(buildRoot, "dinput8.lib");
  compileObject(
    vcvars,
    path.join(fixtureRoot, "provider.cpp"),
    providerObject,
    [fixtureRoot],
    ["/GS-", "/Oi-"]
  );
  linkDll(
    vcvars,
    providerDll,
    providerLibrary,
    path.join(fixtureRoot, "provider.def"),
    [providerObject],
    ["dxguid.lib", "kernel32.lib"]
  );
  assertX64(vcvars, providerDll);
  const providerExports = captureMsvc(vcvars, "dumpbin.exe", [
    "/exports",
    providerDll,
  ]);
  assert.deepEqual(parseDumpbinExports(providerExports), [
    { ordinal: 1, name: "DirectInput8Create" },
    { ordinal: 2, name: "c_dfDIJoystick" },
    { ordinal: 3, name: "c_dfDIJoystick2" },
    { ordinal: 4, name: "c_dfDIKeyboard" },
    { ordinal: 5, name: "c_dfDIMouse" },
    { ordinal: 6, name: "c_dfDIMouse2" },
    { ordinal: 1001, name: "GameHubSyntheticDiGetProviderSnapshot" },
    { ordinal: 1002, name: "GameHubSyntheticDiSetPhysical" },
    { ordinal: 1003, name: "GameHubSyntheticDiSetActionMapResult" },
    { ordinal: 1004, name: "GameHubSyntheticDiSetRange" },
    { ordinal: 1005, name: "GameHubSyntheticDiGetFormat" },
  ]);
  assertExactImports(
    vcvars,
    providerDll,
    ["KERNEL32.dll"],
    "88da1bf054d1ea4e443c832015cca84852e1773a8719ef49de05cce3699cf157"
  );

  const cacheObject = path.join(objectRoot, "directinput-cache.obj");
  const cacheDll = path.join(buildRoot, "gamehub-directinput-qa-cache64.dll");
  const cacheLibrary = path.join(
    buildRoot,
    "gamehub-directinput-qa-cache64.lib"
  );
  compileObject(
    vcvars,
    path.join(fixtureRoot, "cache.cpp"),
    cacheObject,
    [fixtureRoot],
    ["/GS-", "/Oi-"]
  );
  linkDll(
    vcvars,
    cacheDll,
    cacheLibrary,
    path.join(fixtureRoot, "cache.def"),
    [cacheObject],
    [providerLibrary, "dxguid.lib", "kernel32.lib", "user32.lib"]
  );
  assertX64(vcvars, cacheDll);
  const cacheExports = captureMsvc(vcvars, "dumpbin.exe", [
    "/exports",
    cacheDll,
  ]);
  assert.deepEqual(parseDumpbinExports(cacheExports), [
    { ordinal: 1, name: "GameHubDiQaGetCacheSnapshot" },
    { ordinal: 2, name: "GameHubDiQaGetDeviceA" },
    { ordinal: 3, name: "GameHubDiQaGetDeviceW" },
    { ordinal: 4, name: "GameHubDiQaGetProviderSnapshot" },
    { ordinal: 5, name: "GameHubDiQaGetRootA" },
    { ordinal: 6, name: "GameHubDiQaGetRootW" },
    { ordinal: 7, name: "GameHubDiQaReleaseAll" },
    { ordinal: 8, name: "GameHubDiQaSetActionMapResult" },
    { ordinal: 9, name: "GameHubDiQaSetPhysical" },
    { ordinal: 10, name: "GameHubDiQaSetRange" },
    {
      ordinal: 11,
      name: "GameHubDiQaTamperPollSlotForNegativeControl",
    },
  ]);
  assertExactImports(
    vcvars,
    cacheDll,
    ["dinput8.dll", "KERNEL32.dll", "USER32.dll"],
    "83c19da372a58dff3bad7d978395f2387776e5289352c97bb1abc3ee25593750",
    { "dinput8.dll": ["#1001", "#1002", "#1003", "#1004", "#1005"] }
  );

  const bootstrapObject = path.join(objectRoot, "directinput-bootstrap.obj");
  const bootstrapDll = path.join(
    buildRoot,
    "gamehub-overlay-qa-directinput-bootstrap64.dll"
  );
  const bootstrapLibrary = path.join(
    buildRoot,
    "gamehub-overlay-qa-directinput-bootstrap64.lib"
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
    [
      cacheLibrary,
      providerLibrary,
      detoursLibrary,
      "dxguid.lib",
      "kernel32.lib",
    ]
  );
  assertX64(vcvars, bootstrapDll);
  const bootstrapExports = captureMsvc(vcvars, "dumpbin.exe", [
    "/exports",
    bootstrapDll,
  ]);
  assert.deepEqual(parseDumpbinExports(bootstrapExports), [
    { ordinal: 1, name: "GameHubDiQaAttachLateForNegativeControl" },
    { ordinal: 2, name: "GameHubDiQaBeginBlock" },
    { ordinal: 3, name: "GameHubDiQaDetach" },
    { ordinal: 4, name: "GameHubDiQaGetBootstrapSnapshot" },
    { ordinal: 5, name: "GameHubDiQaInvalidateTopology" },
    { ordinal: 6, name: "GameHubDiQaObserveRelease" },
    { ordinal: 7, name: "GameHubDiQaRearm" },
    { ordinal: 8, name: "GameHubDiQaRequestClose" },
    { ordinal: 9, name: "GameHubDiQaRevalidate" },
    { ordinal: 10, name: "GameHubDiQaSetHotCallPauseForStress" },
  ]);
  assertExactImports(
    vcvars,
    bootstrapDll,
    ["dinput8.dll", "gamehub-directinput-qa-cache64.dll", "KERNEL32.dll"],
    "9d74d89ceb75b6af11e71e5b989fe8a524917b52de469267c93ba0d9bf666297",
    {
      "dinput8.dll": ["#1005"],
      "gamehub-directinput-qa-cache64.dll": [
        "GameHubDiQaGetCacheSnapshot",
        "GameHubDiQaGetDeviceA",
        "GameHubDiQaGetDeviceW",
        "GameHubDiQaGetProviderSnapshot",
        "GameHubDiQaGetRootA",
        "GameHubDiQaGetRootW",
      ],
    }
  );

  const fixtureObject = path.join(objectRoot, "directinput-fixture.obj");
  const fixtureExecutable = path.join(
    buildRoot,
    "gamehub-overlay-qa-directinput-fixture.exe"
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
    providerLibrary,
    "dxguid.lib",
    "kernel32.lib",
    "user32.lib",
  ]);
  assertX64(vcvars, fixtureExecutable);
  assertExactImports(
    vcvars,
    fixtureExecutable,
    ["gamehub-directinput-qa-cache64.dll", "KERNEL32.dll", "USER32.dll"],
    "71e5a499bdbd1dd389e4fac2187319fa082de5df800721cf37abb2eba355629c",
    {
      "gamehub-directinput-qa-cache64.dll": [
        "GameHubDiQaGetCacheSnapshot",
        "GameHubDiQaGetDeviceA",
        "GameHubDiQaGetDeviceW",
        "GameHubDiQaGetProviderSnapshot",
        "GameHubDiQaGetRootA",
        "GameHubDiQaGetRootW",
        "GameHubDiQaReleaseAll",
        "GameHubDiQaSetActionMapResult",
        "GameHubDiQaSetPhysical",
        "GameHubDiQaTamperPollSlotForNegativeControl",
      ],
    }
  );

  const launcherObject = path.join(objectRoot, "directinput-launcher.obj");
  const launcherExecutable = path.join(
    buildRoot,
    "gamehub-overlay-qa-directinput-launcher.exe"
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
  assertX64(vcvars, launcherExecutable);
  assertExactImports(
    vcvars,
    launcherExecutable,
    ["KERNEL32.dll"],
    "0d9c83bcfa61d5506b64d560d0dce501aed36dd1b34c80508fb7be779a3987e3"
  );

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
