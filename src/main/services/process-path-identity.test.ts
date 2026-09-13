import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeProcessPath,
  isProcessPathWithinDirectory,
} from "./process-path-identity";
import { rankOverlayGameProcesses } from "./overlay-game-process-ranking";
import {
  hasLinuxNativeOrAppImageMatch,
  hasLaunchedPidMatch,
  processReferencesExecutable,
  type LinuxProcessInfo,
} from "./linux-process-match";

const linuxProcess = (exe: string, pid = 100): LinuxProcessInfo => ({
  name: exe.split("/").at(-1)!,
  exe,
  cwd: "/Games/Foo",
  pid,
  appImagePath: null,
  steamCompatDataPath: null,
});

test("Windows paths normalize independently of the host; POSIX paths retain case", () => {
  assert.equal(
    normalizeProcessPath("C:\\Games\\Foo\\..\\Bar.exe"),
    "c:/games/bar.exe"
  );
  assert.equal(
    normalizeProcessPath("\\\\SERVER\\Games\\Foo.exe"),
    "//server/games/foo.exe"
  );
  assert.equal(normalizeProcessPath("/Games/Foo/../Bar"), "/Games/Bar");
  assert.equal(
    isProcessPathWithinDirectory(
      "C:\\Games\\Foo\\Binaries\\Game.exe",
      "c:/games/foo"
    ),
    true
  );
  assert.equal(
    isProcessPathWithinDirectory("/Games/Foobar/game", "/Games/Foo"),
    false
  );
  assert.equal(
    isProcessPathWithinDirectory("/games/Foo/game", "/Games/Foo"),
    false
  );
});

test("case-distinct Linux paths and unrelated same-name processes do not become overlay targets", () => {
  const ranked = rankOverlayGameProcesses(
    [
      { exe: "/Games/Foo/Game", name: "Game", pid: 1 },
      { exe: "/games/Foo/Game", name: "Game", pid: 2 },
      { exe: "/Other/Game", name: "Game", pid: 3 },
      { exe: "/Games/Foo/Game", name: "Game", pid: 4 },
    ],
    ["/Games/Foo/Game"],
    3
  );
  assert.deepEqual(ranked.map((item) => item.pid).sort(), [1, 4]);
});

test("Linux nested renderers remain eligible without escaping the install root", () => {
  const ranked = rankOverlayGameProcesses(
    [
      { exe: "/Games/Foo/Game", name: "Game", pid: 1 },
      { exe: "/Games/Foo/Binaries/Game", name: "Game", pid: 2 },
      { exe: "/Games/Foobar/Binaries/Game", name: "Game", pid: 3 },
    ],
    ["/Games/Foo/Game"],
    2
  );
  assert.equal(
    ranked.some((item) => item.pid === 2),
    true
  );
  assert.equal(
    ranked.some((item) => item.pid === 3),
    false
  );
});

test("Wine name matching requires a real Wine process and an exact case-sensitive game directory", () => {
  const ranked = rankOverlayGameProcesses(
    [
      {
        exe: "/usr/bin/wine64-preloader",
        cwd: "/Games/Foo",
        name: "game.exe",
        pid: 1,
      },
      {
        exe: "/usr/bin/wine64-preloader",
        cwd: "/games/Foo",
        name: "game.exe",
        pid: 2,
      },
      { exe: "/usr/bin/bash", cwd: "/Games/Foo", name: "game.exe", pid: 3 },
    ],
    ["/Games/Foo/Game.exe"]
  );
  assert.deepEqual(
    ranked.map((item) => item.pid),
    [1]
  );
});

test("Linux process tracking preserves native and AppImage casing and rejects reused unrelated PID", () => {
  assert.equal(
    hasLinuxNativeOrAppImageMatch("/Games/Foo/Game", [
      linuxProcess("/Games/Foo/Game"),
    ]),
    true
  );
  assert.equal(
    hasLinuxNativeOrAppImageMatch("/Games/Foo/Game", [
      linuxProcess("/games/Foo/Game"),
    ]),
    false
  );
  assert.equal(
    hasLinuxNativeOrAppImageMatch("/Games/Foo.AppImage", [
      {
        ...linuxProcess("/tmp/.mount_foo/AppRun"),
        appImagePath: "/Games/Foo.AppImage",
      },
    ]),
    true
  );
  assert.equal(
    hasLinuxNativeOrAppImageMatch("/Games/foo.AppImage", [
      {
        ...linuxProcess("/tmp/.mount_foo/AppRun"),
        appImagePath: "/Games/Foo.AppImage",
      },
    ]),
    false
  );
  assert.equal(
    hasLaunchedPidMatch(
      100,
      "/Games/Foo/Game",
      new Map([[100, linuxProcess("/usr/bin/bash")]])
    ),
    false
  );
  assert.equal(
    processReferencesExecutable(
      { exe: "/usr/bin/wine64-preloader", cwd: "/Games/Foo" },
      "/Games/Foo/Game.exe"
    ),
    true
  );
});
