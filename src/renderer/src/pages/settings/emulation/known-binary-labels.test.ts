import assert from "node:assert/strict";
import { test } from "node:test";
import { getKnownBinaryLabel } from "./known-binary-labels";

test("Linux uses native RetroArch while retaining the cross-platform binary identity", () => {
  assert.equal(getKnownBinaryLabel("ralibretro", "linux"), "RetroArch");
  assert.equal(getKnownBinaryLabel("ralibretro", "win32"), "RALibretro");
  assert.equal(getKnownBinaryLabel("pcsx2", "linux"), "PCSX2");
});
