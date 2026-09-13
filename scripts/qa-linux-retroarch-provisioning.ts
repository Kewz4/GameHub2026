/** Opt-in GitHub Actions-only smoke: official user Flatpak + real core downloads.
 * No ROMs, BIOS, accounts, permission overrides, or writes to the parent's HOME. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { findExecutableOnPath } from "../src/main/services/launcher-binary";
import {
  LINUX_RETRO_CORES,
  findRetroArchCorePath,
} from "../src/main/services/emulators/retroarch-linux";
import {
  provisionLinuxRetroArch,
  linuxRetroArchInstallPlan,
  validateLinuxRetroCore,
  RETROARCH_FLATPAK_ID,
} from "../src/main/services/emulators/linux-retroarch-provisioner";

const script = fileURLToPath(import.meta.url);
const repository = path.resolve(path.dirname(script), "..");
const runFile = promisify(execFile);
const PREFIX = "gamehub-retroarch-ci-";
const REPORT = "provisioning-report.json";
const MARKER = ".gamehub-retroarch-qa.json";

export function requireRetroArchCiOptIn({
  platform = process.platform,
  enabled = process.env.GAMEHUB_LINUX_RETROARCH_QA,
  githubActions = process.env.GITHUB_ACTIONS,
  ci = process.env.CI,
  uid = typeof process.getuid === "function" ? process.getuid() : -1,
} = {}) {
  if (
    platform !== "linux" ||
    enabled !== "1" ||
    githubActions !== "true" ||
    ci !== "true" ||
    uid <= 0
  ) {
    throw new Error(
      "RetroArch provisioning smoke requires Linux, a non-root GitHub Actions user, CI=true, and explicit GAMEHUB_LINUX_RETROARCH_QA=1. No installation was attempted."
    );
  }
}

export function buildIsolatedRetroArchEnvironment(
  root: string,
  parent: NodeJS.ProcessEnv
) {
  // Intentionally do not spread the parent's environment: no tokens, account
  // config, Flatpak overrides, or injected Node options cross this boundary.
  const result: NodeJS.ProcessEnv = {
    PATH: parent.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    HOME: path.join(root, "home"),
    XDG_CONFIG_HOME: path.join(root, "config"),
    XDG_DATA_HOME: path.join(root, "data"),
    XDG_CACHE_HOME: path.join(root, "cache"),
    XDG_STATE_HOME: path.join(root, "state"),
    XDG_RUNTIME_DIR: path.join(root, "runtime"),
    FLATPAK_USER_DIR: path.join(root, "data", "flatpak"),
    TMPDIR: path.join(root, "tmp"),
    CI: "true",
    GITHUB_ACTIONS: "true",
    GAMEHUB_LINUX_RETROARCH_QA: "1",
    NODE_OPTIONS: "--max-old-space-size=4096",
  };
  for (const name of ["DISPLAY", "DBUS_SESSION_BUS_ADDRESS"] as const) {
    if (parent[name]) result[name] = parent[name];
  }
  return result;
}

function errorDetails(error: unknown) {
  const details: string[] = [];
  let current = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth++) {
    const item = current as Error & {
      cause?: unknown;
      stderr?: unknown;
      stdout?: unknown;
    };
    details.push(item.message);
    if (typeof item.stderr === "string" && item.stderr.trim())
      details.push(item.stderr.slice(-12_000));
    current = item.cause;
  }
  return details.join("\n").slice(-20_000);
}

export function classifyRetroArchQaFailure(detail: string) {
  return /bwrap|namespace|Operation not permitted|permission denied|D-Bus|dbus|Flatpak is not installed|Could not resolve|Network|TLS|timed out|GPG|sandbox profile paths escaped|HTTP.*(?:403|429|50[234])|Failed to connect/i.test(
    detail
  )
    ? "external-runtime-blocked"
    : "failed";
}

function validateIsolatedRoot(root: string, token: string) {
  const resolved = path.resolve(root);
  assert.equal(
    fs.realpathSync(resolved),
    resolved,
    "QA root must not be a symlink"
  );
  assert.ok(path.basename(resolved).startsWith(PREFIX));
  const marker = JSON.parse(
    fs.readFileSync(path.join(resolved, MARKER), "utf8")
  );
  assert.equal(marker.token, token, "QA root ownership marker mismatch");
  assert.equal(marker.uid, process.getuid!());
  assert.equal(path.dirname(resolved), marker.parentTemp);
  assert.ok(marker.createdAt > Date.now() - 60 * 60 * 1000, "QA root is stale");
  return resolved;
}

async function runIsolatedChild(root: string, token: string) {
  requireRetroArchCiOptIn();
  root = validateIsolatedRoot(root, token);
  const expected = buildIsolatedRetroArchEnvironment(root, process.env);
  for (const key of [
    "HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME",
    "XDG_STATE_HOME",
    "XDG_RUNTIME_DIR",
    "FLATPAK_USER_DIR",
    "TMPDIR",
  ]) {
    assert.equal(
      process.env[key],
      expected[key],
      `${key} escaped the isolated profile`
    );
    assert.ok(path.resolve(process.env[key]!).startsWith(root + path.sep));
    assert.equal(
      fs.realpathSync(process.env[key]!),
      path.resolve(process.env[key]!)
    );
  }
  const report: Record<string, unknown> = {
    suite: "native-linux-retroarch-provisioning",
    outcome: "running",
    startedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    accountData: "none",
    roms: "none",
    bios: "none",
    profile: "new isolated child-only HOME/XDG directories",
    sourceTrust:
      "official Flathub signed metadata and HTTPS Libretro updater cores; not pinned core hashes",
    steps: [],
  };
  const steps = report.steps as Array<Record<string, unknown>>;
  const save = () => {
    const temporary = path.join(root, `${REPORT}.pending`);
    fs.writeFileSync(temporary, JSON.stringify(report, null, 2));
    fs.renameSync(temporary, path.join(root, REPORT));
  };
  const step = (name: string, status: string, detail?: unknown) => {
    steps.push({ name, status, detail, at: new Date().toISOString() });
    save();
  };
  save();
  try {
    assert.ok(
      process.env.DBUS_SESSION_BUS_ADDRESS,
      "Run this smoke inside dbus-run-session"
    );
    const flatpak = findExecutableOnPath("flatpak");
    const sevenZip = findExecutableOnPath("7zz") ?? findExecutableOnPath("7z");
    if (!flatpak || !sevenZip)
      throw new Error(
        "Flatpak is not installed or the 7z archive tool is missing. Install CI dependencies flatpak and p7zip-full."
      );
    const toolVersion = await runFile(flatpak, ["--version"], {
      timeout: 10_000,
    });
    step("flatpak-client", "passed", toolVersion.stdout.trim());
    const listFiles = async (archive: string) => {
      const { stdout } = await runFile(
        sevenZip,
        ["l", "-slt", "-ba", archive],
        { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 }
      );
      return [...stdout.matchAll(/^Path = (.+)$/gm)].map((match) =>
        match[1].trim()
      );
    };
    step("official-user-install-and-cores", "running");
    const installed = await provisionLinuxRetroArch({
      onStatus: (message) => step("setup-progress", "running", message),
      archiveTools: {
        listFiles,
        extractFile: async ({ filePath, outputPath }) => {
          const entries = await listFiles(filePath);
          await runFile(sevenZip, ["x", "-y", `-o${outputPath}`, filePath], {
            timeout: 60_000,
            maxBuffer: 2 * 1024 * 1024,
          });
          return { success: true, extractedFiles: entries };
        },
      },
    });
    assert.equal(installed.coreCount, 5);
    assert.ok(
      path
        .resolve(installed.executablePath)
        .startsWith(path.join(root, "data", "flatpak") + path.sep)
    );
    assert.ok(
      path
        .resolve(installed.coreDirectory)
        .startsWith(path.join(root, "home") + path.sep)
    );
    step("official-user-install-and-cores", "passed", {
      coreCount: installed.coreCount,
      executable: path.relative(root, installed.executablePath),
    });
    const plan = linuxRetroArchInstallPlan();
    const appRef = await runFile(
      flatpak,
      ["info", "--user", "--show-ref", RETROARCH_FLATPAK_ID],
      { timeout: 10_000 }
    );
    assert.equal(
      appRef.stdout.trim(),
      `app/${RETROARCH_FLATPAK_ID}/${plan.arch}/stable`
    );
    const origin = await runFile(
      flatpak,
      ["info", "--user", "--show-origin", RETROARCH_FLATPAK_ID],
      { timeout: 10_000 }
    );
    const remotes = await runFile(
      flatpak,
      ["remotes", "--user", "--columns=name,url"],
      { timeout: 10_000 }
    );
    const remote = remotes.stdout
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/))
      .find(([name]) => name === origin.stdout.trim());
    assert.ok(
      remote && /^https:\/\/dl\.flathub\.org\/repo\/?$/.test(remote[1]),
      "Installed RetroArch did not originate from official Flathub"
    );
    step("installed-app-ref-and-origin", "passed", {
      ref: appRef.stdout.trim(),
      remote: remote[1],
    });
    const cores = [];
    for (const [system, name] of Object.entries(LINUX_RETRO_CORES)) {
      const expectedCore = path.join(installed.coreDirectory, `${name}.so`);
      const selected = findRetroArchCorePath(
        path.dirname(installed.executablePath),
        system
      );
      assert.equal(
        selected,
        expectedCore,
        `${system} did not select its provisioned native core`
      );
      assert.equal(fs.realpathSync(expectedCore), expectedCore);
      const bytes = fs.readFileSync(expectedCore);
      validateLinuxRetroCore(bytes, plan.arch);
      cores.push({
        system,
        core: name,
        bytes: bytes.length,
        sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
        path: path.relative(root, expectedCore),
      });
    }
    step("eight-system-core-paths-and-elf", "passed", cores);
    step("sandbox-profile-isolation", "running");
    const sandboxEnvironment = await runFile(
      flatpak,
      [
        "run",
        "--user",
        `--arch=${plan.arch}`,
        "--command=printenv",
        RETROARCH_FLATPAK_ID,
        "HOME",
        "XDG_CONFIG_HOME",
        "XDG_DATA_HOME",
      ],
      { timeout: 90_000, maxBuffer: 64 * 1024 }
    );
    const sandboxPaths = sandboxEnvironment.stdout.trim().split(/\r?\n/);
    assert.equal(sandboxPaths.length, 3);
    assert.ok(
      sandboxPaths.every((value) =>
        path.resolve(value).startsWith(root + path.sep)
      ),
      "Flatpak sandbox profile paths escaped the isolated CI root; no application was launched."
    );
    step(
      "sandbox-profile-isolation",
      "passed",
      sandboxPaths.map((value) => path.relative(root, value))
    );
    step("actual-flatpak-app-version", "running");
    // This executes the actual installed app inside its ordinary Flatpak
    // sandbox. If user namespaces, D-Bus, or the runtime are denied, report it;
    // never add --no-sandbox, overrides, or system policy changes.
    const version = await runFile(
      flatpak,
      [
        "run",
        "--user",
        `--arch=${plan.arch}`,
        RETROARCH_FLATPAK_ID,
        "--version",
      ],
      { timeout: 90_000, maxBuffer: 2 * 1024 * 1024 }
    );
    const versionText = `${version.stdout}\n${version.stderr}`.trim();
    assert.match(versionText, /RetroArch/i);
    step("actual-flatpak-app-version", "passed", versionText.slice(0, 2000));
    report.outcome = "passed";
  } catch (error) {
    const detail = errorDetails(error);
    report.outcome = classifyRetroArchQaFailure(detail);
    report.error = detail;
    step("failure", String(report.outcome), detail);
    process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    save();
  }
}

async function runParent() {
  requireRetroArchCiOptIn();
  const artifactRoot = path.join(
    repository,
    "artifacts",
    "linux-retroarch-provisioning",
    new Date().toISOString().replace(/[:.]/g, "-")
  );
  fs.mkdirSync(artifactRoot, { recursive: true });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), PREFIX));
  const token = crypto.randomUUID();
  const environment = buildIsolatedRetroArchEnvironment(root, process.env);
  fs.writeFileSync(
    path.join(root, MARKER),
    JSON.stringify({
      token,
      uid: process.getuid!(),
      parentTemp: path.dirname(root),
      createdAt: Date.now(),
    }),
    { mode: 0o600 }
  );
  for (const name of [
    "HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME",
    "XDG_STATE_HOME",
    "XDG_RUNTIME_DIR",
    "FLATPAK_USER_DIR",
    "TMPDIR",
  ])
    fs.mkdirSync(environment[name]!, { recursive: true, mode: 0o700 });
  let timedOut = false;
  let childExited = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const child = spawn(
    process.execPath,
    [
      path.join(repository, "node_modules", "tsx", "dist", "cli.mjs"),
      "--tsconfig",
      path.join(repository, "tsconfig.web.json"),
      script,
      "--isolated-child",
      root,
      token,
    ],
    {
      cwd: repository,
      env: environment,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  let diagnosticTail = "";
  for (const stream of [child.stdout, child.stderr])
    stream?.on("data", (chunk) => {
      diagnosticTail = (diagnosticTail + chunk.toString()).slice(-16_000);
    });
  const timer = setTimeout(
    () => {
      timedOut = true;
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          /* The child may already have exited. */
        }
      }
      killTimer = setTimeout(() => {
        if (childExited || !child.pid) return;
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          /* Only this detached QA process group is targeted. */
        }
      }, 5000);
    },
    20 * 60 * 1000
  );
  const code = await new Promise<number | null>((resolve) => {
    child.once("error", (error) => {
      diagnosticTail += error.message;
      resolve(1);
    });
    child.once("exit", (exitCode) => {
      childExited = true;
      resolve(exitCode);
    });
  });
  clearTimeout(timer);
  clearTimeout(killTimer);
  let report: Record<string, unknown> = {
    outcome: timedOut ? "external-runtime-blocked" : "failed",
    error: "Child process ended before a report was available",
    steps: [],
  };
  const sourceReport = path.join(root, REPORT);
  if (fs.existsSync(sourceReport)) {
    try {
      report = JSON.parse(fs.readFileSync(sourceReport, "utf8"));
    } catch {
      report.error =
        "The isolated child report was incomplete. Inspect diagnosticTail for its last error.";
    }
  }
  if (timedOut) {
    report.outcome = "external-runtime-blocked";
    report.error =
      "The isolated provisioning job exceeded its 20-minute deadline.";
  }
  report.childExitCode = code;
  report.diagnosticTail = diagnosticTail;
  report.parentEnvironmentModified = false;
  report.cleanup = "pending";
  try {
    validateIsolatedRoot(root, token);
    if (timedOut)
      report.cleanup =
        "isolated CI directory retained after timeout; no real Flatpak data was touched";
    else {
      fs.rmSync(root, { recursive: true, force: true });
      report.cleanup = "isolated profile removed";
    }
  } catch (error) {
    report.cleanup = errorDetails(error);
  }
  fs.writeFileSync(
    path.join(artifactRoot, REPORT),
    JSON.stringify(report, null, 2)
  );
  console.log(
    JSON.stringify(
      { artifactRoot, outcome: report.outcome, cleanup: report.cleanup },
      null,
      2
    )
  );
  if (code !== 0 || report.outcome !== "passed") process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(script)) {
  const operation =
    process.argv[2] === "--isolated-child"
      ? runIsolatedChild(process.argv[3], process.argv[4])
      : runParent();
  operation.catch((error) => {
    console.error(errorDetails(error));
    process.exitCode = 1;
  });
}
