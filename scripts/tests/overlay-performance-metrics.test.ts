import { strict as assert } from "node:assert";
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
