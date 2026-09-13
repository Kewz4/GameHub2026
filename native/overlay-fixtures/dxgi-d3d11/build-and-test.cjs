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
  "dxgi-d3d11-qa-x64"
);
const objectRoot = path.join(buildRoot, "obj");
const reuseDetours = process.env.GAMEHUB_DXGI_QA_REUSE_DETOURS === "1";
const expectedDetoursManifestPaths = [
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

const quote = (value) => `"${String(value).replaceAll('"', '""')}"`;
const runMsvc = (vcvars, command, args, capture = false) => {
  const script = `call "${vcvars}" >nul && ${command} ${args
    .map(quote)
    .join(" ")}`;
  return childProcess.execFileSync(
    process.env.ComSpec ?? "cmd.exe",
    ["/d", "/c", script],
    {
      cwd: projectRoot,
      encoding: capture ? "utf8" : undefined,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
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
  const installation = childProcess
    .execFileSync(
      vswhere,
      [
        "-latest",
        "-products",
        "*",
        "-requires",
        "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
        "-property",
        "installationPath",
      ],
      { encoding: "utf8" }
    )
    .trim();
  const vcvars = path.join(
    installation,
    "VC",
    "Auxiliary",
    "Build",
    "vcvars64.bat"
  );
  assert.ok(fs.existsSync(vcvars), "Visual C++ x64 tools are unavailable");
  return vcvars;
};

const verifyPinnedDetours = () => {
  const metadata = JSON.parse(
    fs.readFileSync(path.join(vendorRoot, "UPSTREAM.json"), "utf8")
  );
  assert.equal(metadata.commit, "e4bfd6b03e50de46b47abfbd1e46b384f0c5f833");
  assert.equal(metadata.tree, "600b4d42793cbefd55070c43b8d4b3d4a569cb8c");
  assert.equal(metadata.license, "MIT");
  const manifest = fs
    .readFileSync(path.join(vendorRoot, "SOURCE_MANIFEST.sha256"), "utf8")
    .trim()
    .split(/\r?\n/u);
  const manifestPaths = [];
  for (const line of manifest) {
    const match = /^([a-f\d]{64}) {2}(.+)$/u.exec(line);
    assert.ok(match, `malformed Detours manifest: ${line}`);
    manifestPaths.push(match[2]);
    const file = path.join(vendorRoot, ...match[2].split("/"));
    const hash = crypto
      .createHash("sha256")
      .update(fs.readFileSync(file))
      .digest("hex");
    assert.equal(hash, match[1], `Detours provenance mismatch: ${match[2]}`);
  }
  assert.deepEqual(
    manifestPaths,
    expectedDetoursManifestPaths,
    "Detours provenance manifest has an unexpected file set or order"
  );
};

const compile = (
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
    "/O2",
    "/MT",
    "/DUNICODE",
    "/D_UNICODE",
    "/DWIN32_LEAN_AND_MEAN",
    "/D_WIN32_WINNT=0x0A00",
    ...includes.map((include) => `/I${include}`),
    ...extra,
    `/Fo${object}`,
    source,
  ]);
};

const assertX64 = (vcvars, binary) => {
  const headers = runMsvc(vcvars, "dumpbin.exe", ["/headers", binary], true);
  assert.match(headers, /^\s+8664 machine \(x64\)\s*$/mu);
};

const build = () => {
  assert.equal(process.platform, "win32", "DXGI/D3D11 QA is Windows-only");
  verifyPinnedDetours();
  const vcvars = findVisualStudio();
  const exactBuildRoot = path.join(
    projectRoot,
    "native",
    "overlay-fixtures",
    "target",
    "dxgi-d3d11-qa-x64"
  );
  assert.equal(path.resolve(buildRoot), path.resolve(exactBuildRoot));
  if (!reuseDetours) fs.rmSync(buildRoot, { recursive: true, force: true });
  fs.mkdirSync(objectRoot, { recursive: true });

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
    assert.ok(fs.existsSync(detoursLibrary), "reused Detours library missing");
  } else {
    detoursSources.forEach((source, index) =>
      compile(
        vcvars,
        path.join(vendorRoot, "src", source),
        detoursObjects[index],
        [path.join(vendorRoot, "src")],
        ["/Zl", "/Gy"],
        null
      )
    );
    runMsvc(vcvars, "lib.exe", [
      "/nologo",
      `/OUT:${detoursLibrary}`,
      ...detoursObjects,
    ]);
  }

  const fixtureObject = path.join(objectRoot, "dxgi-d3d11-fixture.obj");
  const hostStateObject = path.join(objectRoot, "dxgi-d3d11-host-state.obj");
  const fixtureExe = path.join(
    buildRoot,
    "gamehub-overlay-qa-dxgi-d3d11-fixture.exe"
  );
  compile(vcvars, path.join(fixtureRoot, "fixture.cpp"), fixtureObject, [
    fixtureRoot,
  ]);
  compile(vcvars, path.join(fixtureRoot, "host_state.cpp"), hostStateObject, [
    fixtureRoot,
  ]);
  runMsvc(vcvars, "link.exe", [
    "/nologo",
    "/INCREMENTAL:NO",
    "/OPT:NOICF",
    `/OUT:${fixtureExe}`,
    `/DEF:${path.join(fixtureRoot, "fixture.def")}`,
    fixtureObject,
    hostStateObject,
    "d3d11.lib",
    "dxgi.lib",
    "d3dcompiler.lib",
    "user32.lib",
    "shell32.lib",
    "kernel32.lib",
  ]);

  const bootstrapObject = path.join(objectRoot, "dxgi-d3d11-bootstrap.obj");
  const bootstrapDll = path.join(
    buildRoot,
    "gamehub-overlay-qa-dxgi-d3d11-bootstrap64.dll"
  );
  const bootstrapLib = path.join(
    buildRoot,
    "gamehub-overlay-qa-dxgi-d3d11-bootstrap64.lib"
  );
  compile(vcvars, path.join(fixtureRoot, "bootstrap.cpp"), bootstrapObject, [
    fixtureRoot,
    path.join(vendorRoot, "src"),
  ]);
  runMsvc(vcvars, "link.exe", [
    "/nologo",
    "/DLL",
    "/INCREMENTAL:NO",
    "/OPT:NOICF",
    `/OUT:${bootstrapDll}`,
    `/IMPLIB:${bootstrapLib}`,
    `/DEF:${path.join(fixtureRoot, "bootstrap.def")}`,
    bootstrapObject,
    detoursLibrary,
    "d3d11.lib",
    "dxgi.lib",
    "d3dcompiler.lib",
    "user32.lib",
    "synchronization.lib",
    "kernel32.lib",
  ]);

  const launcherObject = path.join(objectRoot, "dxgi-d3d11-launcher.obj");
  const launcherExe = path.join(
    buildRoot,
    "gamehub-overlay-qa-dxgi-d3d11-launcher.exe"
  );
  compile(vcvars, path.join(fixtureRoot, "launcher.cpp"), launcherObject, [
    path.join(vendorRoot, "src"),
  ]);
  runMsvc(vcvars, "link.exe", [
    "/nologo",
    "/INCREMENTAL:NO",
    "/OPT:NOICF",
    `/OUT:${launcherExe}`,
    launcherObject,
    detoursLibrary,
    "kernel32.lib",
  ]);

  [fixtureExe, bootstrapDll, launcherExe].forEach((binary) =>
    assertX64(vcvars, binary)
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
