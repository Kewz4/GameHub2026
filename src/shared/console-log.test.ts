import assert from "node:assert/strict";
import test from "node:test";
import {
  AxiosError,
  AxiosHeaders,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";

import {
  consoleLogChannelOf,
  formatConsoleLogData,
  redactConsoleLogText,
  sanitizeConsoleLogValue,
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
    'Bearer abc.def accessToken=hello password:\'nope\' {"refreshToken":"json-secret","token":"body-secret","downloadToken":"download-secret","steamWebApiKey":"steam-secret"} https://name:url-secret@x.test/a?api_key=secret&key=generic-api-key&x-amz-signature=signed&x-amz-security-token=temporary&safe=1'
  );
  assert.doesNotMatch(
    output,
    /abc\.def|hello|nope|json-secret|body-secret|download-secret|steam-secret|url-secret|api_key=secret|generic-api-key|signature=signed|security-token=temporary/
  );
  assert.match(output, /Bearer \[redacted\]/);
  assert.match(output, /safe=1/);
});

test("recursively sanitizes a real circular AxiosError before transport", () => {
  const jwt = [
    "eyJhbGciOiJIUzI1NiJ9",
    "eyJ1c2VySWQiOiJzZWNyZXQtdXNlciJ9",
    "signature123",
  ].join(".");
  const request: Record<string, unknown> = { method: "POST" };
  const config = {
    url: `https://r2.example.test/cloud/save?X-Amz-Credential=credential-sentinel&X-Amz-Signature=signature-sentinel&X-Amz-Security-Token=security-sentinel&safe=1`,
    method: "post",
    headers: AxiosHeaders.from({
      Authorization: `Bearer ${jwt}`,
      Cookie: "session=cookie-sentinel",
      "x-amz-security-token": "header-security-sentinel",
      "Content-Type": "application/json",
    }),
    data: {
      refreshToken: "refresh-sentinel",
      api_key: "api-sentinel",
      safe: "retained",
    },
  } as InternalAxiosRequestConfig;
  const response = {
    data: { reason: "denied" },
    status: 401,
    statusText: "Unauthorized",
    headers: AxiosHeaders.from({ "content-type": "application/json" }),
    config,
    request,
  } satisfies AxiosResponse;
  const error = new AxiosError(
    `Request failed with Bearer ${jwt}`,
    AxiosError.ERR_BAD_REQUEST,
    config,
    request,
    response
  );
  request.error = error;

  const sanitized = sanitizeConsoleLogValue(error);
  const text = JSON.stringify(sanitized);

  assert.doesNotMatch(
    text,
    /secret-user|signature123|cookie-sentinel|refresh-sentinel|api-sentinel|credential-sentinel|signature-sentinel|security-sentinel|header-security-sentinel/
  );
  assert.match(text, /ERR_BAD_REQUEST/);
  assert.match(text, /Request failed/);
  assert.match(text, /Content-Type/);
  assert.match(text, /retained/);
  assert.match(text, /cloud\\?\/save|cloud\/save/);
  assert.match(text, /401/);
  assert.match(text, /safe=1/);
  assert.match(text, /\[Circular\]/);
  assert.match(text, /\[redacted/);
});

test("redacts generic OAuth callback secrets without hiding benign codes", () => {
  const output = redactConsoleLogText(
    "https://auth.example.test/oauth/callback?code=oauth-sentinel&state=kept-state https://api.example.test/games?code=ARK&token_count=3"
  );

  assert.doesNotMatch(output, /oauth-sentinel/);
  assert.match(output, /code=\[redacted\]/);
  assert.match(output, /code=ARK/);
  assert.match(output, /token_count=3/);
});

test("does not mutate source log objects while redacting nested key variants", () => {
  const source = {
    torBoxApiToken: "uuid-shaped-token",
    token: "generic-token",
    downloadToken: "download-token",
    nested: new Map<string, unknown>([
      ["x-amz-signature", "signed-value"],
      ["status", 401],
    ]),
  };

  const sanitized = sanitizeConsoleLogValue(source) as Record<string, unknown>;
  assert.equal(source.torBoxApiToken, "uuid-shaped-token");
  assert.equal(sanitized.torBoxApiToken, "[redacted]");
  assert.equal(sanitized.token, "[redacted]");
  assert.equal(sanitized.downloadToken, "[redacted]");
  assert.deepEqual(sanitized.nested, {
    "x-amz-signature": "[redacted]",
    status: 401,
  });
});
