import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGameHubEmulatorRules,
  gameHubStableEmulatorRawPath,
} from "./gamehub-emulator-rules";

test("native Linux and Flatpak emulator saves get portable-compatible stable identities outside executable directories", () => {
  for (const [binary, system, portableRoot, nativeRoot, relative, kind] of [
    [
      "ralibretro",
      "gba",
      "Saves",
      "/home/deck/.config/retroarch/saves",
      "Example.srm",
      "file",
    ],
    [
      "dolphin",
      "wii",
      "User/Wii",
      "/home/deck/.local/share/dolphin-emu/Wii",
      "title/00010000/524d4345",
      "dir",
    ],
    [
      "dolphin",
      "gc",
      "User/GC",
      "/home/deck/.var/app/org.DolphinEmu.dolphin-emu/data/dolphin-emu/GC",
      "USA/Card A/GMSE-save.gci",
      "file",
    ],
    [
      "azahar",
      "n3ds",
      "user/sdmc",
      "/home/deck/.local/share/azahar/sdmc",
      "Nintendo 3DS/account/device/title/00040000/00033600",
      "dir",
    ],
    [
      "cemu",
      "wiiu",
      "portable/mlc01/usr/save",
      "/mnt/saves/cemu-mlc/usr/save",
      "00050000/1019e600",
      "dir",
    ],
    [
      "rpcs3",
      "ps3",
      "dev_hdd0/home/00000002/savedata",
      "/home/deck/.config/rpcs3/dev_hdd0/home/00000002/savedata",
      "BLES12345PROFILE",
      "dir",
    ],
    [
      "eden",
      "switch",
      "user/nand/user/save",
      "/home/deck/.local/share/eden/nand/user/save",
      "0000/account/01002b00111a2000",
      "dir",
    ],
  ] as const) {
    const portable = {
      shop: "launchbox" as const,
      objectId: `${system}:123`,
      platform: "windows" as const,
      binary,
      system,
      emulatorInstallDir: "C:/GameHub/emulator",
      saveRoots: [`C:/GameHub/emulator/${portableRoot}`],
      backupPaths: [],
      restorePatterns: [],
    };
    const native = {
      ...portable,
      platform: "linux" as const,
      emulatorInstallDir: "/usr/bin",
      saveRoots: [nativeRoot],
    };
    assert.equal(
      gameHubStableEmulatorRawPath(native, `${nativeRoot}/${relative}`, kind),
      gameHubStableEmulatorRawPath(
        portable,
        `C:/GameHub/emulator/${portableRoot}/${relative}`,
        kind
      ),
      binary
    );
    assert.equal(
      buildGameHubEmulatorRules({
        ...native,
        backupPaths: [`${nativeRoot}/${relative}`],
      }).length,
      1,
      binary
    );
  }
});

test("unknown external roots and candidates outside selected save roots remain unmapped", () => {
  const input = {
    shop: "launchbox" as const,
    objectId: "ps3:123",
    platform: "linux" as const,
    binary: "rpcs3",
    system: "ps3",
    emulatorInstallDir: "/usr/bin",
    saveRoots: ["/mnt/arbitrary"],
    backupPaths: [],
    restorePatterns: [],
  };
  assert.equal(
    gameHubStableEmulatorRawPath(input, "/mnt/arbitrary/game", "dir"),
    null
  );
  assert.equal(
    gameHubStableEmulatorRawPath(
      { ...input, binary: "ralibretro" },
      "/mnt/other/game.srm",
      "file"
    ),
    null
  );
});
