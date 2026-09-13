const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { reuseVerifiedBinary } = require("../download-launcher-binaries.cjs");

const bytes = Buffer.from("verified helper fixture");
const digest = crypto.createHash("sha256").update(bytes).digest("hex");

test("a verified Linux/macOS binary cache hit restores executable permissions", () => {
  for (const platform of ["linux", "darwin"]) {
    const changes = [];
    assert.equal(
      reuseVerifiedBinary("/cache/helper", digest, platform, {
        existsSync: () => true,
        readFileSync: () => bytes,
        chmodSync: (...args) => changes.push(args),
      }),
      true
    );
    assert.deepEqual(changes, [["/cache/helper", 0o755]]);
  }
});

test("a missing or corrupt cached helper is never reused or chmodded", () => {
  for (const exists of [false, true]) {
    assert.equal(
      reuseVerifiedBinary("/cache/helper", digest, "linux", {
        existsSync: () => exists,
        readFileSync: () => Buffer.from("corrupt"),
        chmodSync: () =>
          assert.fail("Unverified cache must not become executable"),
      }),
      false
    );
  }
});

test("Windows cache does not receive Unix mode changes and failed Linux repairs fail loudly", () => {
  assert.equal(
    reuseVerifiedBinary("helper.exe", digest, "win32", {
      existsSync: () => true,
      readFileSync: () => bytes,
      chmodSync: () => assert.fail("Windows does not use executable mode"),
    }),
    true
  );
  assert.throws(
    () =>
      reuseVerifiedBinary("/cache/helper", digest, "linux", {
        existsSync: () => true,
        readFileSync: () => bytes,
        chmodSync: () => {
          throw new Error("Permission denied");
        },
      }),
    /Permission denied/
  );
});
