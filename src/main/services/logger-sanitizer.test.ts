import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  AxiosError,
  AxiosHeaders,
  type InternalAxiosRequestConfig,
} from "axios";
import electronLog from "electron-log/node";

import { sanitizeLogMessageBeforeTransport } from "./logger-sanitizer";

test("electron-log file transport never receives nested Axios secrets", () => {
  const temporaryDirectory = mkdtempSync(
    path.join(os.tmpdir(), "gamehub-log-redaction-")
  );
  const logPath = path.join(temporaryDirectory, "redaction.log");
  const sentinel = "transport-secret-sentinel";
  const logger = electronLog.create({
    logId: `redaction-test-${process.pid}-${Date.now()}`,
  });

  try {
    logger.transports.console.level = false;
    logger.transports.file.level = "silly";
    logger.transports.file.sync = true;
    logger.transports.file.resolvePathFn = () => logPath;
    logger.hooks.push(sanitizeLogMessageBeforeTransport);

    const request: Record<string, unknown> = { path: "/cloud/saves/1817190" };
    const config = {
      url: `https://r2.example.test/cloud/saves/1817190?X-Amz-Security-Token=${sentinel}&safe=kept`,
      method: "get",
      data: JSON.stringify({
        token: sentinel,
        downloadToken: sentinel,
        steamWebApiKey: sentinel,
        safe: "kept-body",
      }),
      headers: AxiosHeaders.from({
        Authorization: `Bearer ${sentinel}`,
        Cookie: `session=${sentinel}`,
        "x-amz-security-token": sentinel,
      }),
    } as InternalAxiosRequestConfig;
    const error = new AxiosError(
      "Cloud request failed",
      AxiosError.ERR_BAD_RESPONSE,
      config,
      request,
      {
        data: { access_token: sentinel },
        status: 503,
        statusText: "Service Unavailable",
        headers: AxiosHeaders.from({ "retry-after": "2" }),
        config,
        request,
      }
    );
    request.error = error;

    logger.error("CloudSaveV2 request failure", error);

    const persisted = readFileSync(logPath, "utf8");
    assert.doesNotMatch(persisted, new RegExp(sentinel, "g"));
    assert.match(persisted, /\[redacted\]/);
    assert.match(persisted, /ERR_BAD_RESPONSE/);
    assert.match(persisted, /503/);
    assert.match(persisted, /cloud[\\/]saves[\\/]1817190/);
    assert.match(persisted, /kept-body/);
    assert.match(persisted, /\[Circular\]/);
  } finally {
    logger.transports.file.level = false;
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
