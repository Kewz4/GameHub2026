import assert from "node:assert/strict";
import test from "node:test";

import { resolveCloudSaveAppDataDir } from "./cloud-save-os-paths";

test("portable Electron app storage cannot redirect Windows save discovery", () => {
  assert.equal(
    resolveCloudSaveAppDataDir({
      platform: "windows",
      homeDir: "C:\\Users\\K",
      electronAppDataDir: "D:\\GameHub\\data",
      windowsAppDataDir: "C:\\Users\\K\\AppData\\Roaming",
    }),
    "C:\\Users\\K\\AppData\\Roaming"
  );
});

test("Windows save discovery falls back to the user's Roaming AppData", () => {
  for (const windowsAppDataDir of [undefined, "", "relative\\path"]) {
    assert.equal(
      resolveCloudSaveAppDataDir({
        platform: "windows",
        homeDir: "C:\\Users\\K",
        electronAppDataDir: "D:\\GameHub\\data",
        windowsAppDataDir,
      }),
      "C:\\Users\\K\\AppData\\Roaming"
    );
  }
});

test("non-Windows and Wine contexts retain Electron's native app-data root", () => {
  for (const platform of ["linux", "mac"] as const) {
    assert.equal(
      resolveCloudSaveAppDataDir({
        platform,
        homeDir: "/home/k",
        electronAppDataDir: "/home/k/.config",
        windowsAppDataDir: "C:\\Users\\K\\AppData\\Roaming",
      }),
      "/home/k/.config"
    );
  }
});
