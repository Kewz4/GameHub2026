import { test } from "node:test";
import assert from "node:assert/strict";
import { getLauncherInvocation } from "./launcher-invocation";

test("Linux launcher zipapps use an explicit compatible interpreter and preserve argv", () => {
  const invocation = getLauncherInvocation(
    "/home/Alex Smith/legendary",
    ["install", "game-id", "--base-path", "/games/Space Name"],
    { PATH: "/python39/bin", PYTHONHOME: "/python39", PYTHONPATH: "/old" },
    {
      platform: "linux",
      header: () => "#!/usr/bin/env python3\nPK",
      python: () => "/usr/bin/python3",
    }
  );
  assert.equal(invocation.command, "/usr/bin/python3");
  assert.deepEqual(invocation.args, [
    "/home/Alex Smith/legendary",
    "install",
    "game-id",
    "--base-path",
    "/games/Space Name",
  ]);
  assert.equal(invocation.env.PYTHONHOME, undefined);
  assert.equal(invocation.env.PYTHONPATH, undefined);
});
test("native executables and Windows helpers are not sent to Python", () => {
  for (const platform of ["win32", "linux"] as const) {
    const result = getLauncherInvocation(
      "/helper",
      ["--version"],
      {},
      {
        platform,
        header: () => "\x7fELF",
        python: () => assert.fail("must not run"),
      }
    );
    assert.equal(result.command, "/helper");
    assert.deepEqual(result.args, ["--version"]);
  }
});
