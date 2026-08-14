import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { inspectSteamEmulatorDirectory } from "./steam-emulator-target";
import {
  markSteamEmulatorRecoveryApplied,
  prepareSteamEmulatorRecoveryBackup,
  rollbackSteamEmulatorMutation,
} from "./steam-emulator-transaction";

test("applied status remains prepared when durable manifest finalization fails", async () => {
  const backup = {
    directory: "unused",
    manifestPath: "unused",
    manifest: {
      version: 1 as const,
      appId: "2651280",
      gameDir: "C:\\Games\\Example",
      createdAt: new Date(0).toISOString(),
      status: "prepared" as const,
      files: [],
      preexistingArtifacts: [],
    },
  };

  await assert.rejects(
    markSteamEmulatorRecoveryApplied(backup, async () => {
      throw new Error("synthetic disk failure");
    }),
    /synthetic disk failure/
  );
  assert.equal(backup.manifest.status, "prepared");
});

test("failed setup restores DLLs and removes only newly-created artifacts", async () => {
  const gameDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "gamehub-steam-transaction-")
  );
  const dllPath = path.join(gameDir, "steam_api64.dll");
  const preservedPath = path.join(gameDir, "player-settings.json");
  const executablePath = path.join(gameDir, "game.exe");
  const preexistingExecutablePath = path.join(gameDir, "existing.exe");
  const preexistingExecutableBackup = `${preexistingExecutablePath}.bak`;
  fs.writeFileSync(dllPath, "untouched-steam-dll");
  fs.writeFileSync(preservedPath, "keep-me");
  fs.writeFileSync(executablePath, "game-executable");
  fs.writeFileSync(preexistingExecutablePath, "existing-executable");
  fs.writeFileSync(preexistingExecutableBackup, "preexisting-backup");

  let backupDirectory: string | null = null;
  try {
    const inspection = await inspectSteamEmulatorDirectory(gameDir);
    assert.equal(inspection.ok, true);
    const backup = await prepareSteamEmulatorRecoveryBackup(
      inspection.gameDir!,
      "2651280",
      inspection.steamApiDllPaths,
      inspection.artifactPaths
    );
    backupDirectory = backup.directory;

    fs.writeFileSync(dllPath, "mutated-emulator-dll");
    fs.writeFileSync(`${dllPath}.bak`, "untouched-steam-dll");
    fs.writeFileSync(`${executablePath}.bak`, "new-unpacker-backup");
    fs.mkdirSync(path.join(gameDir, "steam_settings"));
    fs.writeFileSync(
      path.join(gameDir, "steam_settings", "achievements.json"),
      "[]"
    );

    const rollback = await rollbackSteamEmulatorMutation(
      backup,
      "synthetic setup failure"
    );
    assert.equal(rollback.complete, true, rollback.reason);
    assert.equal(fs.readFileSync(dllPath, "utf8"), "untouched-steam-dll");
    assert.equal(fs.existsSync(`${dllPath}.bak`), false);
    assert.equal(fs.existsSync(`${executablePath}.bak`), false);
    assert.equal(
      fs.readFileSync(preexistingExecutableBackup, "utf8"),
      "preexisting-backup"
    );
    assert.equal(fs.existsSync(path.join(gameDir, "steam_settings")), false);
    assert.equal(fs.readFileSync(preservedPath, "utf8"), "keep-me");

    const manifest = JSON.parse(
      fs.readFileSync(path.join(backup.directory, "manifest.json"), "utf8")
    ) as { status: string; files: Array<{ sha256: string; size: number }> };
    assert.equal(manifest.status, "rolled-back");
    assert.equal(manifest.files.length, 1);
    assert.equal(manifest.files[0].size, "untouched-steam-dll".length);
    assert.match(manifest.files[0].sha256, /^[a-f\d]{64}$/);
  } finally {
    fs.rmSync(gameDir, { recursive: true, force: true });
    if (backupDirectory) {
      fs.rmSync(backupDirectory, { recursive: true, force: true });
    }
  }
});
