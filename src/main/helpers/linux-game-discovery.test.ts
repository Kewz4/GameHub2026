import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  linuxGameRoots,
  linuxSteamRoots,
  isLinuxLaunchableFile,
} from "./linux-game-discovery";
import { wineLaunchEnvironment } from "./wine-launch-environment";

test("Linux discovery includes native and Flatpak Steam and narrow user roots", () => {
  const roots = linuxSteamRoots("/home/deck", { XDG_DATA_HOME: "/mnt/data" });
  assert.equal(roots[0], "/mnt/data/Steam");
  assert.ok(
    roots.includes(
      "/home/deck/.var/app/com.valvesoftware.Steam/.local/share/Steam"
    )
  );
  assert.ok(linuxGameRoots("/home/deck").includes("/home/deck/Games"));
  assert.ok(!linuxGameRoots("/home/deck").includes("/home/deck"));
});

test("Wine fallback preserves the same save prefix and independent launch variables", () => {
  assert.deepEqual(
    wineLaunchEnvironment(
      { PATH: "/bin", WINEPREFIX: "/wrong" },
      { DXVK_HUD: "1", WINEPREFIX: "/also-wrong" },
      "/games/hades-prefix"
    ),
    {
      PATH: "/bin",
      DXVK_HUD: "1",
      WINEPREFIX: "/games/hades-prefix",
    }
  );
});

test(
  "Linux executable scan validates headers and excludes shared libraries",
  { skip: process.platform === "win32" },
  () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gamehub-linux-scan-"));
    try {
      for (const [name, contents, executable, expected] of [
        ["Game.x86_64", Buffer.from([0x7f, 0x45, 0x4c, 0x46]), true, true],
        ["start.sh", Buffer.from("#!/bin/sh\nexit 0"), true, true],
        ["library.so.1", Buffer.from([0x7f, 0x45, 0x4c, 0x46]), true, false],
        ["save.sav", Buffer.from("my save data"), true, false],
        ["no-permission", Buffer.from([0x7f, 0x45, 0x4c, 0x46]), false, false],
      ] as const) {
        const file = path.join(root, name);
        fs.writeFileSync(file, contents, { mode: executable ? 0o700 : 0o600 });
        assert.equal(isLinuxLaunchableFile(file), expected, name);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
);
