import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { listEmulationSaveR2Index } from "./emulation-save-r2-index";

describe("emulation-save R2 index", () => {
  it("paginates, deduplicates, rejects malformed keys and bounds HEAD work", async () => {
    const prefix = "users/account/emulation-saves/ps2/";
    const first = `${prefix}SLUS-1/one.psu`;
    const second = `${prefix}SLUS-2/two.psu`;
    const third = `${prefix}SLUS-3/three.psu`;
    let active = 0;
    let maximumActive = 0;
    const loaded: string[] = [];

    const result = await listEmulationSaveR2Index({
      prefix,
      relativeSegmentCount: 2,
      headConcurrency: 2,
      listPage: async (token) =>
        token
          ? {
              objects: [
                { key: first },
                { key: third, size: 3, lastModified: new Date(3) },
                { key: `${prefix}nested/not/a-save.psu` },
              ],
              isTruncated: false,
            }
          : {
              objects: [
                { key: first, size: 1, lastModified: new Date(1) },
                { key: second, size: 2, lastModified: new Date(2) },
                { key: "users/other/emulation-saves/ps2/SLUS/bad.psu" },
              ],
              isTruncated: true,
              nextContinuationToken: "page-2",
            },
      loadMetadata: async (key) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        loaded.push(key);
        await Promise.resolve();
        active -= 1;
        return key === second ? null : { platform: "ps2" };
      },
    });

    assert.equal(maximumActive, 2);
    assert.deepEqual(new Set(loaded), new Set([first, second, third]));
    assert.deepEqual(
      result.map((entry) => entry.key).sort(),
      [first, third].sort()
    );
  });

  it("fails closed for broken pagination and excessive listings", async () => {
    await assert.rejects(
      listEmulationSaveR2Index({
        prefix: "users/account/emulation-saves/",
        relativeSegmentCount: 3,
        listPage: async () => ({
          objects: [],
          isTruncated: true,
          nextContinuationToken: "same-token",
        }),
        loadMetadata: async () => ({}),
      }),
      /emulation_save_index_invalid_page/
    );

    await assert.rejects(
      listEmulationSaveR2Index({
        prefix: "users/account/emulation-saves/",
        relativeSegmentCount: 3,
        maxObjects: 1,
        listPage: async () => ({
          objects: [
            { key: "users/account/emulation-saves/ps1/A/one.mcs" },
            { key: "users/account/emulation-saves/ps2/B/two.psu" },
          ],
          isTruncated: false,
        }),
        loadMetadata: async () => ({}),
      }),
      /emulation_save_index_too_many_objects/
    );
  });
});
