import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { Game, LocalGameSnapshotContext } from "@types";

import {
  buildLudusaviImportSnapshotContext,
  discoverLudusaviMappingFolders,
  loadVerifiedLudusaviBackup,
  scanLudusaviBackupRoot,
} from "./ludusavi-import-plan";

const sha1 = (value: Buffer) =>
  crypto.createHash("sha1").update(value).digest("hex");

const createFixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gamehub-ludusavi-"));
  const folder = path.join(root, "steam-10", "My Game");
  const saveFolder = path.join(folder, "drive-C", "Users", "K", "save");
  fs.mkdirSync(saveFolder, { recursive: true });
  const slotOne = Buffer.from("slot one");
  const slotTwo = Buffer.from("slot two");
  fs.writeFileSync(path.join(saveFolder, "slot1.sav"), slotOne);
  fs.writeFileSync(path.join(saveFolder, "slot2.sav"), slotTwo);
  fs.writeFileSync(
    path.join(folder, "mapping.yaml"),
    [
      "---",
      'name: "gamehub-pc:steam:10"',
      "drives:",
      '  drive-C: "C:"',
      "backups:",
      '  - name: "."',
      '    when: "2026-08-01T10:00:00.000Z"',
      "    os: windows",
      "    files:",
      '      "C:/Users/K/save/slot1.sav":',
      `        hash: ${sha1(slotOne)}`,
      `        size: ${slotOne.length}`,
      '      "C:/Users/K/save/slot2.sav":',
      `        hash: ${sha1(slotTwo)}`,
      `        size: ${slotTwo.length}`,
      "    registry:",
      "      hash: ~",
      "    children: []",
      "",
    ].join("\n")
  );
  return { root, folder };
};

const createContext = (): LocalGameSnapshotContext => {
  const variantId = "a".repeat(64);
  return {
    gameId: { shop: "steam", objectId: "10" },
    manifestKey: "My Game",
    ruleSourceRevision: "fixture",
    discoveryEngineVersion: 4,
    coverage: [],
    variants: [{ variantId, kind: "default" }],
    files: [
      {
        variantId,
        rawPath: "<home>/save/*.sav",
        relativePath: "slot1.sav",
        hash: "b".repeat(64),
        sizeBytes: 1,
        lastModifiedAt: "2026-08-01T00:00:00.000Z",
      },
    ],
    fileCount: 1,
    totalSizeBytes: 1,
    aggregateHash: "b".repeat(64),
    sourceFiles: [
      {
        variantId,
        rawPath: "<home>/save/*.sav",
        relativePath: "slot1.sav",
        ruleId: "fixture-rule",
        absolutePath: "C:/Users/K/save/slot1.sav",
        hash: "b".repeat(64),
        sizeBytes: 1,
        lastModifiedAt: "2026-08-01T00:00:00.000Z",
        localBindings: {
          environmentId: "fixture-environment",
          rootId: "fixture-root",
          concreteUserSegment: "",
          concretePath: "C:/Users/K/save/slot1.sav",
        },
        confidence: "exact",
        provenance: ["fixture"],
      },
    ],
    environmentId: "fixture-environment",
    pathContext: {
      shop: "steam",
      objectId: "10",
      platform: "windows",
      homeDir: "C:/Users/K",
      storeUserContext: { known: [] },
    },
    customPathRawPaths: [],
  };
};

test("recursively finds GameHub Ludusavi folders and resolves their library identity", () => {
  const fixture = createFixture();
  try {
    assert.deepEqual(discoverLudusaviMappingFolders(fixture.root), [
      fixture.folder,
    ]);
    const library = [
      {
        shop: "steam",
        objectId: "10",
        title: "My Game",
        isDeleted: false,
      } as Game,
    ];
    const entries = scanLudusaviBackupRoot(fixture.root, library);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].fileCount, 2);
    assert.equal(entries[0].matchReason, "gamehub-id");
    assert.deepEqual(entries[0].suggestedGame, {
      shop: "steam",
      objectId: "10",
      title: "My Game",
    });
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("verifies Ludusavi SHA-1 metadata and maps sibling files to V2 identities", async () => {
  const fixture = createFixture();
  try {
    const backup = await loadVerifiedLudusaviBackup(fixture.folder);
    assert.equal(backup.files.length, 2);
    assert.ok(backup.files.every((file) => /^[a-f0-9]{64}$/.test(file.hash)));
    const imported = buildLudusaviImportSnapshotContext(
      backup,
      createContext(),
      () => "c".repeat(64)
    );
    assert.equal(imported.fileCount, 2);
    assert.deepEqual(imported.files.map((file) => file.relativePath).sort(), [
      "slot1.sav",
      "slot2.sav",
    ]);
    assert.ok(
      imported.sourceFiles.every((file) =>
        file.provenance.includes("ludusavi-import")
      )
    );
    assert.equal(imported.aggregateHash, "c".repeat(64));
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("matches native Windows extended-length source paths without changing archive I/O paths", async () => {
  const fixture = createFixture();
  try {
    const backup = await loadVerifiedLudusaviBackup(fixture.folder);
    const context = createContext();
    context.sourceFiles[0].absolutePath = "//?/C:/Users/K/save/slot1.sav";
    context.sourceFiles[0].localBindings.concretePath =
      "//?/C:/Users/K/save/slot1.sav";

    const imported = buildLudusaviImportSnapshotContext(backup, context, () =>
      "c".repeat(64)
    );

    assert.equal(imported.fileCount, 2);
    assert.deepEqual(imported.files.map((file) => file.relativePath).sort(), [
      "slot1.sav",
      "slot2.sav",
    ]);
    assert.deepEqual(
      imported.sourceFiles.map((file) => file.absolutePath).sort(),
      backup.files.map((file) => file.archivePath).sort()
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("derives Windows rule roots case-insensitively from mixed-case filenames", async () => {
  const fixture = createFixture();
  try {
    const backup = await loadVerifiedLudusaviBackup(fixture.folder);
    const context = createContext();
    context.sourceFiles[0].absolutePath = "//?/C:/Users/K/save/Slot1.sav";
    context.sourceFiles[0].relativePath = "Slot1.sav";
    context.sourceFiles[0].localBindings.concretePath =
      "//?/C:/Users/K/save/Slot1.sav";

    const imported = buildLudusaviImportSnapshotContext(backup, context, () =>
      "c".repeat(64)
    );

    assert.equal(imported.fileCount, 2);
    assert.deepEqual(imported.files.map((file) => file.relativePath).sort(), [
      "slot1.sav",
      "slot2.sav",
    ]);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("matches case-insensitive extended UNC sources to regular UNC backup paths", async () => {
  const fixture = createFixture();
  try {
    const backup = await loadVerifiedLudusaviBackup(fixture.folder);
    backup.files[0].originalPath = "//server/share/save/slot1.sav";
    backup.files[1].originalPath = "//server/share/save/slot2.sav";
    const context = createContext();
    context.sourceFiles[0].absolutePath = "//?/UNC/Server/Share/save/slot1.sav";
    context.sourceFiles[0].localBindings.concretePath =
      "//?/UNC/Server/Share/save/slot1.sav";

    const imported = buildLudusaviImportSnapshotContext(backup, context, () =>
      "c".repeat(64)
    );

    assert.equal(imported.fileCount, 2);
    assert.deepEqual(imported.files.map((file) => file.relativePath).sort(), [
      "slot1.sav",
      "slot2.sav",
    ]);
    assert.deepEqual(
      imported.sourceFiles.map((file) => file.absolutePath).sort(),
      backup.files.map((file) => file.archivePath).sort()
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("fails closed when an archive file cannot be assigned to a V2 save rule", async () => {
  const fixture = createFixture();
  try {
    const backup = await loadVerifiedLudusaviBackup(fixture.folder);
    backup.files[1].originalPath = "C:/Unrelated/slot2.sav";
    assert.throws(
      () =>
        buildLudusaviImportSnapshotContext(backup, createContext(), () =>
          "c".repeat(64)
        ),
      /ludusavi_import_unmapped_files/
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
