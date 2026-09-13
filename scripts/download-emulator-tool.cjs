/**
 * Download the SteamAutoCrack Goldberg emulator bundle and build its CLI, then
 * assemble everything into ./emulator-tool before the Electron build.
 * Run via: node scripts/download-emulator-tool.cjs
 * Or add to package.json build hook (build:win).
 *
 * The SteamAutoCrack release zip only ships the GUI exe, so this script:
 *   1. Downloads and verifies a pinned SteamAutoCrack.zip release
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
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");

const FINAL_OUT_DIR = path.join(__dirname, "..", "emulator-tool");
let assemblyOutDir = FINAL_OUT_DIR;
const REPO_URL = "https://github.com/SteamAutoCracks/Steam-auto-crack.git";
const UPSTREAM_VERSION = "3.5.0.6";
const UPSTREAM_COMMIT = "f687bc287b762b0843052122ad56196dde2ad9a3";
const RELEASE_ZIP_SHA256 =
  "3ec9f826cdff35f0a69560c47350c15622559c670edec542f594e89b9f047d58";
const RELEASE_ZIP_URL = `https://github.com/SteamAutoCracks/Steam-auto-crack/releases/download/${UPSTREAM_VERSION}/SteamAutoCrack.zip`;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sha256File(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const partial = `${dest}.partial-${process.pid}`;
    let settled = false;
    fs.rmSync(partial, { force: true });

    const fail = (error) => {
      if (settled) return;
      settled = true;
      fs.rmSync(partial, { force: true });
      reject(error);
    };
    const get = (rawUrl, redirectsLeft) => {
      const request = https.get(
        rawUrl,
        { headers: { "User-Agent": "gamehub-build-script" } },
        (res) => {
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400 && res.headers.location) {
            res.resume();
            if (redirectsLeft <= 0) {
              fail(new Error(`Too many redirects downloading ${url}`));
              return;
            }
            get(new URL(res.headers.location, rawUrl).href, redirectsLeft - 1);
            return;
          }
          if (status !== 200) {
            res.resume();
            fail(new Error(`HTTP ${status} for ${rawUrl}`));
            return;
          }

          const file = fs.createWriteStream(partial, { flags: "wx" });
          file.once("error", (error) => {
            res.destroy();
            fail(error);
          });
          res.once("error", (error) => {
            file.destroy();
            fail(error);
          });
          file.once("finish", () => {
            file.close((error) => {
              if (error) return fail(error);
              if (settled) return;
              try {
                fs.rmSync(dest, { force: true });
                fs.renameSync(partial, dest);
                settled = true;
                resolve();
              } catch (publishError) {
                fail(publishError);
              }
            });
          });
          res.pipe(file);
        }
      );
      request.once("error", fail);
    };
    get(url, 5);
  });
}

async function downloadReleaseBundle() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sac-release-"));
  const zipPath = path.join(tmp, "SteamAutoCrack.zip");
  console.log("Downloading SteamAutoCrack release zip…");
  await download(RELEASE_ZIP_URL, zipPath);
  const archiveHash = sha256File(zipPath);
  if (archiveHash !== RELEASE_ZIP_SHA256) {
    throw new Error(
      `SteamAutoCrack ${UPSTREAM_VERSION} archive integrity check failed`
    );
  }
  console.log(`✓ verified SteamAutoCrack ${UPSTREAM_VERSION} archive`);

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

  ensureDir(assemblyOutDir);
  for (const folder of ["Goldberg", "TEMP"]) {
    const src = path.join(extractDir, folder);
    const dest = path.join(assemblyOutDir, folder);
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
  console.log(`Cloning Steam-auto-crack ${UPSTREAM_VERSION} source…`);
  execFileSync(
    "git",
    ["clone", "--depth", "1", "--branch", UPSTREAM_VERSION, REPO_URL, tmp],
    { stdio: "inherit" }
  );
  const checkedOutCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: tmp,
    encoding: "utf8",
  }).trim();
  if (checkedOutCommit !== UPSTREAM_COMMIT) {
    throw new Error(
      `SteamAutoCrack ${UPSTREAM_VERSION} source integrity check failed`
    );
  }
  console.log(`✓ verified source commit ${UPSTREAM_COMMIT.slice(0, 12)}`);

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

  ensureDir(assemblyOutDir);
  fs.cpSync(path.join(tmp, "cli-build"), assemblyOutDir, {
    recursive: true,
    force: true,
  });
  console.log("✓ SteamAutoCrack.CLI → emulator-tool/");

  fs.rmSync(tmp, { recursive: true, force: true });
}

async function main() {
  // Never merge verified inputs into a prior gitignored tree: doing so could
  // silently ship stale local binaries that are absent on a clean CI runner.
  const stagingDir = `${FINAL_OUT_DIR}.staging-${process.pid}`;
  const previousDir = `${FINAL_OUT_DIR}.previous-${process.pid}`;
  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.rmSync(previousDir, { recursive: true, force: true });
  ensureDir(stagingDir);
  assemblyOutDir = stagingDir;

  try {
    await downloadReleaseBundle();
    await buildCli();

    if (fs.existsSync(FINAL_OUT_DIR)) {
      fs.renameSync(FINAL_OUT_DIR, previousDir);
    }
    try {
      fs.renameSync(stagingDir, FINAL_OUT_DIR);
    } catch (error) {
      if (!fs.existsSync(FINAL_OUT_DIR) && fs.existsSync(previousDir)) {
        fs.renameSync(previousDir, FINAL_OUT_DIR);
      }
      throw error;
    }
    fs.rmSync(previousDir, { recursive: true, force: true });
    console.log("Steam emulator bundle ready in", FINAL_OUT_DIR);
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    if (!fs.existsSync(FINAL_OUT_DIR) && fs.existsSync(previousDir)) {
      fs.renameSync(previousDir, FINAL_OUT_DIR);
    }
  }
}

main().catch((err) => {
  console.error("Error assembling emulator-tool:", err);
  process.exit(1);
});
