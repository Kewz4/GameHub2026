import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildGoldbergAchievementState,
  getSteamEmulatorRuntimeConfigPath,
  getSteamEmulatorSetupAction,
  hardenSteamEmulatorRuntimeConfig,
  isOfflinePlaySetupEligible,
  sanitizeSteamEmulatorOutput,
} from "../../../shared/steam-emulator-policy";

test("setup action is idempotent and rejects unsafe states", () => {
  assert.equal(getSteamEmulatorSetupAction("clean", "2651280"), "apply");
  assert.equal(
    getSteamEmulatorSetupAction("emulator-ready", "2651280"),
    "ready"
  );
  for (const status of [
    "emulator-present",
    "tool-unavailable",
    "not-installed",
  ]) {
    assert.equal(getSteamEmulatorSetupAction(status, "2651280"), "reject");
  }
  assert.equal(getSteamEmulatorSetupAction("clean", "custom-uuid"), "reject");
});

test("runtime config lives in writable user data, not packaged resources", () => {
  assert.equal(
    getSteamEmulatorRuntimeConfigPath("D:\\Portable GameHub\\data\\"),
    "D:\\Portable GameHub\\data\\steam-emulator\\config.json"
  );
});

test("CLI diagnostics redact key variants and stay bounded", () => {
  const secret = "a".repeat(32);
  const output = sanitizeSteamEmulatorOutput(
    `${"prefix".repeat(1_000)} SteamWebAPIKey=${secret} safe-tail`,
    120
  );
  assert.doesNotMatch(output, new RegExp(secret));
  assert.match(output, /SteamWebAPIKey=\[redacted\]/);
  assert.match(output, /safe-tail$/);
  assert.ok(output.length <= 120);
});

test("runtime config writer disables executable unpacking", () => {
  const source = {
    ProcessConfigs: {
      GenerateEMUConfig: true,
      Unpack: true,
    },
  };
  const hardened = hardenSteamEmulatorRuntimeConfig(source);
  assert.equal(hardened.ProcessConfigs.Unpack, false);
  assert.equal(hardened.ProcessConfigs.GenerateEMUConfig, true);
  assert.equal(
    source.ProcessConfigs.Unpack,
    true,
    "source must not be mutated"
  );
});

test("offline-play setup rejects synced games and every platform URI", () => {
  assert.equal(
    isOfflinePlaySetupEligible({
      shop: "steam",
      objectId: "2651280",
      libraryOrigin: "sync",
      executablePath: "C:\\Games\\Example\\Game.exe",
    }),
    false
  );

  for (const executablePath of [
    "steam://rungameid/2651280",
    "legendary://launch/example",
    "com.epicgames.launcher://apps/example?action=launch",
    "goggalaxy://openGameView/123",
    "origin2://game/launch?offerIds=example",
    "uplay://launch/123/0",
  ]) {
    assert.equal(
      isOfflinePlaySetupEligible({
        shop: "steam",
        objectId: "2651280",
        libraryOrigin: "custom",
        executablePath,
      }),
      false,
      executablePath
    );
  }

  assert.equal(
    isOfflinePlaySetupEligible({
      shop: "steam",
      objectId: "2651280",
      libraryOrigin: "custom",
      executablePath: "C:\\Games\\Example\\Game.exe",
    }),
    true
  );
});

test("offline-play setup requires a canonical numeric Steam app id", () => {
  assert.equal(
    isOfflinePlaySetupEligible({
      shop: "steam",
      objectId: "2651280",
      executablePath: "C:\\Games\\Unknown\\Game.exe",
    }),
    false
  );
  assert.equal(
    isOfflinePlaySetupEligible({
      shop: "custom",
      objectId: "custom-download-565bf378-d168-413f-964a-b271bd14f29c",
      libraryOrigin: "custom",
      executablePath: "C:\\Games\\Custom\\Game.exe",
    }),
    false
  );
  assert.equal(
    isOfflinePlaySetupEligible({
      shop: "steam",
      objectId: "2651280",
      libraryOrigin: "catalog",
      executablePath: "C:\\Games\\Spider-Man 2\\Spider-Man2.exe",
    }),
    true
  );
  assert.equal(
    isOfflinePlaySetupEligible({
      shop: "steam",
      objectId: "2651280",
      libraryOrigin: "sync",
      executablePath: "C:\\Games\\Spider-Man 2\\Spider-Man2.exe",
    }),
    false
  );
});

test("Steam achievement schemas become locked Goldberg save state", () => {
  assert.deepEqual(
    buildGoldbergAchievementState([
      { name: "FIRST" },
      { name: " SECOND " },
      { name: "FIRST" },
      { invalid: true },
    ]),
    {
      FIRST: { earned: false, earned_time: 0 },
      SECOND: { earned: false, earned_time: 0 },
    }
  );
});

test("tracked Steam emulator sources contain no key-shaped secret literal", () => {
  const directories = [
    path.dirname(fileURLToPath(import.meta.url)),
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../shared"
    ),
  ];
  for (const directory of directories) {
    for (const fileName of fs
      .readdirSync(directory)
      .filter((name) => name.endsWith(".ts"))) {
      const source = fs.readFileSync(path.join(directory, fileName), "utf8");
      assert.doesNotMatch(source, /["'][a-f\d]{32}["']/i, fileName);
    }
  }
});
