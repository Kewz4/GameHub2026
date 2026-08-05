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
} from "../../src/main/services/overlay-game-process-ranking.ts";
import { OverlayInputGateController } from "../../src/main/services/overlay-input-gate.ts";

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

test("blocks only after the prepared overlay is visible and focused", async () => {
  const writes: Array<[number, boolean]> = [];
  let finishInjection: (ready: boolean) => void = () => undefined;
  const controller = new OverlayInputGateController({
    create: () => true,
    set: (pid, blocked) => {
      writes.push([pid, blocked]);
      return true;
    },
    inject: () =>
      new Promise<boolean>((resolve) => {
        finishInjection = resolve;
      }),
  });

  controller.initialize();
  controller.setTarget(42);
  controller.setOverlayState(true, false);
  assert.equal(
    writes.some(([pid, blocked]) => pid === 42 && blocked),
    false
  );
  controller.setOverlayState(true, true);
  assert.equal(
    writes.some(([pid, blocked]) => pid === 42 && blocked),
    false
  );

  finishInjection(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(writes.at(-1), [42, true]);

  controller.setOverlayState(false, false);
  assert.deepEqual(writes.at(-1), [0, false]);
  controller.dispose();
  assert.deepEqual(writes.at(-1), [0, false]);
});

test("a stale injection cannot block a new target", async () => {
  const writes: Array<[number, boolean]> = [];
  const injections = new Map<number, (ready: boolean) => void>();
  const controller = new OverlayInputGateController({
    create: () => true,
    set: (pid, blocked) => {
      writes.push([pid, blocked]);
      return true;
    },
    inject: (pid) =>
      new Promise<boolean>((resolve) => injections.set(pid, resolve)),
  });

  controller.initialize();
  controller.setTarget(10);
  controller.setOverlayState(true, true);
  controller.setTarget(20);
  injections.get(10)?.(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    writes.some(([pid, blocked]) => pid === 10 && blocked),
    false
  );

  injections.get(20)?.(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(writes.at(-1), [20, true]);
  controller.setTarget(0);
  assert.deepEqual(writes.at(-1), [0, false]);
});

test(
  "the injected Win32 gate neutralizes a real input poll and restores it",
  { skip: process.platform !== "win32" },
  async () => {
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
      injectInputHook(
        pid: number,
        dllPath: string
      ): { injected: boolean; stage: string; errorCode: number };
    };
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
      assert.equal(ready[2], "1", "synthetic F24 press was not visible");
      assert.equal(native.createOverlayInputGate(), true);
      assert.equal(native.setOverlayInputGate(0, false), true);

      const injection = native.injectInputHook(targetPid, hookPath);
      assert.deepEqual(injection, {
        injected: true,
        stage: "ok",
        errorCode: 0,
      });
      await new Promise((resolve) => setTimeout(resolve, 2_300));

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
      assert.equal(native.setOverlayInputGate(0, false), true);
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
