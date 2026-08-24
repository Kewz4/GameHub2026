import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";

import {
  decodePresentMonTextChunk,
  parseCsvRow,
  parsePresentMonSample,
  resolvePresentMonFrameTimeColumns,
} from "../../src/main/services/overlay-performance-metrics.ts";
import {
  getPresentMonRetry,
  PRESENTMON_MAX_CAPTURE_ATTEMPTS,
} from "../../src/main/services/overlay-fps-retry.ts";
import {
  excludeOverlayLaunchHelpers,
  rankOverlayGameProcesses,
  selectOverlayRenderProcess,
  selectUnambiguousOverlayRenderProcess,
} from "../../src/main/services/overlay-game-process-ranking.ts";
import {
  OVERLAY_INPUT_REQUIRED_CAPABILITIES,
  OverlayInputGateController,
  type OverlayInputGateNativeStatus,
} from "../../src/main/services/overlay-input-gate.ts";

const require = createRequire(import.meta.url);

const csv = [
  "Application,ProcessID,SwapChainAddress,PresentRuntime,PresentMode,MsBetweenPresents",
  "Hades2.exe,4242,0x123,DXGI,Hardware: Independent Flip,16.6667",
  "",
].join("\r\n");

test("decodes PresentMon stdout as UTF-16LE and preserves an odd trailing byte", () => {
  const bytes = Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from(csv, "utf16le"),
  ]);
  const first = decodePresentMonTextChunk(
    bytes.subarray(0, bytes.length - 1),
    null
  );

  assert.equal(first.encoding, "utf16le");
  assert.equal(first.bytesConsumed, bytes.length - 2);
  assert.equal(first.text.endsWith("\r"), true);

  const second = decodePresentMonTextChunk(
    bytes.subarray(first.bytesConsumed),
    first.encoding
  );
  assert.equal(second.bytesConsumed, 2);
  assert.equal(first.text + second.text, csv);
});

test("decodes UTF-8 PresentMon files and parses a target sample", () => {
  const decoded = decodePresentMonTextChunk(Buffer.from(csv, "utf8"), null);
  assert.equal(decoded.encoding, "utf8");
  assert.equal(decoded.text, csv);

  const [header, row] = decoded.text.trim().split(/\r?\n/u);
  const indexes = resolvePresentMonFrameTimeColumns(parseCsvRow(header));
  const sample = parsePresentMonSample(parseCsvRow(row), indexes);

  assert.equal(sample?.processId, 4242);
  assert.equal(sample?.frameTimeMs, 16.6667);
  assert.equal(sample?.runtime, "DXGI");
});

test("hands an intentional Steam loader off to a foreground Unreal renderer", () => {
  const loader =
    "C:\\Games\\The First Berserker Khazan\\steamclient_loader_x64.exe";
  const renderer =
    "C:\\Games\\The First Berserker Khazan\\BBQ\\Binaries\\Win64\\BBQ-Win64-Shipping.exe";
  const ranked = rankOverlayGameProcesses(
    [
      { exe: loader, name: "steamclient_loader_x64.exe", pid: 21772 },
      { exe: renderer, name: "BBQ-Win64-Shipping.exe", pid: 8116 },
    ],
    [loader],
    8116,
    21772
  );

  assert.equal(ranked[0]?.pid, 8116);
  assert.deepEqual(
    excludeOverlayLaunchHelpers(
      rankOverlayGameProcesses(
        [{ exe: loader, name: "steamclient_loader_x64.exe", pid: 21772 }],
        [loader],
        0,
        0
      )
    ),
    []
  );
});

test("does not let a generic foreground utility steal a preferred exact game", () => {
  const target = "C:\\Games\\Example\\Example.exe";
  const ranked = rankOverlayGameProcesses(
    [
      { exe: target, name: "Example.exe", pid: 100 },
      {
        exe: "C:\\Games\\Example\\Tools\\Settings.exe",
        name: "Settings.exe",
        pid: 200,
      },
    ],
    [target],
    200,
    100
  );

  assert.equal(ranked[0]?.pid, 100);
});

test("selects a visible nested renderer over a hidden same-name launcher", () => {
  const launcher = "C:\\Games\\Death Must Die\\Death Must Die.exe";
  const renderer =
    "C:\\Games\\Death Must Die\\Death Must Die\\Death Must Die.exe";
  const ranked = rankOverlayGameProcesses(
    [
      { exe: launcher, name: "Death Must Die.exe", pid: 10 },
      { exe: renderer, name: "Death Must Die.exe", pid: 20 },
    ],
    [launcher],
    20,
    0
  );

  assert.equal(selectOverlayRenderProcess(ranked, new Set([20]), 0)?.pid, 20);
  assert.equal(
    selectOverlayRenderProcess(
      [{ exe: launcher, name: "Death Must Die.exe", pid: 10, score: 10_000 }],
      new Set(),
      20
    ),
    null
  );
  assert.equal(selectOverlayRenderProcess(ranked, new Set(), 20)?.pid, 20);
});

test("requires foreground to disambiguate multiple visible render processes", () => {
  const candidates = [
    { pid: 10, score: 10_000 },
    { pid: 20, score: 9_000 },
  ];
  const visible = new Set([10, 20]);

  assert.equal(
    selectUnambiguousOverlayRenderProcess(candidates, visible, 10, 20)?.pid,
    20
  );
  assert.equal(
    selectUnambiguousOverlayRenderProcess(candidates, visible, 10, 999),
    null
  );
});

test("bounds silent PresentMon retries with increasing backoff", () => {
  assert.deepEqual(getPresentMonRetry(1), {
    delayMs: 2_000,
    nextAttempt: 2,
  });
  assert.deepEqual(getPresentMonRetry(2), {
    delayMs: 6_000,
    nextAttempt: 3,
  });
  assert.equal(getPresentMonRetry(PRESENTMON_MAX_CAPTURE_ATTEMPTS), null);
});

const gateStatus = (
  pid: number,
  overrides: Partial<OverlayInputGateNativeStatus> = {}
): OverlayInputGateNativeStatus => ({
  ready: false,
  ownerPid: 1,
  targetPid: pid,
  blocked: false,
  generation: 7,
  readyPid: 0,
  readyGeneration: 0,
  capabilityMask: 0,
  unsupportedModuleMask: 0,
  hookStatus: 0,
  ...overrides,
});

test("blocks only after the injected worker positively acknowledges readiness", async () => {
  const writes: Array<[number, boolean]> = [];
  let finishInjection: (ready: boolean) => void = () => undefined;
  let injectionAttempts = 0;
  let status = gateStatus(42);
  const controller = new OverlayInputGateController({
    create: () => true,
    set: (pid, blocked) => {
      writes.push([pid, blocked]);
      return true;
    },
    inject: () => {
      injectionAttempts += 1;
      return new Promise<boolean>((resolve) => {
        finishInjection = resolve;
      });
    },
    status: () => status,
  });

  controller.initialize();
  controller.setTarget(42);
  assert.equal(injectionAttempts, 0, "target detection alone must not inject");
  // Leave enough real-clock headroom for the full parallel overlay suite.
  // The assertions below, rather than a 100 ms scheduler race, prove that
  // LoadLibrary completion alone cannot arm the gate.
  const readiness = controller.waitUntilReady(42, 1_000, 1);
  assert.equal(injectionAttempts, 1, "explicit activation prepares the hook");
  assert.equal(
    writes.some(([pid, blocked]) => pid === 42 && blocked),
    false
  );

  finishInjection(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    writes.some(([pid, blocked]) => pid === 42 && blocked),
    false,
    "LoadLibrary success must not arm the gate"
  );
  status = gateStatus(42, {
    ready: true,
    readyPid: 42,
    readyGeneration: 7,
    capabilityMask: OVERLAY_INPUT_REQUIRED_CAPABILITIES,
    hookStatus: 301,
  });
  assert.equal((await readiness).ready, true);
  assert.equal(controller.activate(42), true);
  assert.deepEqual(writes.at(-1), [42, true]);

  controller.release();
  assert.deepEqual(writes.at(-1), [42, false]);
  controller.dispose();
  assert.deepEqual(writes.at(-1), [0, false]);
});

test("a stale injection cannot block a new target", async () => {
  const writes: Array<[number, boolean]> = [];
  const injections = new Map<number, (ready: boolean) => void>();
  let status = gateStatus(10);
  const controller = new OverlayInputGateController({
    create: () => true,
    set: (pid, blocked) => {
      writes.push([pid, blocked]);
      return true;
    },
    inject: (pid) =>
      new Promise<boolean>((resolve) => injections.set(pid, resolve)),
    status: () => status,
  });

  controller.initialize();
  controller.setTarget(10);
  const staleReadiness = controller.waitUntilReady(10, 100, 1);
  controller.setTarget(20);
  injections.get(10)?.(true);
  assert.equal((await staleReadiness).ready, false);
  assert.equal(
    writes.some(([pid, blocked]) => pid === 10 && blocked),
    false
  );

  status = gateStatus(20, {
    ready: true,
    readyPid: 20,
    readyGeneration: 7,
    capabilityMask: OVERLAY_INPUT_REQUIRED_CAPABILITIES,
  });
  const currentReadiness = controller.waitUntilReady(20, 10, 1);
  injections.get(20)?.(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await currentReadiness).ready, true);
  assert.equal(controller.activate(20), true);
  assert.deepEqual(writes.at(-1), [20, true]);
  controller.setTarget(0);
  assert.deepEqual(writes.at(-1), [0, false]);
});

test("the same PID with a new creation identity starts a fresh generation", async () => {
  const writes: Array<[number, boolean]> = [];
  const injections: string[] = [];
  let status = gateStatus(42, {
    ready: true,
    readyPid: 42,
    readyGeneration: 7,
    capabilityMask: OVERLAY_INPUT_REQUIRED_CAPABILITIES,
  });
  const controller = new OverlayInputGateController({
    create: () => true,
    set: (pid, blocked) => {
      writes.push([pid, blocked]);
      if (pid === 0) status = gateStatus(0);
      return true;
    },
    inject: async (_pid, identity) => {
      injections.push(identity);
      status = gateStatus(42, {
        ready: true,
        readyPid: 42,
        readyGeneration: 7,
        capabilityMask: OVERLAY_INPUT_REQUIRED_CAPABILITIES,
      });
      return true;
    },
    status: () => status,
  });
  controller.initialize();
  controller.setTarget(42, "creation-a");
  assert.equal((await controller.waitUntilReady(42, 20, 1)).ready, true);

  controller.setTarget(42, "creation-b");
  assert.equal(controller.inspect(42).ready, false);
  assert.equal((await controller.waitUntilReady(42, 20, 1)).ready, true);
  assert.deepEqual(injections, ["creation-a", "creation-b"]);
  assert.ok(
    writes.some(([pid, blocked]) => pid === 0 && !blocked),
    "PID reuse must clear the native target/generation first"
  );
});

test("a transient injection failure can be retried for the same target", async () => {
  let attempts = 0;
  const readyStatus = (ready: boolean): OverlayInputGateNativeStatus => ({
    ready,
    ownerPid: 1,
    targetPid: 42,
    blocked: false,
    generation: 1,
    readyPid: ready ? 42 : 0,
    readyGeneration: ready ? 1 : 0,
    capabilityMask: ready ? OVERLAY_INPUT_REQUIRED_CAPABILITIES : 0,
    unsupportedModuleMask: 0,
    hookStatus: ready ? 4 : 0,
  });
  let status = readyStatus(false);
  const controller = new OverlayInputGateController({
    create: () => true,
    set: () => true,
    inject: async () => {
      attempts += 1;
      if (attempts === 2) status = readyStatus(true);
      return attempts > 1;
    },
    status: () => status,
  });
  controller.initialize();
  controller.setTarget(42);

  assert.equal((await controller.waitUntilReady(42, 5, 1)).ready, false);
  assert.equal((await controller.waitUntilReady(42, 50, 1)).ready, true);
  assert.equal(attempts, 2);
});

test("a late handshake after an indeterminate injection result is accepted", async () => {
  let status: OverlayInputGateNativeStatus = {
    ready: false,
    ownerPid: 1,
    targetPid: 77,
    blocked: false,
    generation: 1,
    readyPid: 0,
    readyGeneration: 0,
    capabilityMask: 0,
    unsupportedModuleMask: 0,
    hookStatus: 0,
  };
  const controller = new OverlayInputGateController({
    create: () => true,
    set: () => true,
    inject: async () => {
      setTimeout(() => {
        status = {
          ...status,
          ready: true,
          readyPid: 77,
          readyGeneration: 1,
          capabilityMask: OVERLAY_INPUT_REQUIRED_CAPABILITIES,
          hookStatus: 4,
        };
      }, 10);
      return false;
    },
    status: () => status,
  });
  controller.initialize();
  controller.setTarget(77);

  assert.equal((await controller.waitUntilReady(77, 100, 2)).ready, true);
});

test("rejects a ready hook when an unsupported input stack is observed", async () => {
  const writes: Array<[number, boolean]> = [];
  const status = gateStatus(55, {
    ready: true,
    readyPid: 55,
    readyGeneration: 7,
    capabilityMask: OVERLAY_INPUT_REQUIRED_CAPABILITIES,
    unsupportedModuleMask: 1,
  });
  const controller = new OverlayInputGateController({
    create: () => true,
    set: (pid, blocked) => {
      writes.push([pid, blocked]);
      return true;
    },
    inject: async () => true,
    status: () => status,
  });
  controller.setTarget(55);
  const readiness = await controller.waitUntilReady(55, 10, 1);
  assert.deepEqual(readiness, {
    ready: false,
    reason: "unsupported",
    status,
  });
  assert.equal(controller.activate(55), false);
  assert.equal(
    writes.some(([pid, blocked]) => pid === 55 && blocked),
    false
  );
});

test("failed revalidation never releases an already latched visible gate", () => {
  const writes: Array<[number, boolean]> = [];
  const controller = new OverlayInputGateController({
    create: () => true,
    set: (pid, blocked) => {
      writes.push([pid, blocked]);
      return false;
    },
    inject: async () => true,
    status: () =>
      gateStatus(55, {
        blocked: true,
        unsupportedModuleMask: 2,
      }),
  });
  // Seed through a normal adapter first; then the status itself proves the
  // native latch is active even though readiness was invalidated.
  (controller as unknown as { created: boolean; targetPid: number }).created =
    true;
  (controller as unknown as { created: boolean; targetPid: number }).targetPid =
    55;

  assert.equal(controller.activate(55), false);
  assert.deepEqual(writes, []);
});

test("a disabled live policy rejects even a forged ready record", async () => {
  const writes: Array<[number, boolean]> = [];
  let injectionAttempts = 0;
  let statusReads = 0;
  const controller = new OverlayInputGateController({
    authorized: () => false,
    create: () => true,
    set: (pid, blocked) => {
      writes.push([pid, blocked]);
      return true;
    },
    inject: async () => {
      injectionAttempts += 1;
      return false;
    },
    status: () => {
      statusReads += 1;
      return gateStatus(55, {
        ready: true,
        readyPid: 55,
        readyGeneration: 7,
        capabilityMask: OVERLAY_INPUT_REQUIRED_CAPABILITIES,
      });
    },
  });

  controller.initialize();
  controller.setTarget(55, "creation-a");
  assert.deepEqual(await controller.waitUntilReady(55, 10, 1), {
    ready: false,
    reason: "unavailable",
    status: null,
  });
  assert.equal(controller.inspect(55).ready, false);
  assert.equal(controller.activate(55), false);
  assert.equal(injectionAttempts, 0);
  assert.equal(statusReads, 0);
  assert.equal(
    writes.some(([pid, blocked]) => pid === 55 && blocked),
    false
  );
});

test(
  "the injected Win32 gate neutralizes a real input poll and restores it",
  { skip: process.platform !== "win32" },
  async (context) => {
    const fixturePath = path.resolve(
      "native/hydra-native/target/release/input-gate-fixture.exe"
    );
    const hookPath = path.resolve("hydra-native/gamehub-inputhook.dll");
    const addonPath = path.resolve("hydra-native/hydra-native.node");
    assert.equal(fs.existsSync(fixturePath), true, "native fixture is missing");
    assert.equal(fs.existsSync(hookPath), true, "input hook is missing");

    const native = require(addonPath) as {
      createOverlayInputGate(): boolean;
      setOverlayInputGate(pid: number, blocked: boolean): boolean;
      getOverlayInputGateStatus?: (pid: number) => OverlayInputGateNativeStatus;
      getProcessCreationTimeTicks?: (pid: number) => string | null;
      injectInputHook(
        pid: number,
        dllPath: string,
        expectedCreationTicks: string
      ): { injected: boolean; stage: string; errorCode: number };
    };
    const getGateStatus = native.getOverlayInputGateStatus;
    if (
      typeof getGateStatus !== "function" ||
      typeof native.getProcessCreationTimeTicks !== "function"
    ) {
      context.skip(
        "native addon has not been rebuilt with gate status support"
      );
      return;
    }
    const fixture = spawn(fixturePath, [], { stdio: ["pipe", "pipe", "pipe"] });
    const lines = createInterface({ input: fixture.stdout });
    const pending: Array<(line: string) => void> = [];
    const buffered: string[] = [];
    lines.on("line", (line) => {
      const resolve = pending.shift();
      if (resolve) resolve(line);
      else buffered.push(line);
    });
    const nextLine = () =>
      buffered.length
        ? Promise.resolve(buffered.shift()!)
        : new Promise<string>((resolve) => pending.push(resolve));

    let targetPid = 0;
    try {
      const ready = (await nextLine()).split("\t");
      assert.equal(ready[0], "READY");
      targetPid = Number(ready[1]);
      if (ready[2] !== "1") {
        context.skip(
          "the current Windows session does not permit synthetic keyboard input"
        );
        return;
      }
      assert.equal(native.createOverlayInputGate(), true);
      assert.equal(native.setOverlayInputGate(targetPid, false), true);

      const creationTicks = native.getProcessCreationTimeTicks(targetPid);
      assert.ok(creationTicks, "fixture process identity is unavailable");
      assert.deepEqual(
        native.injectInputHook(
          targetPid,
          hookPath,
          (BigInt(creationTicks) + 1n).toString()
        ),
        { injected: false, stage: "identity", errorCode: 0 },
        "a PID with the wrong creation identity must never be injected"
      );
      const injection = native.injectInputHook(
        targetPid,
        hookPath,
        creationTicks
      );
      assert.deepEqual(injection, {
        injected: true,
        stage: "ok",
        errorCode: 0,
      });
      const readinessDeadline = Date.now() + 5_000;
      let gateReadiness = getGateStatus(targetPid);
      while (!gateReadiness.ready && Date.now() < readinessDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        gateReadiness = getGateStatus(targetPid);
      }
      assert.equal(gateReadiness.ready, true, "hook handshake timed out");
      assert.equal(
        gateReadiness.capabilityMask & OVERLAY_INPUT_REQUIRED_CAPABILITIES,
        OVERLAY_INPUT_REQUIRED_CAPABILITIES
      );
      assert.equal(gateReadiness.unsupportedModuleMask, 0);

      fixture.stdin.write("status\n");
      const status = (await nextLine()).split("\t");
      assert.deepEqual(
        status.slice(0, 3),
        ["STATUS", "1", "1"],
        `native hook status ${status[3] ?? "missing"}`
      );

      fixture.stdin.write("poll\n");
      assert.equal(await nextLine(), "POLL\t1");
      assert.equal(native.setOverlayInputGate(targetPid, true), true);
      fixture.stdin.write("poll\n");
      assert.equal(await nextLine(), "POLL\t0");
      assert.equal(
        native.setOverlayInputGate(targetPid, true),
        true,
        "repeated activation must be idempotent without pulsing the latch"
      );
      fixture.stdin.write("poll\n");
      assert.equal(await nextLine(), "POLL\t0");
      assert.equal(native.setOverlayInputGate(0, false), true);
      assert.equal(getGateStatus(targetPid).ready, false);
      fixture.stdin.write("poll\n");
      assert.equal(await nextLine(), "POLL\t1");
    } finally {
      native.setOverlayInputGate(0, false);
      fixture.stdin.write("exit\n");
      await new Promise<void>((resolve) => {
        fixture.once("exit", () => resolve());
        setTimeout(() => {
          fixture.kill();
          resolve();
        }, 2_000).unref();
      });
      lines.close();
    }
  }
);
