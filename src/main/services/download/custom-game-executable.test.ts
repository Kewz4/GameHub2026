import assert from "node:assert/strict";
import test from "node:test";
const customExecutableModulePath = "./custom-game-executable.ts";
const { selectCustomGameExecutable } = await import(customExecutableModulePath);

test("prefers a title-matching game binary over a larger helper", () => {
  assert.equal(
    selectCustomGameExecutable("Hades II", [
      { path: "Engine/Binaries/Win64/Helper.exe", size: 900_000_000 },
      { path: "Hades2.exe", size: 40_000_000 },
    ]),
    "Hades2.exe"
  );
});

test("never binds setup, uninstall, or redistributable executables", () => {
  assert.equal(
    selectCustomGameExecutable("Unknown Game", [
      { path: "setup.exe", size: 500_000_000 },
      { path: "_CommonRedist/vcredist.exe", size: 50_000_000 },
      { path: "Game/Binaries/Win64/Game-Win64-Shipping.exe", size: 20_000_000 },
    ]),
    "Game/Binaries/Win64/Game-Win64-Shipping.exe"
  );
});

test("returns null when an installer is the only executable", () => {
  assert.equal(
    selectCustomGameExecutable("Installer", [
      { path: "Installer/setup.exe", size: 10_000_000 },
      { path: "GameInstaller.exe", size: 20_000_000 },
      { path: "setup_x64.exe", size: 30_000_000 },
      { path: "autorun.exe", size: 40_000_000 },
      { path: "unins000.exe", size: 50_000_000 },
      { path: "Tools/GameUpdater.exe", size: 60_000_000 },
      { path: "Support/Launcher.exe", size: 70_000_000 },
    ]),
    null
  );
});

test("prefers a shipping binary over a generic launcher", () => {
  assert.equal(
    selectCustomGameExecutable("Unknown Game", [
      { path: "Launcher.exe", size: 80_000_000 },
      {
        path: "Game/Binaries/Win64/UnknownGame-Win64-Shipping.exe",
        size: 40_000_000,
      },
    ]),
    "Game/Binaries/Win64/UnknownGame-Win64-Shipping.exe"
  );
});
