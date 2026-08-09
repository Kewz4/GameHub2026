import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CloudSaveV2LibraryEntry, GameShop } from "@types";

import type { R2CloudSaveV2Head } from "./r2-snapshot-contract.js";
import {
  listCloudSaveV2LibraryIndex,
  mergeCloudSaveV2LibraryMetadata,
  parseCloudSaveV2ControlKey,
} from "./cloud-save-v2-library-index.js";

const shops: GameShop[] = [
  "steam",
  "epic",
  "gog",
  "battlenet",
  "xbox",
  "riot",
  "ubisoft",
  "ea",
  "launchbox",
  "custom",
];
const prefix = "users/account/cloud-saves-v2/";
const hash = "a".repeat(64);

const controlKey = (shop: GameShop, objectId: string) =>
  `${prefix}${encodeURIComponent(shop)}/${encodeURIComponent(objectId)}/control.json`;

const activeHead = (
  shop: GameShop,
  objectId: string,
  updatedAt = "2026-01-01T00:00:00.000Z"
): R2CloudSaveV2Head => {
  const snapshot = {
    id: `snapshot-${shop}-${objectId}`,
    version: 1,
    shop,
    objectId,
    createdAt: updatedAt,
    updatedAt,
    fileCount: 0,
    totalSizeBytes: 0,
    aggregateHash: hash,
    epoch: 0,
  };
  return {
    control: {
      schemaVersion: 1,
      revision: 1,
      epoch: 0,
      status: "active",
      deleteOperationId: null,
      snapshot,
      updatedAt,
    },
    document: {
      schemaVersion: 1,
      snapshot,
      customPathRawPaths: [],
      variants: [],
      files: [],
    },
    etag: "etag",
  };
};

describe("Cloud Save V2 library R2 index", () => {
  it("accepts only canonical control keys for every GameHub shop", () => {
    for (const shop of shops) {
      const objectId = `${shop}/game id`;
      assert.deepEqual(
        parseCloudSaveV2ControlKey(prefix, controlKey(shop, objectId)),
        {
          shop,
          objectId,
          controlKey: controlKey(shop, objectId),
        }
      );
    }

    for (const key of [
      `${prefix}%73team/game/control.json`,
      `${prefix}steam/%67ame/control.json`,
      `${prefix}steam/game%2fid/control.json`,
      `${prefix}itch/game/control.json`,
      `${prefix}steam/%E0%A4%A/control.json`,
      `${prefix}steam//control.json`,
      `${prefix}steam/game/extra/control.json`,
      `users/other/cloud-saves-v2/steam/game/control.json`,
    ]) {
      assert.equal(parseCloudSaveV2ControlKey(prefix, key), null, key);
    }
  });

  it("paginates, deduplicates and loads all shops with bounded concurrency", async () => {
    const keys = shops.map((shop) => controlKey(shop, `${shop}-game`));
    let activeLoads = 0;
    let maximumActiveLoads = 0;
    const loaded = new Map<string, number>();
    const entries = await listCloudSaveV2LibraryIndex({
      prefix,
      listPage: async (token) =>
        token === undefined
          ? {
              keys: [
                ...keys.slice(0, 5),
                `${prefix}%73team/duplicate/control.json`,
                `${prefix}invalid/game/control.json`,
                `${prefix}steam/game/snapshots/1.json`,
              ],
              isTruncated: true,
              nextContinuationToken: "page-2",
            }
          : {
              keys: [...keys.slice(5), keys[0]],
              isTruncated: false,
            },
      loadConcurrency: 3,
      loadHead: async ({ shop, objectId }) => {
        const key = `${shop}:${objectId}`;
        loaded.set(key, (loaded.get(key) ?? 0) + 1);
        activeLoads += 1;
        maximumActiveLoads = Math.max(maximumActiveLoads, activeLoads);
        await new Promise((resolve) => setTimeout(resolve, 2));
        activeLoads -= 1;
        const day = shops.indexOf(shop) + 1;
        return activeHead(
          shop,
          objectId,
          new Date(Date.UTC(2026, 0, day)).toISOString()
        );
      },
    });

    assert.equal(entries.length, shops.length);
    assert.deepEqual(new Set(entries.map(({ shop }) => shop)), new Set(shops));
    assert.ok(maximumActiveLoads <= 3);
    assert.ok(maximumActiveLoads > 1);
    assert.equal(loaded.get("steam:steam-game"), 1);
    assert.equal(entries[0].shop, "custom");
  });

  it("fails closed on missing, repeated and over-limit pagination", async () => {
    await assert.rejects(
      listCloudSaveV2LibraryIndex({
        prefix,
        listPage: async () => ({ keys: [], isTruncated: true }),
        loadHead: async () => null,
      }),
      /cloud_save_library_invalid_page/
    );

    await assert.rejects(
      listCloudSaveV2LibraryIndex({
        prefix,
        listPage: async () => ({
          keys: [],
          isTruncated: true,
          nextContinuationToken: "same-token",
        }),
        loadHead: async () => null,
      }),
      /cloud_save_library_invalid_page/
    );

    await assert.rejects(
      listCloudSaveV2LibraryIndex({
        prefix,
        maxEntries: 1,
        listPage: async () => ({
          keys: [controlKey("steam", "1"), controlKey("gog", "2")],
          isTruncated: false,
        }),
        loadHead: async () => null,
      }),
      /cloud_save_library_too_many_entries/
    );
  });

  it("isolates dangling, corrupt and wrong-identity heads", async () => {
    const valid = activeHead("steam", "valid");
    const dangling = activeHead("steam", "dangling");
    dangling.document = null;
    const corrupt = activeHead("steam", "corrupt");
    if (!corrupt.document) throw new Error("fixture missing document");
    corrupt.document = {
      ...corrupt.document,
      snapshot: { ...corrupt.document.snapshot, objectId: "other" },
    };
    const wrongIdentity = activeHead("gog", "different");
    const invalid: string[] = [];
    const entries = await listCloudSaveV2LibraryIndex({
      prefix,
      listPage: async () => ({
        keys: [
          controlKey("steam", "valid"),
          controlKey("steam", "dangling"),
          controlKey("steam", "corrupt"),
          controlKey("gog", "wrong"),
          controlKey("epic", "throws"),
        ],
        isTruncated: false,
      }),
      loadHead: async ({ objectId }) => {
        if (objectId === "valid") return valid;
        if (objectId === "dangling") return dangling;
        if (objectId === "corrupt") return corrupt;
        if (objectId === "wrong") return wrongIdentity;
        throw new Error("corrupt remote JSON");
      },
      onInvalidEntry: ({ objectId }) => invalid.push(objectId),
    });

    assert.deepEqual(
      entries.map(({ objectId }) => objectId),
      ["valid"]
    );
    assert.deepEqual(invalid.sort(), [
      "corrupt",
      "dangling",
      "throws",
      "wrong",
    ]);
  });

  it("does not list an active empty head left by a completed deletion", async () => {
    const empty = activeHead("steam", "deleted");
    empty.control.snapshot = null;
    empty.document = null;
    const invalid: string[] = [];
    const entries = await listCloudSaveV2LibraryIndex({
      prefix,
      listPage: async () => ({
        keys: [controlKey("steam", "deleted")],
        isTruncated: false,
      }),
      loadHead: async () => empty,
      onInvalidEntry: ({ objectId }) => invalid.push(objectId),
    });

    assert.deepEqual(entries, []);
    assert.deepEqual(invalid, []);
  });

  it("adds local titles/icons and keeps deterministic updated ordering", () => {
    const newer = activeHead("gog", "newer", "2026-03-02T00:00:00.000Z");
    const older = activeHead("steam", "older", "2026-03-01T00:00:00.000Z");
    const toEntry = (head: R2CloudSaveV2Head): CloudSaveV2LibraryEntry => {
      if (!head.document) throw new Error("fixture missing document");
      const snapshot = head.document.snapshot;
      return {
        ...snapshot,
        gameTitle: snapshot.objectId,
        gameIconUrl: null,
      };
    };
    const merged = mergeCloudSaveV2LibraryMetadata(
      [toEntry(older), toEntry(newer)],
      [
        {
          shop: "steam",
          objectId: "older",
          title: "Local Steam title",
          iconUrl: "fallback.png",
          customIconUrl: "custom.png",
        },
      ]
    );

    assert.deepEqual(
      merged.map(({ shop, objectId }) => `${shop}:${objectId}`),
      ["gog:newer", "steam:older"]
    );
    assert.equal(merged[0].gameTitle, "newer");
    assert.equal(merged[0].gameIconUrl, null);
    assert.equal(merged[1].gameTitle, "Local Steam title");
    assert.equal(merged[1].gameIconUrl, "custom.png");
  });
});
