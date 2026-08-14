import assert from "node:assert/strict";
import path from "node:path";
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

test("portable Goldberg achievement roots remain under real Roaming AppData", () => {
  const roaming = resolveCloudSaveAppDataDir({
    platform: "windows",
    homeDir: "C:\\Users\\K",
    electronAppDataDir: "D:\\Portable GameHub\\data",
    windowsAppDataDir: "C:\\Users\\K\\AppData\\Roaming",
  });

  assert.equal(
    path.win32.join(roaming!, "GSE Saves", "2651280", "achievements.json"),
    "C:\\Users\\K\\AppData\\Roaming\\GSE Saves\\2651280\\achievements.json"
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
