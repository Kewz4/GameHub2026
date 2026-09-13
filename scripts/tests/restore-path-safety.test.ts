import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import {
  assertNoRegistryRestorePayload,
  commitSaveRestoreJobs,
  isSaveRestoreDestinationAllowed,
  planSaveRestoreJobs,
  rebaseSaveRestoreDestination,
} from "../../src/main/events/cloud-save/restore-path-safety.ts";

const fixture = (t: TestContext) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gamehub-restore-safe-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
};

test("allows only the selected RALibretro save file", (t) => {
  const root = fixture(t);
  const red = path.join(root, "Pokemon Red.gb.sram");
  const emerald = path.join(root, "Pokemon Emerald.gba.sram");
  fs.writeFileSync(red, "red");
  fs.writeFileSync(emerald, "emerald");

  assert.equal(isSaveRestoreDestinationAllowed(red, [red]), true);
  assert.equal(isSaveRestoreDestinationAllowed(emerald, [red]), false);
});

test("allows descendants of one title folder but rejects a sibling title", (t) => {
  const root = fixture(t);
  const hyrule = path.join(root, "01002B00111A2000");
  const odyssey = path.join(root, "0100000000010000");
  fs.mkdirSync(hyrule, { recursive: true });
  fs.mkdirSync(odyssey, { recursive: true });

  assert.equal(
    isSaveRestoreDestinationAllowed(path.join(hyrule, "svdt", "save.dat"), [
      hyrule,
    ]),
    true
  );
  assert.equal(
    isSaveRestoreDestinationAllowed(path.join(odyssey, "save.dat"), [hyrule]),
    false
  );
});

test("matches Ludusavi globs without crossing into a sibling mapping", (t) => {
  const root = fixture(t);
  const allowed = [path.join(root, "Game", "Profiles", "*", "Saves")];
  assert.equal(
    isSaveRestoreDestinationAllowed(
      path.join(root, "Game", "Profiles", "42", "Saves", "slot.dat"),
      allowed
    ),
    true
  );
  assert.equal(
    isSaveRestoreDestinationAllowed(
      path.join(root, "Game", "Profiles", "42", "Other", "slot.dat"),
      allowed
    ),
    false
  );
});

test("rebases a Windows portable save onto the unique current mapper root", (t) => {
  const root = fixture(t);
  const source = path.join(root, "staging", "slot1.sav");
  const current = path.join(root, "SteamLibrary", "Hades II", "Saves");
  const jobs = planSaveRestoreJobs(
    [
      {
        sourcePath: source,
        destinationPath: path.win32.join(
          "C:/",
          "Games",
          "Hades II",
          "Saves",
          "slot1.sav"
        ),
      },
    ],
    [current]
  );
  assert.deepEqual(jobs, [
    {
      sourcePath: source,
      destinationPath: path.join(current, "slot1.sav"),
      rebased: true,
    },
  ]);
});

test("rebases a moved portable profile through the current Ludusavi glob", (t) => {
  const root = fixture(t);
  const current = path.join(root, "SteamLibrary", "Portable", "Profiles");
  assert.equal(
    rebaseSaveRestoreDestination(
      path.win32.join(
        "C:/",
        "Games",
        "Portable",
        "Profiles",
        "42",
        "Saves",
        "slot.dat"
      ),
      [path.join(current, "*", "Saves")]
    ),
    path.join(current, "42", "Saves", "slot.dat")
  );
});

test(
  "Linux restore keeps case and literal backslashes distinct and rejects foreign roots",
  { skip: process.platform === "win32" },
  (t) => {
    const root = fixture(t);
    assert.equal(
      isSaveRestoreDestinationAllowed(path.join(root, "Game", "save.dat"), [
        path.join(root, "game"),
      ]),
      false
    );
    const disguised = path.join(
      root,
      "Profiles",
      ["42", "Saves", "slot.dat"].join(String.fromCharCode(92))
    );
    assert.equal(
      isSaveRestoreDestinationAllowed(disguised, [
        path.join(root, "Profiles", "*", "Saves"),
      ]),
      false
    );
    const foreign = path.win32.join("C:/", "Games", "Game", "Saves");
    assert.equal(
      isSaveRestoreDestinationAllowed(path.win32.join(foreign, "slot.sav"), [
        foreign,
      ]),
      false
    );
  }
);

test("rejects the entire plan when one artifact path is contaminated", () => {
  assert.throws(
    () =>
      planSaveRestoreJobs(
        [
          {
            sourcePath: String.raw`C:\staging\slot1.sav`,
            destinationPath: String.raw`C:\Games\Hades II\Saves\slot1.sav`,
          },
          {
            sourcePath: String.raw`C:\staging\other.sav`,
            destinationPath: String.raw`C:\Emulators\Shared\Other Game\other.sav`,
          },
        ],
        [String.raw`C:\SteamLibrary\Hades II\Saves`]
      ),
    /Unsafe or ambiguous/
  );
});

test("fails closed when more than one current emulator profile can receive a save", () => {
  const oldDestination = String.raw`C:\OldEden\save\0000\OLDUSER\01002b00111a2000\slot.dat`;
  const allowed = [
    String.raw`D:\Eden\save\0000\USERONE\01002b00111a2000`,
    String.raw`D:\Eden\save\0000\USERTWO\01002b00111a2000`,
  ];
  assert.equal(rebaseSaveRestoreDestination(oldDestination, allowed), null);
});

test("rejects empty artifacts rather than reporting a no-op restore", () => {
  assert.throws(
    () => planSaveRestoreJobs([], [String.raw`C:\Games\Game\Saves`]),
    /does not contain any restorable files/
  );
});

test("rejects legacy registry artifacts before restoring any files", (t) => {
  const root = fixture(t);
  assert.throws(
    () => assertNoRegistryRestorePayload(root, [{ registry: { hash: "abc" } }]),
    /cannot restore safely yet/
  );

  fs.writeFileSync(path.join(root, "registry.reg"), "Windows Registry Editor");
  assert.throws(
    () => assertNoRegistryRestorePayload(root, [{ registry: null }]),
    /cannot restore safely yet/
  );
});

test("rejects duplicate sources and destinations before touching saves", (t) => {
  const root = fixture(t);
  const staging = path.join(root, "staging");
  const saves = path.join(root, "saves");
  fs.mkdirSync(staging, { recursive: true });
  fs.mkdirSync(saves, { recursive: true });

  const sourceOne = path.join(staging, "one.sav");
  const sourceTwo = path.join(staging, "two.sav");
  const destinationOne = path.join(saves, "one.sav");
  const destinationTwo = path.join(saves, "two.sav");
  fs.writeFileSync(sourceOne, "replacement-one");
  fs.writeFileSync(sourceTwo, "replacement-two");
  fs.writeFileSync(destinationOne, "original-one");
  fs.writeFileSync(destinationTwo, "original-two");

  assert.throws(
    () =>
      planSaveRestoreJobs(
        [
          { sourcePath: sourceOne, destinationPath: destinationOne },
          { sourcePath: sourceOne, destinationPath: destinationTwo },
        ],
        [saves],
        staging
      ),
    /Duplicate save artifact source/
  );
  assert.throws(
    () =>
      planSaveRestoreJobs(
        [
          { sourcePath: sourceOne, destinationPath: destinationOne },
          { sourcePath: sourceTwo, destinationPath: destinationOne },
        ],
        [saves],
        staging
      ),
    /Duplicate save artifact destination/
  );
  assert.equal(fs.readFileSync(destinationOne, "utf8"), "original-one");
  assert.equal(fs.readFileSync(destinationTwo, "utf8"), "original-two");
});

test("rejects directory, symlink, and escaped artifact sources", (t) => {
  const root = fixture(t);
  const staging = path.join(root, "staging");
  const outside = path.join(root, "outside.sav");
  const sourceDirectory = path.join(staging, "directory.sav");
  const sourceLink = path.join(staging, "link.sav");
  const destination = path.join(root, "saves", "slot.sav");
  fs.mkdirSync(sourceDirectory, { recursive: true });
  fs.writeFileSync(outside, "outside");
  fs.symlinkSync(outside, sourceLink, "file");

  assert.throws(
    () =>
      planSaveRestoreJobs(
        [{ sourcePath: sourceDirectory, destinationPath: destination }],
        [path.dirname(destination)],
        staging
      ),
    /not a regular file/
  );
  assert.throws(
    () =>
      planSaveRestoreJobs(
        [{ sourcePath: sourceLink, destinationPath: destination }],
        [path.dirname(destination)],
        staging
      ),
    /not a regular file/
  );
  assert.throws(
    () =>
      planSaveRestoreJobs(
        [{ sourcePath: outside, destinationPath: destination }],
        [path.dirname(destination)],
        staging
      ),
    /escapes its staging folder/
  );
});

test("rejects a junction inside an allowed root when it escapes elsewhere", (t) => {
  const root = fixture(t);
  const allowed = path.join(root, "game-save");
  const outside = path.join(root, "other-game");
  const junction = path.join(allowed, "linked");
  fs.mkdirSync(allowed, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.symlinkSync(outside, junction, "junction");

  assert.equal(
    isSaveRestoreDestinationAllowed(path.join(junction, "slot.sav"), [allowed]),
    false
  );
});

test("commits real files and rolls every destination back on a later failure", (t) => {
  const root = fixture(t);
  const staging = path.join(root, "staging");
  const saves = path.join(root, "saves");
  fs.mkdirSync(staging, { recursive: true });
  fs.mkdirSync(saves, { recursive: true });

  const sourceOne = path.join(staging, "one.sav");
  const sourceTwo = path.join(staging, "two.sav");
  const destinationOne = path.join(saves, "one.sav");
  const destinationTwo = path.join(saves, "two.sav");
  fs.writeFileSync(sourceOne, "new-one");
  fs.writeFileSync(sourceTwo, "new-two");
  fs.writeFileSync(destinationOne, "old-one");
  fs.writeFileSync(destinationTwo, "old-two");

  const jobs = planSaveRestoreJobs(
    [
      { sourcePath: sourceOne, destinationPath: destinationOne },
      { sourcePath: sourceTwo, destinationPath: destinationTwo },
    ],
    [saves]
  );
  const injectedMove = (sourcePath: string, destinationPath: string) => {
    if (sourcePath === sourceTwo)
      throw new Error("injected second move failure");
    fs.renameSync(sourcePath, destinationPath);
  };

  assert.throws(
    () => commitSaveRestoreJobs(jobs, { moveFile: injectedMove }),
    /injected second move failure/
  );
  assert.equal(fs.readFileSync(destinationOne, "utf8"), "old-one");
  assert.equal(fs.readFileSync(destinationTwo, "utf8"), "old-two");
  assert.equal(
    fs.readdirSync(saves).some((name) => name.endsWith(".bak")),
    false
  );
});
