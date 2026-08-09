import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import { formatLocalPathForDisplay } from "./path-presentation.ts";

describe("local path presentation", () => {
  it("hides slash-form Windows extended prefixes", () => {
    assert.equal(
      formatLocalPathForDisplay("//?/C:/Users/GameHub/Saves/slot.dat"),
      "C:\\Users\\GameHub\\Saves\\slot.dat"
    );
  });

  it("hides backslash-form Windows extended prefixes", () => {
    assert.equal(
      formatLocalPathForDisplay("\\\\?\\C:\\Users\\GameHub\\Saves\\slot.dat"),
      "C:\\Users\\GameHub\\Saves\\slot.dat"
    );
  });

  it("presents extended UNC paths as standard UNC paths", () => {
    assert.equal(
      formatLocalPathForDisplay("\\\\?\\UNC\\server\\share\\Saves"),
      "\\\\server\\share\\Saves"
    );
    assert.equal(
      formatLocalPathForDisplay("//?/UNC/server/share/Saves"),
      "\\\\server\\share\\Saves"
    );
  });

  it("does not change Unix or relative paths", () => {
    assert.equal(
      formatLocalPathForDisplay("/home/gamehub/saves/slot.dat"),
      "/home/gamehub/saves/slot.dat"
    );
    assert.equal(
      formatLocalPathForDisplay("profiles/one/slot.dat"),
      "profiles/one/slot.dat"
    );
  });
});
