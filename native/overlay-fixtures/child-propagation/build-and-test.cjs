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
  "child-propagation-qa-x64"
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
  return childProcess.execFileSync(
    process.env.ComSpec ?? "cmd.exe",
    ["/d", "/c", script],
    {
      cwd: projectRoot,
      encoding: captureOutput ? "utf8" : undefined,
      stdio: captureOutput ? ["ignore", "pipe", "pipe"] : "inherit",
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

const compile = (
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

const linkDll = (vcvars, output, library, definition, objects, libraries) => {
  runMsvc(vcvars, "link.exe", [
    "/nologo",
    "/DLL",
    "/INCREMENTAL:NO",
    `/OUT:${output}`,
    `/IMPLIB:${library}`,
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
  const manifest = fs
    .readFileSync(path.join(vendorRoot, "SOURCE_MANIFEST.sha256"), "utf8")
    .trim()
    .split(/\r?\n/u)
    .map((line) => {
      const match = /^([a-f\d]{64}) {2}(.+)$/u.exec(line);
      assert.ok(match, `malformed Detours manifest line: ${line}`);
      return [match[2], match[1]];
    });
  assert.equal(manifest.length, 16, "unexpected Detours manifest cardinality");
  for (const [relativePath, expectedHash] of manifest) {
    const absolutePath = path.join(vendorRoot, ...relativePath.split("/"));
    assert.ok(
      fs.existsSync(absolutePath),
      `missing Detours file: ${relativePath}`
    );
    const actualHash = crypto
      .createHash("sha256")
      .update(fs.readFileSync(absolutePath))
      .digest("hex");
    assert.equal(
      actualHash,
      expectedHash,
      `Detours hash mismatch: ${relativePath}`
    );
  }
};

const build = () => {
  assert.equal(
    process.platform,
    "win32",
    "child propagation QA is Windows-only"
  );
  verifyPinnedDetours();
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
  detoursSources.forEach((source, index) => {
    compile(
      vcvars,
      path.join(vendorRoot, "src", source),
      detoursObjects[index],
      [path.join(vendorRoot, "src")],
      ["/Zl", "/Gy"],
      null
    );
  });
  const detoursLibrary = path.join(buildRoot, "detours.lib");
  runMsvc(vcvars, "lib.exe", [
    "/nologo",
    `/OUT:${detoursLibrary}`,
    ...detoursObjects,
  ]);

  const cacheObject = path.join(objectRoot, "child-cache.obj");
  const cacheDll = path.join(buildRoot, "gamehub-overlay-qa-child-cache64.dll");
  const cacheLibrary = path.join(
    buildRoot,
    "gamehub-overlay-qa-child-cache64.lib"
  );
  compile(
    vcvars,
    path.join(fixtureRoot, "cache.cpp"),
    cacheObject,
    [fixtureRoot],
    ["/DGAMEHUB_CHILD_QA_CACHE_EXPORTS"]
  );
  linkDll(
    vcvars,
    cacheDll,
    cacheLibrary,
    path.join(fixtureRoot, "cache.def"),
    [cacheObject],
    ["kernel32.lib"]
  );

  const markerObject = path.join(objectRoot, "child-marker.obj");
  const markerDll = path.join(
    buildRoot,
    "gamehub-overlay-qa-child-marker64.dll"
  );
  const markerLibrary = path.join(
    buildRoot,
    "gamehub-overlay-qa-child-marker64.lib"
  );
  compile(vcvars, path.join(fixtureRoot, "child-marker.cpp"), markerObject, [
    fixtureRoot,
    path.join(vendorRoot, "src"),
  ]);
  linkDll(
    vcvars,
    markerDll,
    markerLibrary,
    path.join(fixtureRoot, "child-marker.def"),
    [markerObject],
    [detoursLibrary, "kernel32.lib"]
  );

  const rendererObject = path.join(objectRoot, "child-renderer.obj");
  const renderer = path.join(
    buildRoot,
    "gamehub-overlay-qa-child-renderer.exe"
  );
  compile(
    vcvars,
    path.join(fixtureRoot, "renderer.cpp"),
    rendererObject,
    [fixtureRoot],
    ["/GS-"],
    "/std:c++20",
    "/Od"
  );
  runMsvc(vcvars, "link.exe", [
    "/nologo",
    "/NODEFAULTLIB",
    "/INCREMENTAL:NO",
    "/ENTRY:GameHubChildRendererEntry",
    "/SUBSYSTEM:CONSOLE,6.02",
    `/OUT:${renderer}`,
    rendererObject,
    "kernel32.lib",
    "shell32.lib",
    "libvcruntime.lib",
  ]);
  fs.copyFileSync(
    renderer,
    path.join(buildRoot, "gamehub-overlay-qa-child-unknown.exe")
  );

  const bootstrapObject = path.join(objectRoot, "parent-bootstrap.obj");
  const bootstrapDll = path.join(
    buildRoot,
    "gamehub-overlay-qa-child-parent-bootstrap64.dll"
  );
  const bootstrapLibrary = path.join(
    buildRoot,
    "gamehub-overlay-qa-child-parent-bootstrap64.lib"
  );
  compile(
    vcvars,
    path.join(fixtureRoot, "parent-bootstrap.cpp"),
    bootstrapObject,
    [fixtureRoot, path.join(vendorRoot, "src")]
  );
  linkDll(
    vcvars,
    bootstrapDll,
    bootstrapLibrary,
    path.join(fixtureRoot, "parent-bootstrap.def"),
    [bootstrapObject],
    [cacheLibrary, detoursLibrary, "kernel32.lib"]
  );

  const parentObject = path.join(objectRoot, "parent-fixture.obj");
  const parent = path.join(buildRoot, "gamehub-overlay-qa-child-parent.exe");
  compile(vcvars, path.join(fixtureRoot, "parent-fixture.cpp"), parentObject, [
    fixtureRoot,
  ]);
  runMsvc(vcvars, "link.exe", [
    "/nologo",
    "/INCREMENTAL:NO",
    `/OUT:${parent}`,
    parentObject,
    cacheLibrary,
    "kernel32.lib",
    "shell32.lib",
  ]);

  const launcherObject = path.join(objectRoot, "child-launcher.obj");
  const launcher = path.join(
    buildRoot,
    "gamehub-overlay-qa-child-launcher.exe"
  );
  compile(vcvars, path.join(fixtureRoot, "launcher.cpp"), launcherObject, [
    fixtureRoot,
    path.join(vendorRoot, "src"),
  ]);
  runMsvc(vcvars, "link.exe", [
    "/nologo",
    "/INCREMENTAL:NO",
    `/OUT:${launcher}`,
    launcherObject,
    detoursLibrary,
    "kernel32.lib",
  ]);

  const cacheImports = runMsvc(
    vcvars,
    "dumpbin.exe",
    ["/imports", cacheDll],
    true
  );
  assert.match(cacheImports, /CreateProcessW/u);
  assert.match(cacheImports, /CreateProcessA/u);
  const parentImports = runMsvc(
    vcvars,
    "dumpbin.exe",
    ["/imports", parent],
    true
  );
  assert.match(parentImports, /gamehub-overlay-qa-child-cache64\.dll/iu);
  assert.match(parentImports, /GameHubChildQaCallCachedCreateProcessW/u);
  assert.match(parentImports, /GameHubChildQaCallCachedCreateProcessA/u);
  const bootstrapImports = runMsvc(
    vcvars,
    "dumpbin.exe",
    ["/imports", bootstrapDll],
    true
  );
  assert.match(bootstrapImports, /gamehub-overlay-qa-child-cache64\.dll/iu);
  assert.match(bootstrapImports, /GameHubChildQaCachedCreateProcessW/u);
  assert.match(bootstrapImports, /GameHubChildQaCachedCreateProcessA/u);

  childProcess.execFileSync(
    process.execPath,
    [path.join(fixtureRoot, "test.cjs"), buildRoot],
    {
      cwd: projectRoot,
      stdio: "inherit",
    }
  );
};

try {
  build();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
