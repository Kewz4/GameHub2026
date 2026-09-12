const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { Readable } = require("node:stream");
const { validateAsset, downloadReleaseAsset } = require("./download.js");
const content = Buffer.from("verified GameHub release bytes");
const asset = {
  name: "GameHub-setup.exe",
  size: content.length,
  url: "https://api.github.com/repos/Kewz4/GameHub2026/releases/assets/123",
  digest: `sha256:${crypto.createHash("sha256").update(content).digest("hex")}`,
};

test("download completes only after size and checksum verification", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gamehub-setup-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const target = path.join(dir, asset.name);
  const progress = [];
  await downloadReleaseAsset(
    asset,
    target,
    async () => Readable.from([content]),
    (value) => progress.push(value)
  );
  assert.deepEqual(await fs.readFile(target), content);
  assert.equal(progress.at(-1).percent, 100);
});

for (const [name, payload, metadata] of [
  ["truncated", content.subarray(0, 5), asset],
  ["corrupt", Buffer.alloc(content.length), asset],
  ["oversized", Buffer.concat([content, content]), asset],
])
  test(`rejects ${name} downloads and removes partial output`, async (t) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gamehub-setup-test-"));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const target = path.join(dir, asset.name);
    await assert.rejects(
      downloadReleaseAsset(metadata, target, async () =>
        Readable.from([payload])
      )
    );
    assert.deepEqual(await fs.readdir(dir), []);
  });

test("rejects path traversal, other repositories and invalid sizes", () => {
  for (const patch of [
    { name: "../setup.exe" },
    { name: "C:\\setup.exe" },
    { url: "https://api.github.com/repos/other/app/releases/assets/123" },
    { url: "https://example.com/setup.exe" },
    { size: 0 },
  ]) {
    assert.throws(() => validateAsset({ ...asset, ...patch }));
  }
});
