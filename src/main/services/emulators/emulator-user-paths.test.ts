import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { cemuMlcDir, emulatorUserPaths } from "./emulator-user-paths";

const linux = {
  platform: "linux" as const,
  home: "/home/player",
  env: {},
  exists: () => false,
};

for (const [binary, data, config] of [
  ["azahar", ".local/share/azahar", ".config/azahar"],
  ["dolphin", ".local/share/dolphin-emu", ".config/dolphin-emu"],
  ["cemu", ".local/share/Cemu", ".config/Cemu"],
  ["eden", ".local/share/eden", ".config/eden"],
  ["rpcs3", ".config/rpcs3", ".config/rpcs3"],
  ["pcsx2", ".config/PCSX2", ".config/PCSX2/inis"],
  ["duckstation", ".local/share/duckstation", ".local/share/duckstation"],
]) {
  test(`${binary}: native Linux save/config roots do not point to /usr/bin`, () => {
    assert.deepEqual(emulatorUserPaths(binary, "/usr/bin", linux), {
      data: `/home/player/${data}`,
      config: `/home/player/${config}`,
      portable: false,
    });
  });
}

test("Flatpak uses sandbox XDG roots, not the host's custom XDG paths", () => {
  assert.deepEqual(
    emulatorUserPaths("dolphin", "/var/lib/flatpak/exports/bin", {
      ...linux,
      env: { XDG_CONFIG_HOME: "/else/config", XDG_DATA_HOME: "/else/data" },
    }),
    {
      data: "/home/player/.var/app/org.DolphinEmu.dolphin-emu/data/dolphin-emu",
      config:
        "/home/player/.var/app/org.DolphinEmu.dolphin-emu/config/dolphin-emu",
      portable: false,
    }
  );
});

test("custom XDG paths are honored, relative values are ignored", () => {
  const roots = emulatorUserPaths("azahar", "/usr/bin", {
    ...linux,
    env: { XDG_CONFIG_HOME: "relative", XDG_DATA_HOME: "/mnt/saves" },
  });
  assert.equal(roots.data, "/mnt/saves/azahar");
  assert.equal(roots.config, "/home/player/.config/azahar");
});

for (const [binary, marker, data, config] of [
  ["dolphin", "portable.txt", "User", "User/Config"],
  ["azahar", "user", "user", "user/config"],
  ["eden", "user", "user", "user/config"],
  ["cemu", "portable", "portable", "portable"],
  ["rpcs3", "portable", "portable", "portable"],
  ["pcsx2", "portable.ini", "", "inis"],
]) {
  test(`${binary}: explicit portable setup remains portable`, () => {
    const roots = emulatorUserPaths(binary, "/games/emulator", {
      ...linux,
      exists: (target) => target === `/games/emulator/${marker}`,
    });
    assert.equal(roots.data, path.posix.join("/games/emulator", data));
    assert.equal(roots.config, path.posix.join("/games/emulator", config));
    assert.equal(roots.portable, true);
  });
}

test("Dolphin user path and legacy layout retain config with their saves", () => {
  const overridden = emulatorUserPaths("dolphin", "/usr/bin", {
    ...linux,
    env: { DOLPHIN_EMU_USERPATH: "/mnt/dolphin" },
  });
  assert.equal(overridden.data, "/mnt/dolphin");
  assert.equal(overridden.config, "/mnt/dolphin/Config");
  const legacy = emulatorUserPaths("dolphin", "/usr/bin", {
    ...linux,
    exists: (target) => target === "/home/player/.dolphin-emu",
  });
  assert.equal(legacy.data, "/home/player/.dolphin-emu");
});

test("PCSX2 AppImage ignores ineffective adjacent marker without abandoning native saves", () => {
  const roots = emulatorUserPaths("pcsx2", "/games/pcsx2", {
    ...linux,
    pcsx2AppImage: true,
    exists: (target) => target.endsWith("/portable.ini"),
  });
  assert.equal(roots.data, "/home/player/.config/PCSX2");
  assert.equal(roots.portable, false);
});

test("PCSX2 AppImage recognizes actual previously-used portable data root", () => {
  const roots = emulatorUserPaths("pcsx2", "/games/pcsx2", {
    ...linux,
    pcsx2AppImage: true,
    exists: (target) => target === "/games/pcsx2/PCSX2/inis/PCSX2.ini",
  });
  assert.equal(roots.data, "/games/pcsx2/PCSX2");
  assert.equal(roots.config, "/games/pcsx2/PCSX2/inis");
  assert.equal(roots.portable, true);
});

test("Windows portable save roots remain unchanged", () => {
  const root = path.resolve("test-emulator");
  const options = { platform: "win32" as const, exists: () => false };
  assert.equal(
    emulatorUserPaths("dolphin", root, options).data,
    path.join(root, "User")
  );
  assert.equal(
    emulatorUserPaths("azahar", root, options).config,
    path.join(root, "user", "config")
  );
  assert.equal(emulatorUserPaths("rpcs3", root, options).data, root);
});

test("Cemu uses its configured MLC save location without creating or moving saves", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cemu-paths-"));
  try {
    const portable = path.join(root, "portable");
    fs.mkdirSync(portable);
    fs.writeFileSync(
      path.join(portable, "settings.xml"),
      "<content><mlc_path>../My &amp; Saves</mlc_path></content>"
    );
    const target = path.join(root, "My & Saves");
    assert.equal(cemuMlcDir(root), target);
    assert.equal(fs.existsSync(target), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
