import assert from "node:assert/strict";
import test from "node:test";

import { canDiscardDownload } from "../../../types/download-contract";
import type { Download } from "../../../types/level.types";

import { discardDownloadEntryIfSafe } from "./download-entry-retention";

const makeDownload = (overrides: Partial<Download> = {}): Download => ({
  shop: "steam",
  objectId: "2651280",
  uri: "https://example.invalid/game.zip",
  folderName: null,
  downloadPath: "C:\\Games",
  progress: 0,
  downloader: 0 as Download["downloader"],
  bytesDownloaded: 0,
  fileSize: 100,
  shouldSeed: false,
  status: "paused",
  queued: false,
  timestamp: 1,
  extracting: false,
  automaticallyExtract: true,
  automaticallyDeleteArchiveFiles: false,
  ...overrides,
});

test("passive refresh preserves every download state that can own work", () => {
  const preserved = [
    makeDownload({ status: "active" }),
    makeDownload({ status: "extracting" }),
    makeDownload({ status: "complete", extracting: true }),
    makeDownload({ status: "paused", queued: true }),
    makeDownload({ status: "paused" }),
    makeDownload({ status: "error" }),
    makeDownload({ status: "waiting" }),
    makeDownload({ status: null }),
    makeDownload({ status: "seeding" }),
    makeDownload({ status: "complete", shouldSeed: true }),
  ];

  for (const download of preserved) {
    assert.equal(
      canDiscardDownload(download),
      false,
      `expected ${download.status ?? "null"} to be preserved`
    );
  }
});

test("passive refresh discards only terminal non-seeding history", () => {
  assert.equal(canDiscardDownload(makeDownload({ status: "complete" })), true);
  assert.equal(canDiscardDownload(makeDownload({ status: "removed" })), true);
});

test("safe discard removes the record before synchronizing layout", async () => {
  const operations: string[] = [];
  const download = makeDownload({ status: "complete" });

  const result = await discardDownloadEntryIfSafe(
    "steam:2651280",
    { shop: "steam", objectId: "2651280" },
    {
      read: async (key) => {
        operations.push(`read:${key}`);
        return download;
      },
      remove: async (key) => {
        operations.push(`remove:${key}`);
      },
      afterRemove: async ({ shop, objectId }) => {
        operations.push(`sync:${shop}:${objectId}`);
      },
    }
  );

  assert.equal(result, "discarded");
  assert.deepEqual(operations, [
    "read:steam:2651280",
    "remove:steam:2651280",
    "sync:steam:2651280",
  ]);
});

test("safe discard leaves active and missing records untouched", async () => {
  for (const download of [makeDownload({ status: "active" }), null]) {
    let removals = 0;
    let syncs = 0;

    const result = await discardDownloadEntryIfSafe(
      "steam:2651280",
      { shop: "steam", objectId: "2651280" },
      {
        read: async () => download,
        remove: async () => {
          removals += 1;
        },
        afterRemove: async () => {
          syncs += 1;
        },
      }
    );

    assert.equal(result, download ? "preserved" : "missing");
    assert.equal(removals, 0);
    assert.equal(syncs, 0);
  }
});
