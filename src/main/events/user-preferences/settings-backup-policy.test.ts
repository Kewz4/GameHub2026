import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getSettingsBackupPreferences,
  SETTINGS_BACKUP_SAFE_PREFERENCE_KEYS,
} from "./settings-backup-policy";

describe("settings backup policy", () => {
  it("covers current portable desktop settings", () => {
    const keys = new Set<string>(SETTINGS_BACKUP_SAFE_PREFERENCE_KEYS);
    for (const key of [
      "themeMode",
      "hideMatureGames",
      "overlayEnabled",
      "overlayPerformanceShowOnePercentLow",
      "gameRecorderEnabled",
      "gameRecorderReplayDurationSeconds",
      "bigPictureVirtualKeyboardEnabled",
      "maxDownloadSpeedBytesPerSecond",
      "exophaseManagedPlatforms",
      "exophaseExtraProfiles",
    ]) {
      assert.equal(keys.has(key), true, `${key} should be backed up`);
    }
  });

  it("never copies credentials or machine-local paths", () => {
    const safe = getSettingsBackupPreferences({
      themeMode: "light",
      gameRecorderEnabled: true,
      gameRecorderOutputDirectory: "C:\\private\\captures",
      downloadsPath: "C:\\private\\games",
      steamApiKey: "secret",
      retroAchievementsToken: "secret",
      spotifyClientId: "client-id",
      torrentNetworkInterface: "Ethernet 2",
      globalTrackers: [
        "https://private-tracker.example/announce?passkey=secret",
      ],
      appendGlobalTrackers: true,
      exophaseUserId: "session-dependent-user",
    });

    assert.deepEqual(safe, {
      themeMode: "light",
      gameRecorderEnabled: true,
    });
  });
});
