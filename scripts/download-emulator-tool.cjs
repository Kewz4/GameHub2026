/**
 * Download the SteamAutoCrack Goldberg emulator bundle and build its CLI, then
 * assemble everything into ./emulator-tool before the Electron build.
 * Run via: node scripts/download-emulator-tool.cjs
 * Or add to package.json build hook (build:win).
 *
 * The SteamAutoCrack release zip only ships the GUI exe, so this script:
 *   1. Downloads the latest SteamAutoCrack.zip release
 *   2. Extracts the Goldberg/ emulator bundle (regular + experimental) and
 *      the TEMP/ working dir into ./emulator-tool
 *   3. Shallow-clones Steam-auto-crack, patches a System.CommandLine API
 *      incompatibility in the CLI Program.cs, and publishes a self-contained
 *      win-x86 CLI into ./emulator-tool
 *   4. Writes a default config.json (the app patches in the user's
 *      SteamWebAPIKey + experimental emulator at runtime)
 *
 * emulator-tool/ is picked up by electron-builder via the win.extraResources
 * entry in electron-builder.yml.
 */

const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");

const OUT_DIR = path.join(__dirname, "..", "emulator-tool");
const REPO_URL = "https://github.com/SteamAutoCracks/Steam-auto-crack.git";
const RELEASE_ZIP_URL =
  "https://github.com/SteamAutoCracks/Steam-auto-crack/releases/latest/download/SteamAutoCrack.zip";

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const get = (u) => {
      https
        .get(
          u,
          { headers: { "User-Agent": "gamehub-build-script" } },
          (res) => {
            if (
              res.statusCode >= 300 &&
              res.statusCode < 400 &&
              res.headers.location
            ) {
              file.close();
              get(res.headers.location);
              return;
            }
            if (res.statusCode !== 200) {
              file.close();
              reject(new Error(`HTTP ${res.statusCode} for ${u}`));
              return;
            }
            res.pipe(file);
            file.on("finish", () => file.close(resolve));
          }
        )
        .on("error", reject);
    };
    get(url);
  });
}

async function downloadReleaseBundle() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sac-release-"));
  const zipPath = path.join(tmp, "SteamAutoCrack.zip");
  console.log("Downloading SteamAutoCrack release zip…");
  await download(RELEASE_ZIP_URL, zipPath);

  const extractDir = path.join(tmp, "extracted");
  ensureDir(extractDir);

  if (process.platform === "win32") {
    console.log("Extracting release zip (PowerShell)…");
    execFileSync("powershell", [
      "-NoProfile",
      "-Command",
      `Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force`,
    ]);
  } else {
    console.log("Extracting release zip (tar)…");
    execFileSync("tar", ["-xf", zipPath, "-C", extractDir]);
  }

  ensureDir(OUT_DIR);
  for (const folder of ["Goldberg", "TEMP"]) {
    const src = path.join(extractDir, folder);
    const dest = path.join(OUT_DIR, folder);
    if (!fs.existsSync(src)) continue;
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(src, dest, { recursive: true });
    console.log(`✓ ${folder} → emulator-tool/${folder}`);
  }

  fs.rmSync(tmp, { recursive: true, force: true });
}

async function buildCli() {
  // The release zip doesn't ship the CLI — build it from source.
  // Requires the .NET SDK (net10.0-windows target).
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sac-src-"));
  console.log("Cloning Steam-auto-crack source…");
  execFileSync("git", ["clone", "--depth", "1", REPO_URL, tmp], {
    stdio: "inherit",
  });

  const programPath = path.join(tmp, "SteamAutoCrack.CLI", "Program.cs");
  let program = fs.readFileSync(programPath, "utf8");

  // System.CommandLine 2.x no longer accepts a description as the second
  // positional constructor argument (it's treated as an alias and crashes
  // on whitespace). Move descriptions into object initializers.
  const fixes = [
    [
      /var DebugOption = new Option<bool>\(\s*"--debug",\s*"Enable Debug Log\."\);/,
      'var DebugOption = new Option<bool>("--debug") { Description = "Enable Debug Log." };',
    ],
    [
      /var ForceDownloadOption = new Option<bool>\(\s*"--force",\s*"Force \(re\)download\."\s*\);/,
      'var ForceDownloadOption = new Option<bool>("--force") { Description = "Force (re)download." };',
    ],
    [
      /var configpathOption = new Option<FileInfo\?>\(\s*"--path",\s*"Changes default config path\."\);/,
      'var configpathOption = new Option<FileInfo?>("--path") { Description = "Changes default config path." };',
    ],
  ];
  for (const [pattern, fixed] of fixes) {
    if (pattern.test(program)) {
      program = program.replace(pattern, fixed);
      console.log(`✓ patched CLI constructor in Program.cs`);
    } else {
      console.warn(
        `! CLI constructor patch pattern not found (upstream changed?)`
      );
    }
  }
  fs.writeFileSync(programPath, program);

  console.log("Publishing self-contained SteamAutoCrack.CLI (win-x86)…");
  execFileSync(
    "dotnet",
    [
      "publish",
      path.join(tmp, "SteamAutoCrack.CLI", "SteamAutoCrack.CLI.csproj"),
      "-c",
      "Release",
      "-r",
      "win-x86",
      "--self-contained",
      "true",
      "-o",
      path.join(tmp, "cli-build"),
    ],
    { stdio: "inherit" }
  );

  ensureDir(OUT_DIR);
  fs.cpSync(path.join(tmp, "cli-build"), OUT_DIR, {
    recursive: true,
    force: true,
  });
  console.log("✓ SteamAutoCrack.CLI → emulator-tool/");

  fs.rmSync(tmp, { recursive: true, force: true });
}

async function main() {
  ensureDir(OUT_DIR);
  await downloadReleaseBundle();
  await buildCli();
  console.log("Steam emulator bundle ready in", OUT_DIR);
}

main().catch((err) => {
  console.error("Error assembling emulator-tool:", err);
  process.exit(1);
});
