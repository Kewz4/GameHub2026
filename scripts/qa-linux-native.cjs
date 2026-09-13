// Run on an ISOLATED X server, e.g. xvfb-run -a with Openbox already running.
// Never points at a user's game, profile, audio stream, or home directory.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const execFileAsync = promisify(execFile);
const { once } = require("node:events");
const readline = require("node:readline");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (check, message, timeout = 8000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await delay(80);
  }
  throw new Error(message);
};

async function main() {
  assert.equal(process.platform, "linux", "Real Linux is required");
  assert.equal(
    process.env.GAMEHUB_LINUX_NATIVE_QA,
    "1",
    "Set GAMEHUB_LINUX_NATIVE_QA=1 only inside an isolated Xvfb session"
  );
  assert.ok(
    process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    "An isolated X11 desktop is required"
  );
  const root = path.resolve(__dirname, "..");
  const directory = fs.mkdtempSync(
    path.join(root, "artifacts", "linux-parity", "native-")
  );
  const addon = require(path.join(root, "hydra-native", "hydra-native.node"));
  const report = {
    platform: process.platform,
    checks: [],
    startedAt: new Date().toISOString(),
  };
  const children = [];
  const check = (name, result) => {
    assert.ok(result, name);
    report.checks.push({ name, passed: true });
  };
  async function fixture(name) {
    const output = path.join(directory, name);
    fs.mkdirSync(output, { recursive: true });
    const env = { ...process.env, GAMEHUB_LINUX_QA_DIRECTORY: output };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(
      require("electron"),
      ["--no-sandbox", path.join(__dirname, "qa-linux-native-window.cjs")],
      { env, stdio: ["pipe", "pipe", "pipe"] }
    );
    children.push(child);
    const messages = [];
    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      if (line.startsWith("GAMEHUB_QA "))
        messages.push(JSON.parse(line.slice(11)));
    });
    child.stderr.on("data", (chunk) =>
      fs.appendFileSync(path.join(output, "stderr.log"), chunk)
    );
    child.once("error", (error) =>
      messages.push({ type: "error", message: error.message })
    );
    const ready = await waitFor(
      () => messages.find((message) => message.type === "ready"),
      `Electron ${name} did not become ready`
    );
    const request = async (command) => {
      const before = messages.length;
      child.stdin.write(`${JSON.stringify(command)}\n`);
      return waitFor(
        () =>
          messages
            .slice(before)
            .find(
              (message) =>
                message.type === command.type || message.type === "error"
            ),
        `${command.type} timed out`
      );
    };
    return { child, request, ...ready };
  }
  try {
    const game = await fixture("game");
    check(
      "native process enumeration includes isolated game",
      addon.listProcesses().some((item) => item.pid === game.pid)
    );
    const identity = addon.getProcessCreationTimeTicks(game.pid);
    check(
      "proc start identity exists",
      typeof identity === "string" && /^\d+$/.test(identity)
    );
    const bounds = await waitFor(
      () => addon.getProcessWindowBounds(game.pid),
      "X11 game bounds unavailable"
    );
    check(
      "exact X11 window identity and geometry",
      String(bounds.windowId ?? bounds.window_id) === String(game.handle) &&
        bounds.width === 640 &&
        bounds.height === 360
    );
    await waitFor(
      () => addon.getForegroundProcessId() === game.pid,
      "foreground game PID not detected"
    );
    check("X11 foreground PID matches game", true);
    const source = await game.request({ type: "sources", handle: game.handle });
    check(
      "Electron exact game-window source and nonempty frame",
      source.exact && source.nonempty
    );
    await game.request({ type: "screenshot" });
    const overlay = await fixture("overlay");
    const handle = Buffer.alloc(8);
    handle.writeUInt32LE(overlay.handle);
    check(
      "native X11 overlay placement request",
      addon.placeOverlayWindow(handle, game.pid)
    );
    await waitFor(() => {
      const placed = addon.getProcessWindowBounds(overlay.pid);
      return (
        placed &&
        placed.x === bounds.x &&
        placed.y === bounds.y &&
        placed.width === bounds.width &&
        placed.height === bounds.height
      );
    }, "overlay geometry did not follow the actual game");
    check("actual overlay geometry matches target", true);
    check(
      "native overlay activation request",
      addon.forceForegroundWindow(overlay.handle)
    );
    await waitFor(
      () => addon.getForegroundProcessId() === overlay.pid,
      "overlay did not gain foreground"
    );
    check("actual overlay foreground ownership", true);
    check("native game refocus request", addon.focusProcessWindow(game.pid));
    await waitFor(
      () => addon.getForegroundProcessId() === game.pid,
      "game did not regain foreground"
    );
    check("game focus restored", true);
    if (process.env.GAMEHUB_LINUX_AUDIO_QA === "1") {
      const recording = await execFileAsync(
        process.execPath,
        [
          path.join(root, "node_modules/tsx/dist/cli.mjs"),
          "--tsconfig",
          path.join(root, "tsconfig.node.json"),
          path.join(__dirname, "qa-linux-recorder.ts"),
          String(game.handle),
          path.join(directory, "recorder"),
        ],
        { env: process.env, timeout: 45000, maxBuffer: 2 * 1024 * 1024 }
      );
      fs.writeFileSync(
        path.join(directory, "recorder.log"),
        recording.stdout + recording.stderr
      );
      check("real X11 recording, output-monitor audio and mixer", true);
    }
    report.compositorAvailable = addon.isDesktopCompositionAvailable();
    if (process.env.GAMEHUB_LINUX_COMPOSITOR_QA === "1") {
      check(
        "real X11 compositor selection ownership",
        report.compositorAvailable
      );
    }
    check(
      "controller adapter can poll without connected hardware",
      Number.isInteger(addon.getOverlayGamepadButtons())
    );
    for (const action of ["suspend", "resume"]) {
      const result = addon.controlProcessTree(game.pid, action);
      check(
        `owned game tree ${action}`,
        !result.unsupported &&
          (result.failedPids ?? result.failed_pids).length === 0 &&
          (result.succeededPids ?? result.succeeded_pids).includes(game.pid)
      );
      check(
        `game identity preserved after ${action}`,
        addon.getProcessCreationTimeTicks(game.pid) === identity
      );
    }
    const exit = once(game.child, "exit");
    const closed = addon.controlProcessTree(game.pid, "terminate");
    check(
      "owned game tree terminate",
      (closed.succeededPids ?? closed.succeeded_pids).includes(game.pid)
    );
    await Promise.race([
      exit,
      delay(8000).then(() => {
        throw new Error("fixture did not exit");
      }),
    ]);
    check("terminated fixture exited", true);
    check(
      "self process control refused",
      (addon.controlProcessTree(process.pid, "suspend").succeededPids ?? [])
        .length === 0
    );
    report.success = true;
  } catch (error) {
    report.success = false;
    report.error = error.stack || String(error);
    process.exitCode = 1;
  } finally {
    for (const child of children) {
      if (child.exitCode !== null || child.signalCode !== null) continue;
      // Resume/close only children launched by this harness, including cleanup
      // following an assertion while an owned process happened to be stopped.
      try {
        addon.controlProcessTree(child.pid, "resume");
      } catch {}
      try {
        child.stdin.write('{"type":"quit"}\n');
      } catch {}
      await delay(300);
      if (child.exitCode === null && child.signalCode === null) {
        try {
          addon.controlProcessTree(child.pid, "terminate");
        } catch {
          child.kill("SIGKILL");
        }
      }
    }
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(
      path.join(directory, "report.json"),
      JSON.stringify(report, null, 2)
    );
    process.stdout.write(
      `${JSON.stringify(report, null, 2)}\nEvidence: ${directory}\n`
    );
  }
}
fs.mkdirSync(path.resolve(__dirname, "../artifacts/linux-parity"), {
  recursive: true,
});
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
