import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { emulatorUserPaths } from "./emulator-user-paths";
import { DEFAULT_CONTROLLER_PROFILE } from "./controller-writers";
import {
  buildRetroArchLaunch,
  LINUX_RETRO_CORES,
  parseRetroArchConfig,
  serializeRetroArchConfig,
  retroArchControllerConfig,
  retroArchSaveRoots,
  writeRetroArchController,
} from "./retroarch-linux";

test("all eight retro systems have actual Linux .so core mappings", () => {
  assert.deepEqual(Object.keys(LINUX_RETRO_CORES).sort(), [
    "dsi",
    "gb",
    "gba",
    "gbc",
    "n64",
    "nds",
    "ps1",
    "psp",
  ]);
  assert.equal(LINUX_RETRO_CORES.psp, "ppsspp_libretro");
  assert.equal(LINUX_RETRO_CORES.gb, LINUX_RETRO_CORES.gba);
});

test("RetroArch settings preserve whitespace/quotes without injecting config keys", () => {
  const data = {
    savefile_directory: '/games/A "quoted" directory',
    key: "first\nsecond",
  };
  assert.deepEqual(parseRetroArchConfig(serializeRetroArchConfig(data)), data);
  assert.equal(serializeRetroArchConfig({ "bad\nkey": "value" }), "\n");
});

test("RetroArch SDL mapper uses physical face positions, triggers and sticks", () => {
  const result = retroArchControllerConfig(DEFAULT_CONTROLLER_PROFILE);
  assert.equal(result.input_player1_b_btn, "0");
  assert.equal(result.input_player1_a_btn, "1");
  assert.equal(result.input_player1_l2_axis, "+4");
  assert.equal(result.input_player1_l_x_minus_axis, "-0");
  assert.equal(result.input_joypad_driver, "sdl2");
});

test("RetroArch launch is core-explicit, preserves original config and uses exact save directory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gamehub-retroarch-"));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = root;
  try {
    const configRoot = emulatorUserPaths("ralibretro", root).config;
    fs.mkdirSync(path.join(configRoot, "cores"), { recursive: true });
    const saved = serializeRetroArchConfig({
      savefile_directory: path.join(root, "My Saves"),
      libretro_directory: path.join(configRoot, "cores"),
      cheevos_enable: "true",
    });
    fs.writeFileSync(path.join(configRoot, "retroarch.cfg"), saved);
    fs.writeFileSync(
      path.join(configRoot, "cores", "mgba_libretro.so"),
      "fixture-not-executed"
    );
    writeRetroArchController(root, DEFAULT_CONTROLLER_PROFILE);
    const rom = path.join(root, "A game with spaces.gba");
    const args = buildRetroArchLaunch(root, "gba", rom);
    assert.equal(args.at(-1), rom);
    assert.equal(
      args.at(-2),
      path.join(configRoot, "cores", "mgba_libretro.so")
    );
    assert.equal(args[3], "-L");
    assert.equal(
      fs.readFileSync(path.join(configRoot, "retroarch.cfg"), "utf8"),
      saved
    );
    assert.deepEqual(retroArchSaveRoots(root, rom), [
      path.join(root, "My Saves"),
    ]);
    const launch = parseRetroArchConfig(fs.readFileSync(args[2], "utf8"));
    assert.equal(launch.config_save_on_exit, "false");
    assert.equal(launch.video_windowed_fullscreen, "true");
    assert.equal(launch.input_player1_b_btn, "0");
    assert.equal(
      launch.savefile_directory,
      path.join(root, "My Saves", "mGBA")
    );
    assert.equal(launch.sort_savefiles_enable, "false");
    assert.deepEqual(retroArchSaveRoots(root, rom, "gba"), [
      launch.savefile_directory,
    ]);
    assert.throws(
      () => buildRetroArchLaunch(root, "psp", rom),
      /core ppsspp_libretro.so is missing/
    );
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("RetroArch core/content directory sorting and content-local saves match the actual launch target", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "gamehub-retroarch-sort-")
  );
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = root;
  try {
    const configRoot = emulatorUserPaths("ralibretro", root).config;
    fs.mkdirSync(configRoot, { recursive: true });
    const cfg = path.join(configRoot, "retroarch.cfg");
    const rom = path.join(root, "ROMs", "PSP", "Example.iso");
    fs.writeFileSync(
      cfg,
      serializeRetroArchConfig({
        savefile_directory: path.join(root, "saves"),
        sort_savefiles_by_content_enable: "true",
      })
    );
    assert.deepEqual(retroArchSaveRoots(root, rom, "psp"), [
      path.join(root, "saves", "PSP", "PPSSPP"),
    ]);
    fs.writeFileSync(
      cfg,
      serializeRetroArchConfig({
        savefile_directory: path.join(root, "ignored"),
        savefiles_in_content_dir: "true",
        sort_savefiles_enable: "false",
      })
    );
    assert.deepEqual(retroArchSaveRoots(root, rom, "psp"), [path.dirname(rom)]);
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
