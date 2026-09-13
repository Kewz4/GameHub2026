import assert from "node:assert/strict";
import test from "node:test";
import { shouldReconnectDownloadAfterNetworkStatus } from "./download-network-policy";

test("ignores duplicate online notifications from Chromium connection estimates", () => {
  assert.equal(
    shouldReconnectDownloadAfterNetworkStatus({
      wasOnline: true,
      online: true,
    }),
    false
  );
});

test("reconnects after a real outage or power resume", () => {
  assert.equal(
    shouldReconnectDownloadAfterNetworkStatus({
      wasOnline: false,
      online: true,
    }),
    true
  );
  assert.equal(
    shouldReconnectDownloadAfterNetworkStatus({
      wasOnline: true,
      online: true,
      forceReconnect: true,
    }),
    true
  );
});
