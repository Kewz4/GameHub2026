import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getLauncherBinaryRelease,
  verifyLauncherBinary,
  findExecutableOnPath,
} from "./launcher-binary";

test("launcher downloads are bound to both OS and CPU architecture", () => {
  for (const tool of ["legendary", "gogdl"] as const) {
    for (const arch of ["x64", "arm64"]) {
      const linux = getLauncherBinaryRelease(tool, "linux", arch);
      assert.match(linux.name, /linux/);
      assert.doesNotMatch(linux.name, /\.exe$/);
      assert.match(linux.sha256, /^[a-f0-9]{64}$/);
      assert.match(
        getLauncherBinaryRelease(tool, "win32", arch).name,
        /windows.*\.exe$/
      );
      assert.throws(() => getLauncherBinaryRelease(tool, "linux", "ia32"));
    }
  }
});
test("binary integrity refuses partial or wrong-platform bytes", () => {
  const bytes = Buffer.from("verified Linux binary");
  const hash = crypto.createHash("sha256").update(bytes).digest("hex");
  assert.doesNotThrow(() => verifyLauncherBinary(bytes, hash));
  assert.throws(
    () => verifyLauncherBinary(Buffer.from("wrong"), hash),
    /checksum/
  );
});
test("PATH discovery handles spaces without invoking a shell or destructuring stdout from a string", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "launcher path "));
  try {
    const file = path.join(
      directory,
      process.platform === "win32" ? "legendary.exe" : "legendary"
    );
    fs.writeFileSync(file, "fixture", { mode: 0o755 });
    assert.equal(findExecutableOnPath("legendary", { PATH: directory }), file);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
