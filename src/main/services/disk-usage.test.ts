import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { getDiskUsage } from "./disk-usage";

const testRoot = await fs.mkdtemp(
  path.join(os.tmpdir(), "gamehub-disk-usage-")
);

after(async () => {
  await fs.rm(testRoot, { recursive: true, force: true });
});

describe("getDiskUsage", () => {
  it("reads an existing filesystem without a shell subprocess", async () => {
    const usage = await getDiskUsage(testRoot);

    assert.ok(usage);
    assert.ok(usage.total > 0);
    assert.ok(usage.free >= 0);
    assert.ok(usage.free <= usage.total);
  });

  it("measures the first existing parent for a not-yet-created folder", async () => {
    const usage = await getDiskUsage(
      path.join(testRoot, "future", "nested", "download")
    );

    assert.ok(usage);
    assert.ok(usage.total > 0);
  });
});
