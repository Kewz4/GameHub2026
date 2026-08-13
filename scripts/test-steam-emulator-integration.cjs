// Steam emulator integration smoke test — runs inside Electron so the
// bundled service gets the real `app` object.
const { app, protocol } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

// The bundled main index registers privileged schemes at module scope; the
// imported emulator chunk transitively loads it. Mirror the registration first.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "local",
    privileges: {
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      stream: true,
    },
  },
  {
    scheme: "controller-tester",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

const run = async () => {
  const service = await servicePromise;

  console.log("=== 1. emulator tool available? ===");
  console.log(service.isEmulatorToolAvailable());

  console.log("\n=== 2. detectSteamEmulatorStatus on real game folders ===");
  const targets = [
    "C:\\Games\\Marvel's Spider-Man 2",
    "C:\\Games\\EmberKnights",
    "C:\\Games\\Hades II\\Ship",
    "C:\\Games\\Death Must Die -SteamGG.NET",
    "C:\\Games\\The First Berserker Khazan",
  ];
  for (const dir of targets) {
    const detection = service.detectSteamEmulatorStatus(dir);
    console.log(
      `${path.basename(dir)}: ${detection.status} — ${detection.reason}`
    );
  }

  console.log("\n=== 3. ensureEmulatorToolConfig ===");
  const configPath = await service.ensureEmulatorToolConfig();
  console.log("config:", configPath);
  if (configPath) {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    console.log(
      "SteamWebAPIKey set:",
      !!config.EMUGameInfoConfigs?.SteamWebAPIKey
    );
    console.log(
      "UseGoldbergExperimental:",
      config.EMUApplyConfigs?.UseGoldbergExperimental
    );
    console.log("UseLocalSave:", config.EMUApplyConfigs?.UseLocalSave);
  }

  console.log("\n=== 4. ensureGoldbergSaveFolders ===");
  service.ensureGoldbergSaveFolders();
  const appData = app.getPath("appData");
  console.log(
    "GSE Saves exists:",
    fs.existsSync(path.join(appData, "GSE Saves"))
  );
  console.log(
    "Goldberg SteamEmu Saves exists:",
    fs.existsSync(path.join(appData, "Goldberg SteamEmu Saves"))
  );

  console.log("\n=== 5. applySteamEmulator on scratch folder (end-to-end) ===");
  const testDir = path.join(
    app.getPath("temp"),
    `gamehub-emulator-test-${Date.now()}`
  );
  fs.mkdirSync(testDir, { recursive: true });
  fs.writeFileSync(path.join(testDir, "Game.exe"), Buffer.alloc(1024));
  const srcDll = "C:\\Games\\Marvel's Spider-Man 2\\steam_api64.dll.bak";
  if (fs.existsSync(srcDll)) {
    fs.copyFileSync(srcDll, path.join(testDir, "steam_api64.dll"));
  }
  const result = await service.applySteamEmulator(testDir, "2651280");
  console.log("success:", result.success, "exitCode:", result.exitCode);
  if (result.output) {
    console.log(result.output.slice(-1200));
  }
  console.log(
    "emulator applied:",
    fs.existsSync(path.join(testDir, "steam_settings")) ||
      (fs.existsSync(path.join(testDir, "steam_api64.dll")) &&
        fs.statSync(path.join(testDir, "steam_api64.dll")).size >
          20 * 1024 * 1024)
  );
  fs.rmSync(testDir, { recursive: true, force: true });

  app.exit(0);
};

app
  .whenReady()
  .then(run)
  .catch((error) => {
    console.error("TEST FAILED:", error);
    app.exit(1);
  });

// Safety: never hang the shell if app.whenReady stalls.
setTimeout(() => {
  console.error("TIMEOUT: app.whenReady never resolved");
  app.exit(2);
}, 120000);

const repoRoot = path.join(__dirname, "..");
const chunk = fs
  .readdirSync(path.join(repoRoot, "out", "main"))
  .find((f) => f.startsWith("steam-emulator-") && f.endsWith(".js"));
const { pathToFileURL } = require("node:url");
// Start importing immediately — the chunk transitively loads out/main/index.js
// which calls protocol.registerSchemesAsPrivileged at module scope, and that
// must run BEFORE app is ready.
const servicePromise = chunk
  ? import(pathToFileURL(path.join(repoRoot, "out", "main", chunk)).href)
  : Promise.reject(new Error("steam-emulator chunk not found in out/main"));
