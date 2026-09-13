import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setLinuxAutoLaunch } from "./linux-auto-launch";

test("Linux startup uses a persistent quoted launcher path and real hidden-launch flag", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "gamehub-autostart-"));
  try {
    const options = {
      enabled: true,
      minimized: true,
      executable: "/home/Alex Smith/GameHub.AppImage",
      home,
      environment: {},
    };
    const file = await setLinuxAutoLaunch(options);
    assert.match(
      await fs.readFile(file, "utf8"),
      /Exec="\/home\/Alex Smith\/GameHub.AppImage" "--hidden"/
    );
    await setLinuxAutoLaunch({ ...options, enabled: false });
    assert.match(await fs.readFile(file, "utf8"), /Hidden=true/);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});
test("Linux startup keeps foreign entries and archives only exact legacy GameHub entries", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "gamehub-autostart-"));
  try {
    const directory = path.join(home, ".config", "autostart");
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(
      path.join(directory, "GameHub.desktop"),
      "[Desktop Entry]\nName=GameHub\nComment=GameHubstartup script\nExec=/tmp/old\n"
    );
    const options = {
      enabled: true,
      minimized: false,
      executable: "/opt/GameHub/io.gamehub.launcher",
      home,
      environment: {},
    };
    const file = await setLinuxAutoLaunch(options);
    assert.ok(
      (await fs.readdir(directory)).some((name) =>
        name.startsWith("GameHub.desktop.migrated-")
      )
    );
    await fs.writeFile(file, "foreign entry");
    await assert.rejects(setLinuxAutoLaunch(options), /preserved/);
    assert.equal(await fs.readFile(file, "utf8"), "foreign entry");
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});
