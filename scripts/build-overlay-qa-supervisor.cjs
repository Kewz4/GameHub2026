const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const vendorRoot = path.join(projectRoot, "third_party", "microsoft-detours");
const supervisorRoot = path.join(
  projectRoot,
  "native",
  "gamehub-overlay-supervisor"
);
const fixtureRoot = path.join(projectRoot, "native", "overlay-fixtures");
const buildRoot = path.join(supervisorRoot, "target", "qa-x64");
const objectRoot = path.join(buildRoot, "obj");
const resultsRoot = path.join(buildRoot, "qa-results");
const supervisorPath = path.join(
  buildRoot,
  "gamehub-overlay-supervisor-qa.exe"
);
const fixturePath = path.join(
  buildRoot,
  "gamehub-overlay-preentry-fixture.exe"
);
const markerPath = path.join(buildRoot, "gamehub-overlay-qa-marker64.dll");
const detoursLibraryPath = path.join(buildRoot, "detours.lib");

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

const run = (command, args, options = {}) =>
  childProcess.execFileSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: "inherit",
    ...options,
  });

const capture = (command, args, options = {}) =>
  childProcess.execFileSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });

const sha256 = (filePath) =>
  crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");

const verifyDetoursVendor = () => {
  const metadata = JSON.parse(
    fs.readFileSync(path.join(vendorRoot, "UPSTREAM.json"), "utf8")
  );
  assert.equal(
    metadata.commit,
    "e4bfd6b03e50de46b47abfbd1e46b384f0c5f833",
    "unexpected Detours commit"
  );
  assert.equal(
    metadata.tree,
    "600b4d42793cbefd55070c43b8d4b3d4a569cb8c",
    "unexpected Detours tree"
  );
  assert.equal(metadata.license, "MIT", "unexpected Detours license metadata");

  const manifestPath = path.join(vendorRoot, "SOURCE_MANIFEST.sha256");
  assert.ok(fs.existsSync(manifestPath), "Detours source manifest is missing");
  const entries = new Map(
    fs
      .readFileSync(manifestPath, "utf8")
      .trim()
      .split(/\r?\n/u)
      .map((line) => {
        const match = /^([a-f\d]{64}) {2}(.+)$/u.exec(line);
        assert.ok(match, `malformed Detours manifest line: ${line}`);
        return [match[2], match[1]];
      })
  );
  assert.deepEqual(
    [...entries.keys()].sort(),
    [...exactVendorFiles].sort(),
    "Detours allowlist differs from its source manifest"
  );
  for (const [relativePath, expectedHash] of entries) {
    const absolutePath = path.join(vendorRoot, ...relativePath.split("/"));
    assert.ok(
      fs.existsSync(absolutePath),
      `missing Detours file: ${relativePath}`
    );
    assert.equal(
      sha256(absolutePath),
      expectedHash,
      `Detours hash mismatch: ${relativePath}`
    );
  }
  const license = fs.readFileSync(path.join(vendorRoot, "LICENSE.md"), "utf8");
  assert.match(license, /MIT License/u, "Detours MIT license text is missing");
  assert.match(
    license,
    /Copyright \(c\) Microsoft Corporation/u,
    "Detours copyright notice is missing"
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

const commandQuote = (value) => `"${String(value).replaceAll('"', '""')}"`;

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

const compileObject = (
  vcvars,
  source,
  object,
  includes = [],
  extra = [],
  languageStandard = "/std:c++20"
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
    "/DNOMINMAX",
    "/D_WIN32_WINNT=0x0A00",
    "/MT",
    "/O2",
    ...includes.map((include) => `/I${include}`),
    ...extra,
    `/Fo${object}`,
    source,
  ]);
};

const build = () => {
  if (process.platform !== "win32") {
    throw new Error("The overlay QA supervisor spike is Windows-only.");
  }
  verifyDetoursVendor();
  if (process.argv.includes("--verify-only")) {
    process.stdout.write(
      "Verified pinned Microsoft Detours source and MIT license.\n"
    );
    return;
  }

  const vcvars = findVisualStudio();
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
      // Match the official Detours 4.0.1 Makefile, which predates and does not
      // request modern standard-mode jump-initialization diagnostics.
      null
    );
  }
  runMsvc(vcvars, "lib.exe", [
    "/nologo",
    `/OUT:${detoursLibraryPath}`,
    ...detoursObjects,
  ]);

  const markerObject = path.join(objectRoot, "qa-marker.obj");
  compileObject(
    vcvars,
    path.join(fixtureRoot, "marker", "marker.cpp"),
    markerObject,
    [path.join(vendorRoot, "src")]
  );
  runMsvc(vcvars, "link.exe", [
    "/nologo",
    "/DLL",
    `/OUT:${markerPath}`,
    `/DEF:${path.join(fixtureRoot, "marker", "marker.def")}`,
    markerObject,
    detoursLibraryPath,
    "kernel32.lib",
  ]);

  const fixtureObject = path.join(objectRoot, "preentry-fixture.obj");
  compileObject(
    vcvars,
    path.join(fixtureRoot, "preentry", "preentry_fixture.cpp"),
    fixtureObject,
    [],
    ["/GS-", "/Oi-"]
  );
  runMsvc(vcvars, "link.exe", [
    "/nologo",
    "/NODEFAULTLIB",
    "/ENTRY:GameHubFixtureEntry",
    "/SUBSYSTEM:CONSOLE,6.02",
    `/OUT:${fixturePath}`,
    fixtureObject,
    // The custom entry point bypasses CRT startup. MSVC can still lower an
    // optimized byte loop to memcpy, so link only the static runtime objects
    // the linker actually selects; no dynamic runtime sidecar is introduced.
    "libcmt.lib",
    "libvcruntime.lib",
    "libucrt.lib",
    "kernel32.lib",
    "shell32.lib",
  ]);

  const protocolObject = path.join(objectRoot, "supervisor-protocol.obj");
  const supervisorObject = path.join(objectRoot, "supervisor-main.obj");
  compileObject(
    vcvars,
    path.join(supervisorRoot, "src", "protocol.cpp"),
    protocolObject,
    [path.join(vendorRoot, "src"), path.join(supervisorRoot, "src")]
  );
  compileObject(
    vcvars,
    path.join(supervisorRoot, "src", "main.cpp"),
    supervisorObject,
    [path.join(vendorRoot, "src"), path.join(supervisorRoot, "src")],
    ["/DGAMEHUB_OVERLAY_SUPERVISOR_ACCEPTANCE_FAULTS"]
  );
  runMsvc(vcvars, "link.exe", [
    "/nologo",
    `/OUT:${supervisorPath}`,
    supervisorObject,
    protocolObject,
    detoursLibraryPath,
    "kernel32.lib",
  ]);

  run(process.execPath, [
    path.join(fixtureRoot, "tests", "supervisor-acceptance.cjs"),
    buildRoot,
  ]);
};

try {
  build();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
