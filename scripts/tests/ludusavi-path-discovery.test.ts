import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  resolveLudusaviPathMatches,
  toProspectiveLudusaviPath,
} from "../../src/main/services/ludusavi-path-discovery.ts";

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

test("honors literal text around a profile token and preserves file globs", (t) => {
  const fixtureRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "gamehub-ludusavi-discovery-")
  );
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

  const steamProfile = path.join(fixtureRoot, "Steam_12345");
  const unrelatedProfile = path.join(fixtureRoot, "Epic_12345");
  fs.mkdirSync(steamProfile, { recursive: true });
  fs.mkdirSync(unrelatedProfile, { recursive: true });

  assert.deepEqual(
    resolveLudusaviPathMatches(
      path.join(fixtureRoot, "Steam_<storeUserId>", "*.sav")
    ),
    [path.join(steamProfile, "*.sav")]
  );
});

test("creates an absolute prospective profile glob when no save exists yet", (t) => {
  const fixtureRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "gamehub-ludusavi-discovery-")
  );
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

  assert.equal(
    toProspectiveLudusaviPath(
      path.join(fixtureRoot, "Steam_<storeUserId>", "*.sav")
    ),
    path.join(fixtureRoot, "Steam_*", "*.sav")
  );
  assert.equal(toProspectiveLudusaviPath("<base>/save.dat"), null);
});
