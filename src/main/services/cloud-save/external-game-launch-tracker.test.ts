import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  EXTERNAL_LAUNCH_TIMEOUT_MS,
  EXTERNAL_PROCESS_HANDOFF_GRACE_MS,
  beginExternalGameLaunch,
  clearAllExternalGameLaunches,
  clearExternalGameLaunch,
  confirmExternalLaunchProcess,
  getExternalGameLaunch,
  getPotentialExternalLaunchProcesses,
  isExternalGameLaunchExpired,
  hasExternalGameLaunch,
  isPotentialExternalGameProcess,
  markExternalGameLaunchSeen,
  selectExternalLaunchProcess,
  shouldWaitForExternalProcessHandoff,
  withDiscoveredExecutablePath,
  type ExternalGameProcess,
} from "../external-game-launch-tracker";

const process = (
  pid: number,
  name: string,
  exe = `C:\\Games\\Example\\${name}`
): ExternalGameProcess => ({ pid, name, exe });

const begin = (
  baselineProcesses: ExternalGameProcess[] = [
    process(10, "steam.exe", "C:\\Program Files (x86)\\Steam\\steam.exe"),
  ]
) =>
  beginExternalGameLaunch({
    gameKey: "steam:123",
    objectId: "123",
    shop: "steam",
    title: "Death Must Die",
    protocolUrl: "steam://run/123",
    baselineProcesses,
    baselineForegroundPid: 10,
    now: 1_000,
  });

const gameWindow = new Map([[20, { width: 1920, height: 1080 }]]);

afterEach(() => clearAllExternalGameLaunches());

describe("external game launch process correlation", () => {
  it("preserves a store protocol and the real non-Steam game identity", () => {
    const game = {
      shop: "gog",
      objectId: "gog-id",
      executablePath: "goggalaxy://openGame/gog-id",
      nativeExecutablePath: null,
    };
    const updated = withDiscoveredExecutablePath(
      game,
      "D:\\GOG Games\\Example\\Example.exe"
    );

    assert.equal(updated.shop, "gog");
    assert.equal(updated.objectId, "gog-id");
    assert.equal(updated.executablePath, game.executablePath);
    assert.equal(
      updated.nativeExecutablePath,
      "D:\\GOG Games\\Example\\Example.exe"
    );
  });

  it("marks the launch active immediately and retains cloud-session ownership", () => {
    const state = beginExternalGameLaunch({
      gameKey: "gog:456",
      objectId: "456",
      shop: "gog",
      title: "Example",
      protocolUrl: "goggalaxy://openGame/456",
      cloudSaveSessionToken: "session-token",
      baselineProcesses: [process(10, "GalaxyClient.exe")],
      now: 1_000,
    });

    assert.equal(hasExternalGameLaunch(state.gameKey), true);
    assert.equal(state.cloudSaveSessionToken, "session-token");
    clearExternalGameLaunch(state.gameKey);
    assert.equal(hasExternalGameLaunch(state.gameKey), false);
  });

  it("selects a new foreground process with a real visible game window", () => {
    const state = begin();
    const game = process(20, "KZ.exe", "C:\\Games\\Khazan\\KZ.exe");

    const match = selectExternalLaunchProcess({
      state,
      processes: [process(10, "steam.exe"), game],
      foregroundPid: 20,
      windows: gameWindow,
      requireVisibleWindow: true,
    });

    assert.equal(match?.process.pid, 20);
    assert.equal(match?.confidence, "foreground");
    assert.equal(confirmExternalLaunchProcess(state.gameKey, match!), false);
    assert.equal(confirmExternalLaunchProcess(state.gameKey, match!), true);
    assert.equal(getExternalGameLaunch(state.gameKey)?.phase, "bound");
  });

  it("never binds a process that existed before the protocol launch", () => {
    const alreadyRunning = process(20, "DeathMustDie.exe");
    const state = begin([alreadyRunning]);

    assert.deepEqual(
      getPotentialExternalLaunchProcesses(state, [alreadyRunning]),
      []
    );
  });

  it("requires visibility and a useful game-sized window on Windows", () => {
    const state = begin();
    const game = process(20, "DeathMustDie.exe");

    const hidden = selectExternalLaunchProcess({
      state,
      processes: [game],
      foregroundPid: 20,
      windows: new Map(),
      requireVisibleWindow: true,
    });
    const splash = selectExternalLaunchProcess({
      state,
      processes: [game],
      foregroundPid: 20,
      windows: new Map([[20, { width: 320, height: 200 }]]),
      requireVisibleWindow: true,
    });

    assert.equal(hidden, null);
    assert.equal(splash, null);
  });

  it("filters store clients, helpers, crash reporters, and anti-cheat", () => {
    for (const name of [
      "steamwebhelper.exe",
      "EpicGamesLauncher.exe",
      "RiotClientServices.exe",
      "UnityCrashHandler64.exe",
      "EasyAntiCheat_EOS.exe",
      "ExampleLauncher.exe",
    ]) {
      assert.equal(isPotentialExternalGameProcess(process(20, name)), false);
    }
    assert.equal(
      isPotentialExternalGameProcess(process(21, "Hades2.exe")),
      true
    );
  });

  it("uses a unique title match but rejects otherwise ambiguous windows", () => {
    const state = begin();
    const game = process(20, "DeathMustDie.exe");
    const unrelated = process(21, "PhotoViewer.exe");
    const windows = new Map([
      [20, { width: 1920, height: 1080 }],
      [21, { width: 1280, height: 720 }],
    ]);

    assert.equal(
      selectExternalLaunchProcess({
        state,
        processes: [game, unrelated],
        foregroundPid: 0,
        windows,
        requireVisibleWindow: true,
      })?.process.pid,
      20
    );

    state.title = "Unknown title";
    assert.equal(
      selectExternalLaunchProcess({
        state,
        processes: [game, unrelated],
        foregroundPid: 0,
        windows,
        requireVisibleWindow: true,
      }),
      null
    );
  });

  it("requires two observations for a sole background candidate", () => {
    const state = begin();
    const game = process(20, "render.exe");
    const match = selectExternalLaunchProcess({
      state,
      processes: [game],
      foregroundPid: 0,
      windows: gameWindow,
      requireVisibleWindow: true,
    });

    assert.equal(match?.confidence, "stable-visible");
    assert.equal(confirmExternalLaunchProcess(state.gameKey, match!), false);
    assert.equal(confirmExternalLaunchProcess(state.gameKey, match!), true);
  });

  it("does not auto-discover when the launch baseline could not be captured", () => {
    const state = begin([]);
    assert.equal(state.baselineCaptured, false);
    assert.deepEqual(
      getPotentialExternalLaunchProcesses(state, [
        process(20, "DeathMustDie.exe"),
      ]),
      []
    );
  });

  it("expires pending launches but grants a bounded process a short handoff", () => {
    const state = begin();
    assert.equal(
      isExternalGameLaunchExpired(
        state,
        state.startedAt + EXTERNAL_LAUNCH_TIMEOUT_MS
      ),
      true
    );

    markExternalGameLaunchSeen(state.gameKey, process(20, "Hades2.exe"), 5_000);
    assert.equal(
      shouldWaitForExternalProcessHandoff(
        state,
        5_000 + EXTERNAL_PROCESS_HANDOFF_GRACE_MS - 1
      ),
      true
    );
    assert.equal(
      shouldWaitForExternalProcessHandoff(
        state,
        5_000 + EXTERNAL_PROCESS_HANDOFF_GRACE_MS
      ),
      false
    );
  });
});
