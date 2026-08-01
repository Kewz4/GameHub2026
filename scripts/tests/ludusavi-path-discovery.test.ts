import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveLudusaviPathMatches } from "../../src/main/services/ludusavi-path-discovery.ts";

test("returns every matching profile save directory", (t) => {
  const fixtureRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "gamehub-ludusavi-discovery-")
  );
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

  const firstSave = path.join(fixtureRoot, "profile-a", "saves");
  const secondSave = path.join(fixtureRoot, "profile-b", "saves");
  fs.mkdirSync(firstSave, { recursive: true });
  fs.mkdirSync(secondSave, { recursive: true });
  fs.mkdirSync(path.join(fixtureRoot, "profile-without-saves"));

  const matches = resolveLudusaviPathMatches(
    path.join(fixtureRoot, "<storeUserId>", "saves")
  );

  assert.deepEqual(matches, [firstSave, secondSave]);
});

test("resolves multiple unresolved directory levels", (t) => {
  const fixtureRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "gamehub-ludusavi-discovery-")
  );
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

  const firstSave = path.join(fixtureRoot, "profile-a", "slot-1", "saves");
  const secondSave = path.join(fixtureRoot, "profile-a", "slot-2", "saves");
  fs.mkdirSync(firstSave, { recursive: true });
  fs.mkdirSync(secondSave, { recursive: true });

  const matches = resolveLudusaviPathMatches(
    path.join(fixtureRoot, "<storeUserId>", "<slot>", "saves")
  );

  assert.deepEqual(matches, [firstSave, secondSave]);
});
