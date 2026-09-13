import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { installPreservingEmulatorData } from "./install-preserving-data";

test("emulator reinstall replaces binaries but never portable saves/settings", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "gamehub-emulator-install-")
  );
  try {
    const staged = path.join(root, "staged");
    const installed = path.join(root, "installed");
    for (const base of [staged, installed]) {
      fs.mkdirSync(path.join(base, "user", "saves"), { recursive: true });
      fs.mkdirSync(path.join(base, "plugins"));
      fs.writeFileSync(path.join(base, "emulator"), base);
      fs.writeFileSync(path.join(base, "user", "saves", "game.sav"), base);
      fs.writeFileSync(path.join(base, "settings.ini"), base);
      fs.writeFileSync(path.join(base, "plugins", "plugin.so"), base);
    }
    fs.writeFileSync(path.join(installed, "user-notes.txt"), "untouched");
    installPreservingEmulatorData(staged, installed);
    assert.equal(
      fs.readFileSync(path.join(installed, "emulator"), "utf8"),
      staged
    );
    assert.equal(
      fs.readFileSync(path.join(installed, "plugins", "plugin.so"), "utf8"),
      staged
    );
    assert.equal(
      fs.readFileSync(
        path.join(installed, "user", "saves", "game.sav"),
        "utf8"
      ),
      installed
    );
    assert.equal(
      fs.readFileSync(path.join(installed, "settings.ini"), "utf8"),
      installed
    );
    assert.equal(
      fs.readFileSync(path.join(installed, "user-notes.txt"), "utf8"),
      "untouched"
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("failed emulator binary replacement rolls back previous binaries and leaves saves intact", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "gamehub-emulator-rollback-")
  );
  try {
    const staged = path.join(root, "staged");
    const installed = path.join(root, "installed");
    fs.mkdirSync(staged);
    fs.mkdirSync(installed);
    for (const name of ["a-emulator", "b-plugin", "c-data"]) {
      fs.writeFileSync(path.join(staged, name), "new");
      fs.writeFileSync(path.join(installed, name), "original");
    }
    fs.writeFileSync(path.join(installed, "progress.sav"), "save-data");
    let writes = 0;
    assert.throws(
      () =>
        installPreservingEmulatorData(staged, installed, (from, to) => {
          if (++writes === 2) throw new Error("simulated full disk");
          fs.copyFileSync(from, to);
        }),
      /simulated full disk/
    );
    for (const name of ["a-emulator", "b-plugin", "c-data"])
      assert.equal(
        fs.readFileSync(path.join(installed, name), "utf8"),
        "original"
      );
    assert.equal(
      fs.readFileSync(path.join(installed, "progress.sav"), "utf8"),
      "save-data"
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
