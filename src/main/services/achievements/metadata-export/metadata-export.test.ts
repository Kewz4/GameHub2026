import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildAchievementMetadata,
  buildIconsForExistingMetadata,
  sanitizeRelativeIconPath,
} from "./build-achievement-metadata";
import {
  resolveGameSearchRoot,
  resolveContainedDirectory,
} from "../game-directory";

const achievement = {
  name: "FIRST_RUN",
  displayName: "First run",
  hidden: false,
  icon: "https://cdn.akamai.steamstatic.com/icon.png",
  icongray: "https://cdn.akamai.steamstatic.com/gray.png",
};

test("metadata export preserves existing icon filenames and matches achievement names", () => {
  const metadata = buildAchievementMetadata([achievement]);
  assert.equal(metadata.entries[0].icon, "images/1.png");
  const existing = [
    {
      ...metadata.entries[0],
      name: "first_run",
      icon: "img/custom.png",
      icongray: "img/custom-gray.png",
    },
  ];
  assert.deepEqual(
    buildIconsForExistingMetadata([achievement], existing).map(
      (icon) => icon.relativePath
    ),
    ["img/custom.png", "img/custom-gray.png"]
  );
  for (const unsafe of [
    "../../secret.png",
    "C:\\secret.png",
    "/secret.png",
    "images/../../secret.png",
  ])
    assert.equal(sanitizeRelativeIconPath(unsafe), null);
});

test("metadata scan stops at the game instead of a shared steam_settings directory", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "gamehub-metadata-test-")
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const game = path.join(root, "Games", "Hades II");
  await fs.mkdir(path.join(game, "Ship"), { recursive: true });
  await fs.mkdir(path.join(game, "Content"));
  await fs.mkdir(path.join(root, "Games", "steam_settings"));
  assert.equal(
    await resolveGameSearchRoot(path.join(game, "Ship", "Hades2.exe")),
    game
  );
  assert.equal(
    await resolveContainedDirectory(
      game,
      path.join(root, "Games", "steam_settings")
    ),
    null
  );
});
