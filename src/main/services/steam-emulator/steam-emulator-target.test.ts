import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveSafeSteamEmulatorTarget } from "./steam-emulator-target";

const withCleanScratchExecutable = async (
  callback: (executablePath: string, root: string) => Promise<void>
) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gamehub-steam-target-"));
  const executablePath = path.join(root, "Game.exe");
  fs.writeFileSync(executablePath, "MZ");
  fs.writeFileSync(path.join(root, "steam_api64.dll"), "original");
  try {
    await callback(executablePath, root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

test("safe target uses the exact existing executable being launched", async () => {
  await withCleanScratchExecutable(async (executablePath) => {
    const result = await resolveSafeSteamEmulatorTarget(
      {
        shop: "steam",
        objectId: "2651280",
        libraryOrigin: "catalog",
        executablePath,
      },
      executablePath
    );
    assert.equal(result.ok, true);
    assert.equal(
      result.gameDir,
      path.dirname(fs.realpathSync.native(executablePath))
    );
  });
});

test("safe target rejects junctions that could escape the game tree", async () => {
  const external = fs.mkdtempSync(
    path.join(os.tmpdir(), "gamehub-steam-target-external-")
  );
  try {
    await withCleanScratchExecutable(async (executablePath, root) => {
      const junction = path.join(root, "linked-outside");
      fs.symlinkSync(external, junction, "junction");
      try {
        const result = await resolveSafeSteamEmulatorTarget(
          {
            shop: "steam",
            objectId: "2651280",
            libraryOrigin: "catalog",
            executablePath,
          },
          executablePath
        );
        assert.equal(result.ok, false);
        assert.match(result.reason, /links or junctions/i);
      } finally {
        fs.unlinkSync(junction);
      }
    });
  } finally {
    fs.rmSync(external, { recursive: true, force: true });
  }
});

test("unrelated exe.bak files are not treated as emulator artifacts", async () => {
  await withCleanScratchExecutable(async (executablePath, root) => {
    fs.writeFileSync(path.join(root, "archived.exe.bak"), "unrelated backup");
    const result = await resolveSafeSteamEmulatorTarget(
      {
        shop: "steam",
        objectId: "2651280",
        libraryOrigin: "catalog",
        executablePath,
      },
      executablePath
    );
    assert.equal(result.ok, true);
    assert.equal(
      result.artifactPaths.some((value) => value.endsWith("archived.exe.bak")),
      false
    );
  });
});

test("safe target fails closed for stale, synced, URI, UUID, and blocked paths", async () => {
  const stale = path.join(os.tmpdir(), "missing-gamehub-target.exe");
  assert.equal(
    (
      await resolveSafeSteamEmulatorTarget(
        {
          shop: "steam",
          objectId: "2651280",
          libraryOrigin: "catalog",
          executablePath: stale,
        },
        stale
      )
    ).ok,
    false
  );

  await withCleanScratchExecutable(async (executablePath) => {
    for (const game of [
      {
        shop: "steam" as const,
        objectId: "2651280",
        libraryOrigin: "sync" as const,
        executablePath,
      },
      {
        shop: "custom" as const,
        objectId: "custom-uuid",
        libraryOrigin: "custom" as const,
        executablePath,
      },
    ]) {
      assert.equal(
        (await resolveSafeSteamEmulatorTarget(game, executablePath)).ok,
        false
      );
    }
    assert.equal(
      (
        await resolveSafeSteamEmulatorTarget(
          {
            shop: "steam",
            objectId: "2651280",
            libraryOrigin: "catalog",
            executablePath,
          },
          executablePath,
          [path.dirname(executablePath)]
        )
      ).ok,
      false
    );
  });
});
