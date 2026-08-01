import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  decodePresentMonTextChunk,
  parseCsvRow,
  parsePresentMonSample,
  resolvePresentMonFrameTimeColumns,
} from "../../src/main/services/overlay-performance-metrics.ts";

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
