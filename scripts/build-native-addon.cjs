const fs = require("node:fs");
const path = require("node:path");
const util = require("node:util");
const childProcess = require("node:child_process");

const execFile = util.promisify(childProcess.execFile);

const projectRoot = process.cwd();
const manifestPath = path.join(
  projectRoot,
  "native",
  "hydra-native",
  "Cargo.toml"
);
const cargoTargetDir = path.join(
  projectRoot,
  "native",
  "hydra-native",
  "target"
);
const outputDir = path.join(projectRoot, "hydra-native");
const outputNodePath = path.join(outputDir, "hydra-native.node");
const outputPresentMonBridgePath = path.join(
  outputDir,
  "presentmon-bridge.exe"
);
// Injected into the game to gate XInput / GetAsyncKeyState / raw input while
// the overlay is open. A separate crate because Cargo allows only one [lib]
// per package, but it shares hydra-native's target directory so CI's Rust
// cache and electron-builder's `!native/hydra-native/target` exclusion both
// keep covering it.
const inputHookManifestPath = path.join(
  projectRoot,
  "native",
  "gamehub-inputhook",
  "Cargo.toml"
);
const outputInputHookPath = path.join(outputDir, "gamehub-inputhook.dll");
// Elevated helper: registered once as a Scheduled Task at RunLevel Highest so
// injection and PresentMon get an administrator token without prompting on
// every game launch.
const outputBrokerPath = path.join(outputDir, "gamehub-overlay-broker.exe");

const sourceLibraryNameByPlatform = {
  linux: "libhydra_native.so",
  darwin: "libhydra_native.dylib",
  win32: "hydra_native.dll",
};

const run = async (command, args, options = {}) => {
  await execFile(command, args, {
    cwd: projectRoot,
    maxBuffer: 1024 * 1024 * 10,
    ...options,
  });
};

const ensureDepsResolvableOnLinux = async () => {
  if (process.platform !== "linux") return;

  const { stdout } = await execFile("ldd", [outputNodePath], {
    cwd: projectRoot,
    maxBuffer: 1024 * 1024 * 10,
  });

  if (stdout.includes("not found")) {
    throw new Error(
      `Unresolved dynamic dependencies found for ${outputNodePath}\n${stdout}`
    );
  }
};

const copySidecarLibrariesOnWindows = async (sourceDirectory) => {
  if (process.platform !== "win32") return;

  const candidateDlls = [
    "libgcc_s_seh-1.dll",
    "libstdc++-6.dll",
    "libwinpthread-1.dll",
    "vcruntime140.dll",
    "vcruntime140_1.dll",
    "msvcp140.dll",
  ];

  for (const dll of candidateDlls) {
    const sourcePath = path.join(sourceDirectory, dll);
    if (!fs.existsSync(sourcePath)) continue;
    const targetPath = path.join(outputDir, dll);
    if (!fs.existsSync(targetPath)) {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
};

const build = async () => {
  const sourceLibraryName = sourceLibraryNameByPlatform[process.platform];

  if (!sourceLibraryName) {
    throw new Error(
      `Unsupported platform for native build: ${process.platform}`
    );
  }

  console.log("Building hydra-native Rust addon...");

  const cargoArgs = [
    "build",
    "--release",
    "--manifest-path",
    manifestPath,
    "--target-dir",
    cargoTargetDir,
  ];

  await run("cargo", cargoArgs);

  const sourceLibraryPath = path.join(
    cargoTargetDir,
    "release",
    sourceLibraryName
  );

  if (!fs.existsSync(sourceLibraryPath)) {
    throw new Error(`Native build output not found at ${sourceLibraryPath}`);
  }

  fs.mkdirSync(outputDir, { recursive: true });
  fs.copyFileSync(sourceLibraryPath, outputNodePath);

  if (process.platform === "win32") {
    const sourcePresentMonBridgePath = path.join(
      cargoTargetDir,
      "release",
      "presentmon-bridge.exe"
    );
    if (!fs.existsSync(sourcePresentMonBridgePath)) {
      throw new Error(
        `PresentMon bridge build output not found at ${sourcePresentMonBridgePath}`
      );
    }
    fs.copyFileSync(sourcePresentMonBridgePath, outputPresentMonBridgePath);

    console.log("Building gamehub-inputhook (overlay input gate)...");
    await run("cargo", [
      "build",
      "--release",
      "--manifest-path",
      inputHookManifestPath,
      "--target-dir",
      cargoTargetDir,
    ]);
    const sourceInputHookPath = path.join(
      cargoTargetDir,
      "release",
      "gamehub_inputhook.dll"
    );
    if (!fs.existsSync(sourceInputHookPath)) {
      throw new Error(
        `Input hook build output not found at ${sourceInputHookPath}`
      );
    }
    fs.copyFileSync(sourceInputHookPath, outputInputHookPath);

    const sourceBrokerPath = path.join(
      cargoTargetDir,
      "release",
      "gamehub-overlay-broker.exe"
    );
    if (!fs.existsSync(sourceBrokerPath)) {
      throw new Error(
        `Overlay broker build output not found at ${sourceBrokerPath}`
      );
    }
    fs.copyFileSync(sourceBrokerPath, outputBrokerPath);
  }

  await copySidecarLibrariesOnWindows(path.dirname(sourceLibraryPath));
  await ensureDepsResolvableOnLinux();

  console.log(`Hydra native addon ready at ${outputNodePath}`);
};

build().catch((error) => {
  console.error(error);
  process.exit(1);
});
