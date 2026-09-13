import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import { validateManualSavePath } from "../../src/main/events/cloud-save/manual-save-path.ts";

const fixture = (t: TestContext) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gamehub-manual-save-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
};

test("accepts a specific existing save directory", (t) => {
  const root = fixture(t);
  const save = path.join(root, "game", "saves");
  fs.mkdirSync(save, { recursive: true });

  assert.equal(validateManualSavePath(save, []), fs.realpathSync(save));
});

test("rejects relative, missing, and file paths", (t) => {
  const root = fixture(t);
  const file = path.join(root, "save.dat");
  fs.writeFileSync(file, "save");

  assert.throws(
    () => validateManualSavePath("relative/save", []),
    /absolute path/
  );
  assert.throws(
    () => validateManualSavePath(path.join(root, "missing"), []),
    /does not exist/
  );
  assert.throws(() => validateManualSavePath(file, []), /must be a folder/);
});

test("rejects filesystem roots and broad folders containing GameHub", (t) => {
  const root = fixture(t);
  const install = path.join(root, "GameHub", "data");
  fs.mkdirSync(install, { recursive: true });

  assert.throws(
    () => validateManualSavePath(path.parse(root).root, []),
    /filesystem root/
  );
  assert.throws(
    () => validateManualSavePath(root, [install]),
    /GameHub application or data folder/
  );
  assert.throws(
    () => validateManualSavePath(install, [install]),
    /GameHub application or data folder/
  );
});

test("allows a specific emulator save below the protected data directory", (t) => {
  const root = fixture(t);
  const data = path.join(root, "GameHub", "data");
  const save = path.join(data, "emulators", "ralibretro", "Saves", "game");
  fs.mkdirSync(save, { recursive: true });

  assert.equal(validateManualSavePath(save, [data]), fs.realpathSync(save));
});
