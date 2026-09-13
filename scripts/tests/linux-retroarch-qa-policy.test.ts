import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import {
  buildIsolatedRetroArchEnvironment,
  classifyRetroArchQaFailure,
  requireRetroArchCiOptIn,
} from "../qa-linux-retroarch-provisioning";

test("native RetroArch smoke requires all CI/nonroot/Linux opt-ins", () => {
  const valid = {
    platform: "linux" as const,
    enabled: "1",
    githubActions: "true",
    ci: "true",
    uid: 1001,
  };
  assert.doesNotThrow(() => requireRetroArchCiOptIn(valid));
  for (const overrides of [
    { platform: "win32" as const },
    { enabled: "" },
    { githubActions: "false" },
    { ci: "false" },
    { uid: 0 },
  ]) {
    assert.throws(
      () => requireRetroArchCiOptIn({ ...valid, ...overrides }),
      /No installation was attempted/
    );
  }
});

test("child environment never mutates parent HOME or inherits account/Flatpak settings", () => {
  const parent = {
    PATH: "/usr/bin",
    HOME: "/home/real-user",
    XDG_DATA_HOME: "/real/data",
    GITHUB_TOKEN: "not-inherited",
    FLATPAK_USER_DIR: "/real/flatpak",
    NODE_OPTIONS: "--require=unsafe",
    DISPLAY: ":99",
    DBUS_SESSION_BUS_ADDRESS: "unix:path=/tmp/test-bus",
  };
  const before = { ...parent };
  const isolated = buildIsolatedRetroArchEnvironment(
    "/tmp/test-profile",
    parent
  );
  assert.deepEqual(parent, before);
  assert.equal(isolated.HOME, path.join("/tmp/test-profile", "home"));
  assert.equal(
    isolated.FLATPAK_USER_DIR,
    path.join("/tmp/test-profile", "data", "flatpak")
  );
  assert.equal(isolated.GITHUB_TOKEN, undefined);
  assert.equal(isolated.DISPLAY, ":99");
  assert.equal(isolated.NODE_OPTIONS, "--max-old-space-size=4096");
});

test("runtime namespace/network denial is reported without disguising code failures", () => {
  assert.equal(
    classifyRetroArchQaFailure(
      "bwrap: Creating new namespace failed: Operation not permitted"
    ),
    "external-runtime-blocked"
  );
  assert.equal(
    classifyRetroArchQaFailure("TLS connection timed out"),
    "external-runtime-blocked"
  );
  assert.equal(
    classifyRetroArchQaFailure("core ELF architecture assertion failed"),
    "failed"
  );
});
