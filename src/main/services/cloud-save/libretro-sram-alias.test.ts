import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { LIBRETRO_CORE_MAP } from "../emulators/libretro-core-map";
import {
  libretroSramTargetsOverlap,
  planLibretroSramAlias,
} from "../emulators/libretro-sram-alias";
import { LINUX_RETRO_CORES } from "../emulators/retroarch-linux";
import { buildGameHubEmulatorRules } from "./gamehub-emulator-rules";
import { canonicalizeEmulatorSnapshot } from "./canonicalize-emulator-snapshot";
import type { LocalGameSnapshotPipelineResult } from "../../../types/index";

const context = (
  platform: "windows" | "linux",
  system = "gba",
  ext = ".gba"
) => {
  const root =
    platform === "windows"
      ? "C:/GameHub/RALibretro/Saves"
      : "/home/deck/.config/retroarch/saves/mGBA";
  const core = LIBRETRO_CORE_MAP[system as keyof typeof LIBRETRO_CORE_MAP].core;
  const sramAlias = planLibretroSramAlias({
    platform,
    system,
    core,
    romPath:
      platform === "windows" ? `D:/ROMs/Example${ext}` : `/games/Example${ext}`,
    saveRoots: [root],
    windowsSramLayout: "S",
  });
  return {
    shop: "launchbox" as const,
    objectId: `same-game-${system}`,
    platform,
    binary: "ralibretro",
    system,
    emulatorInstallDir:
      platform === "windows" ? "C:/GameHub/RALibretro" : "/usr/bin",
    saveRoots: [root],
    backupPaths: [],
    restorePatterns: [],
    sramAlias,
  };
};

for (const [system, ext] of [
  ["gb", ".gb"],
  ["gbc", ".gbc"],
  ["gba", ".gba"],
  ["n64", ".z64"],
  ["nds", ".nds"],
  ["dsi", ".dsi"],
]) {
  test(`${system}: identical raw libretro SAVE_RAM maps Windows → Linux → Windows without changing portable IDs`, () => {
    const win = context("windows", system, ext);
    const linux = context("linux", system, ext);
    assert.equal(win.sramAlias.plan?.core, LINUX_RETRO_CORES[system]);
    const sourcePath = win.sramAlias.plan!.targetPath;
    const old = buildGameHubEmulatorRules({
      ...win,
      sramAlias: undefined,
      backupPaths: [sourcePath],
    })[0];
    const source = buildGameHubEmulatorRules({
      ...win,
      backupPaths: [sourcePath],
    })[0];
    assert.equal(source.rawPath, old.rawPath);
    const remoteFiles = [
      { rawPath: source.rawPath, relativePath: source.canonicalRelativePath! },
    ];
    const restored = buildGameHubEmulatorRules({ ...linux, remoteFiles })[0];
    assert.equal(restored.preferredPath, `${linux.saveRoots[0]}/Example.srm`);
    assert.equal(restored.rawPath, source.rawPath);
    const changed = buildGameHubEmulatorRules({
      ...linux,
      backupPaths: [restored.preferredPath!],
      identityFiles: remoteFiles,
    })[0];
    assert.equal(changed.rawPath, source.rawPath);
    assert.equal(changed.canonicalRelativePath, source.canonicalRelativePath);
    const back = buildGameHubEmulatorRules({
      ...win,
      remoteFiles: [
        {
          rawPath: changed.rawPath,
          relativePath: changed.canonicalRelativePath!,
        },
      ],
    })[0];
    assert.equal(back.preferredPath, sourcePath);
  });
}

test("legacy stem-based portable v2 identity remains authoritative on Linux", () => {
  const win = context("windows");
  const linux = context("linux");
  const original = buildGameHubEmulatorRules({
    ...win,
    sramAlias: undefined,
    backupPaths: ["C:/GameHub/RALibretro/Saves/Core/Example.sram"],
  })[0];
  const remoteFiles = [
    { rawPath: original.rawPath, relativePath: "Example.sram" },
  ];
  const restored = buildGameHubEmulatorRules({ ...linux, remoteFiles })[0];
  assert.equal(restored.preferredPath, `${linux.saveRoots[0]}/Example.srm`);
  assert.equal(restored.rawPath, original.rawPath);
  const local = buildGameHubEmulatorRules({
    ...linux,
    backupPaths: [restored.preferredPath!],
    identityFiles: remoteFiles,
  })[0];
  assert.equal(local.canonicalRelativePath, "Example.sram");
  assert.equal(local.rawPath, original.rawPath);
});

test("alias snapshot changes logical filename only; original payload, disk path and hash remain intact", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gamehub-sram-bytes-"));
  try {
    const payload = Buffer.from(
      Array.from({ length: 8192 }, (_, i) => i % 251)
    );
    const original = path.join(root, "Example.gba.sram");
    const loaded = path.join(root, "Example.srm");
    fs.writeFileSync(original, payload);
    fs.copyFileSync(original, loaded);
    const hash = crypto.createHash("sha256").update(payload).digest("hex");
    const linux = context("linux");
    const rule = buildGameHubEmulatorRules({
      ...linux,
      backupPaths: [linux.sramAlias.plan!.targetPath],
    })[0];
    const file = {
      variantId: "a".repeat(64),
      rawPath: rule.rawPath,
      relativePath: "Example.srm",
      hash,
      sizeBytes: payload.length,
      lastModifiedAt: "2026-09-12T00:00:00.000Z",
    };
    const snapshot: LocalGameSnapshotPipelineResult = {
      gameId: { shop: "launchbox", objectId: linux.objectId },
      ruleSourceRevision: "fixture",
      discoveryEngineVersion: 2,
      coverage: [],
      variants: [{ variantId: file.variantId, kind: "default" }],
      fileCount: 1,
      totalSizeBytes: payload.length,
      aggregateHash: "before",
      files: [file],
      sourceFiles: [
        {
          ...file,
          ruleId: rule.ruleId,
          absolutePath: loaded,
          localBindings: {
            environmentId: "fixture",
            rootId: "fixture",
            concreteUserSegment: "",
            concretePath: root,
          },
          confidence: "exact",
          provenance: [],
        },
      ],
    };
    const canonical = canonicalizeEmulatorSnapshot(
      snapshot,
      [rule],
      "linux",
      ({ files }) =>
        crypto.createHash("sha256").update(JSON.stringify(files)).digest("hex")
    );
    assert.equal(canonical.files[0].relativePath, "Example.gba.sram");
    assert.equal(canonical.sourceFiles[0].relativePath, "Example.gba.sram");
    assert.equal(canonical.sourceFiles[0].absolutePath, loaded);
    assert.equal(canonical.files[0].hash, hash);
    assert.deepEqual(fs.readFileSync(original), payload);
    assert.deepEqual(fs.readFileSync(loaded), payload);
    assert.equal(snapshot.files[0].relativePath, "Example.srm");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ambiguous saves, inactive local aliases and wrong-game identities do not silently start a fresh save", () => {
  const linux = context("linux");
  const win = context("windows");
  const current = linux.sramAlias.plan!.targetPath;
  assert.throws(
    () =>
      buildGameHubEmulatorRules({
        ...linux,
        backupPaths: [current, `${linux.saveRoots[0]}/Example.gba.sram`],
      }),
    /Multiple SRAM aliases/
  );
  assert.throws(
    () =>
      buildGameHubEmulatorRules({
        ...linux,
        backupPaths: [`${linux.saveRoots[0]}/Example.gba.sram`],
      }),
    /inactive frontend filename/
  );
  const uploaded = buildGameHubEmulatorRules({
    ...win,
    backupPaths: [win.sramAlias.plan!.targetPath],
  })[0];
  assert.deepEqual(
    buildGameHubEmulatorRules({
      ...linux,
      objectId: "other-game",
      remoteFiles: [
        { rawPath: uploaded.rawPath, relativePath: "Example.gba.sram" },
      ],
    }),
    []
  );
  assert.throws(
    () =>
      buildGameHubEmulatorRules({
        ...linux,
        remoteFiles: [
          { rawPath: uploaded.rawPath, relativePath: "example.gba.sram" },
        ],
      }),
    /exact ROM identity/
  );
  const old = buildGameHubEmulatorRules({
    ...win,
    sramAlias: undefined,
    backupPaths: [`${win.saveRoots[0]}/Example.sram`],
  })[0];
  assert.throws(
    () =>
      buildGameHubEmulatorRules({
        ...linux,
        remoteFiles: [
          { rawPath: uploaded.rawPath, relativePath: "Example.gba.sram" },
          { rawPath: old.rawPath, relativePath: "Example.sram" },
        ],
      }),
    /multiple SRAM identities/
  );
});

test("different cores, PS1 card modes, archives and custom Windows layouts receive explicit diagnostics", () => {
  for (const [system, core, romPath, windowsSramLayout] of [
    ["gba", "other_libretro", "D:/Example.gba", "S"],
    ["ps1", "mednafen_psx_libretro", "D:/Example.cue", "S"],
    ["gba", "mgba_libretro", "D:/Example.zip", "S"],
    ["gba", "mgba_libretro", "D:/Example.gba", "SC"],
  ]) {
    const policy = planLibretroSramAlias({
      platform: "windows",
      system,
      core,
      romPath,
      windowsSramLayout,
      saveRoots: ["C:/Saves"],
    });
    assert.equal(policy.plan, undefined);
    assert.ok(policy.unsupportedReason);
    assert.throws(
      () =>
        buildGameHubEmulatorRules({
          ...context("windows"),
          sramAlias: policy,
          remoteFiles: [
            {
              rawPath: "<gamehubEmulator>/launchbox/unknown",
              relativePath: "Example.srm",
            },
          ],
        }),
      /SRAM|interoperability/
    );
  }
});

test("same-stem GB/GBA games sharing a RetroArch core root are treated as a collision, not two safe destinations", () => {
  const gb = context("linux", "gb", ".gb").sramAlias.plan!;
  const gba = context("linux", "gba", ".gba").sramAlias.plan!;
  assert.notEqual(gb.canonicalFilename, gba.canonicalFilename);
  assert.equal(libretroSramTargetsOverlap(gb.targetPath, gba.targetPath), true);
  assert.equal(
    libretroSramTargetsOverlap(
      gb.targetPath,
      gba.targetPath.replace("/mGBA/", "/GBA/mGBA/")
    ),
    false
  );
});

test(
  "native restore engine honors canonical SRAM identity while writing the frontend's actual filename",
  { skip: !fs.existsSync(path.resolve("hydra-native", "hydra-native.node")) },
  async () => {
    const native = createRequire(import.meta.url)(
      path.resolve("hydra-native", "hydra-native.node")
    );
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gamehub-sram-native-"));
    try {
      const payload = Buffer.from(
        Array.from({ length: 8192 }, (_, i) => i % 251)
      );
      const original = path.join(root, "Example.gba.sram");
      const downloaded = path.join(root, "downloaded-blob");
      const saveRoot = path.join(root, "native-save");
      const nativeSave = path.join(saveRoot, "Example.srm");
      fs.mkdirSync(saveRoot);
      fs.writeFileSync(original, payload);
      fs.copyFileSync(original, downloaded);
      const hash = crypto.createHash("sha256").update(payload).digest("hex");
      const linux = context("linux");
      const rule = buildGameHubEmulatorRules({
        ...linux,
        backupPaths: [linux.sramAlias.plan!.targetPath],
      })[0];
      const variantId = "a".repeat(64);
      const file = {
        variantId,
        rawPath: rule.rawPath,
        relativePath: rule.canonicalRelativePath!,
        hash,
        sizeBytes: payload.length,
        lastModifiedAt: "2026-09-12T00:00:00.000Z",
      };
      const resolution = await native.resolveRestoreTargets({
        shop: "launchbox",
        objectId: linux.objectId,
        platform: process.platform === "win32" ? "windows" : "linux",
        homeDir: root,
        storeUserContext: { known: [] },
        approvedRules: [
          {
            kind: "file",
            rawPath: rule.rawPath,
            source: "gamehub-emulator",
            preferredPath: nativeSave,
            when: [],
          },
        ],
        variants: [{ variantId, kind: "default" }],
        files: [file],
      });
      assert.equal(resolution.blocked.length, 0);
      assert.equal(resolution.actions.length, 1);
      const action = resolution.actions[0];
      assert.equal(path.normalize(action.targetPath), nativeSave);
      assert.equal(action.relativePath, "Example.gba.sram");
      const restored = await native.replaceRestoreTargets([
        {
          ...action,
          action: "restore",
          tempPath: downloaded,
          expectedHash: hash,
        },
      ]);
      assert.equal(restored.failedFiles.length, 0);
      assert.equal(restored.restoredFiles.length, 1);
      assert.deepEqual(fs.readFileSync(nativeSave), payload);
      assert.deepEqual(fs.readFileSync(original), payload);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
);
