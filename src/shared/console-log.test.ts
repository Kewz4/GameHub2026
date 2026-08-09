import assert from "node:assert/strict";
import test from "node:test";

import {
  consoleLogChannelOf,
  formatConsoleLogData,
  redactConsoleLogText,
} from "./console-log";

test("routes nested tags and important unscoped messages", () => {
  assert.equal(
    consoleLogChannelOf({
      scope: "main",
      text: "[DownloadManager] [JsHttpDownloader] Range header ignored",
    }),
    "downloads"
  );
  assert.equal(
    consoleLogChannelOf({
      scope: "main",
      text: "PresentMon capture session started",
    }),
    "overlay"
  );
  assert.equal(
    consoleLogChannelOf({ scope: "achievements", text: "sync complete" }),
    "achievements"
  );
  assert.equal(
    consoleLogChannelOf({
      scope: "main",
      text: "generateMissingMetadata: repaired ARK",
    }),
    "library"
  );
  assert.equal(
    consoleLogChannelOf({
      scope: "main",
      text: "[CloudSaveV2] snapshot upload completed",
    }),
    "cloud"
  );
});

test("formats Error, bigint, and circular values without dropping details", () => {
  const circular: Record<string, unknown> = { value: 1n };
  circular.self = circular;
  const text = formatConsoleLogData([
    "failed",
    new Error("network unavailable"),
    circular,
  ]);
  assert.match(text, /network unavailable/);
  assert.match(text, /1n/);
  assert.match(text, /\[Circular\]/);
});

test("redacts common secrets in headers, JSON-like text, and URLs", () => {
  const output = redactConsoleLogText(
    'Bearer abc.def accessToken=hello password:\'nope\' {"refreshToken":"json-secret"} https://name:url-secret@x.test/a?api_key=secret&x-amz-signature=signed&safe=1'
  );
  assert.doesNotMatch(
    output,
    /abc\.def|hello|nope|json-secret|url-secret|api_key=secret|signature=signed/
  );
  assert.match(output, /Bearer \[redacted\]/);
  assert.match(output, /safe=1/);
});
