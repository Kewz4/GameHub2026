import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import { ALL_SYSTEMS, KNOWN_BINARIES } from "../emulators/known-binaries";
import { buildEmulatorRestorePatterns } from "../emulators/emulator-save-paths";
import { getEmulatorCloudSaveStrategy } from "../emulators/emulator-cloud-save-strategy";
import { buildGameHubEmulatorRules } from "./gamehub-emulator-rules";
import type { EmulatorSystem } from "@types";

const platform =
  process.platform === "win32"
    ? ("windows" as const)
    : process.platform === "darwin"
      ? ("mac" as const)
      : ("linux" as const);

const identityFor = (system: EmulatorSystem) => {
  switch (system) {
    case "wiiu":
      return "000500001019e600";
    case "switch":
      return "01002b00111a2000";
    case "n3ds":
      return "0004000000033600";
    case "wii":
      return "524d4345";
    case "ps3":
      return "BLES12345";
    case "psp":
      return "ULUS12345";
    default:
      return null;
  }
};

const saveRootsFor = (system: EmulatorSystem, installDir: string): string[] => {
  const binary = KNOWN_BINARIES[system].binary;
  switch (binary) {
    case "azahar":
      return [
        path.join(installDir, "user", "sdmc"),
        path.join(installDir, "user", "nand"),
      ];
    case "cemu":
      return [path.join(installDir, "portable", "mlc01", "usr", "save")];
    case "dolphin":
      return [path.join(installDir, "User", system === "gc" ? "GC" : "Wii")];
    case "rpcs3":
      return [
        path.join(installDir, "dev_hdd0", "home", "00000001", "savedata"),
      ];
    case "pcsx2":
      return [path.join(installDir, "memcards")];
    case "ralibretro":
      return [
        system === "psp"
          ? path.join(installDir, "Saves", "PSP", "SAVEDATA")
          : path.join(installDir, "Saves"),
      ];
    case "eden":
      return [path.join(installDir, "user", "nand", "user", "save")];
    default:
      throw new Error(`unmapped emulator binary: ${binary}`);
  }
};

const isolatedTitlePathFor = (
  system: EmulatorSystem,
  root: string,
  identity: string
) => {
  switch (system) {
    case "wiiu":
      return path.join(root, identity.slice(0, 8), identity.slice(8));
    case "switch":
      return path.join(root, "0".repeat(16), "a".repeat(32), identity);
    case "n3ds":
      return path.join(
        root,
        "Nintendo 3DS",
        "a".repeat(32),
        "b".repeat(32),
        "title",
        identity.slice(0, 8),
        identity.slice(8)
      );
    case "wii":
      return path.join(root, "title", "00010000", identity);
    case "ps3":
      return path.join(root, `${identity}-PROFILE`);
    case "psp":
      return path.join(root, `${identity}DATA00`);
    default:
      throw new Error(`no isolated title layout for ${system}`);
  }
};

describe("Cloud Saves V2 emulator coverage matrix", () => {
  it("classifies every configured console without an implicit fallback", () => {
    const strategies = new Map(
      ALL_SYSTEMS.map((system) => [
        system,
        getEmulatorCloudSaveStrategy(system, KNOWN_BINARIES[system].binary),
      ])
    );

    assert.equal(strategies.size, 15);
    assert.deepEqual(
      [...strategies]
        .filter(([, strategy]) => strategy === "dedicated-memory-card-manager")
        .map(([system]) => system),
      ["ps2"]
    );
    assert.deepEqual(
      [...strategies]
        .filter(([, strategy]) => strategy === "per-title-files")
        .map(([system]) => system),
      ["gc"]
    );
    assert.deepEqual(
      [...strategies]
        .filter(([, strategy]) => strategy === "per-rom-files")
        .map(([system]) => system),
      ["ps1", "nds", "dsi", "n64", "gb", "gbc", "gba"]
    );
    assert.deepEqual(
      [...strategies]
        .filter(([, strategy]) => strategy === "per-title-directory")
        .map(([system]) => system),
      ["ps3", "psp", "n3ds", "wiiu", "wii", "switch"]
    );
  });

  it("provides a defined save-root layout for every configured console", () => {
    for (const system of ALL_SYSTEMS) {
      const binary = KNOWN_BINARIES[system].binary;
      const installDir = path.resolve("GameHub", binary);
      const roots = saveRootsFor(system, installDir);
      assert.ok(roots.length > 0, `${system}:${binary}`);
      assert.ok(roots.every(path.isAbsolute), `${system}:${binary}:absolute`);
    }
  });

  it("round-trips stable V2 identities for every isolated console strategy", () => {
    for (const system of ALL_SYSTEMS) {
      const binary = KNOWN_BINARIES[system].binary;
      const strategy = getEmulatorCloudSaveStrategy(system, binary);
      if (strategy === "dedicated-memory-card-manager") continue;

      const sourceInstall = path.resolve("source", binary);
      const targetInstall = path.resolve("target", binary);
      const sourceRoots = saveRootsFor(system, sourceInstall);
      const targetRoots = saveRootsFor(system, targetInstall);
      assert.equal(sourceRoots.length, targetRoots.length, system);

      let sourcePath: string;
      let targetPath: string;
      let sourceRestorePatterns: string[];
      let targetRestorePatterns: string[];
      if (strategy === "per-rom-files") {
        sourcePath = path.join(sourceRoots[0], "Core", "Example.sram");
        targetPath = path.join(targetRoots[0], "Example.sram");
        sourceRestorePatterns = [];
        targetRestorePatterns = buildEmulatorRestorePatterns({
          system,
          binary,
          roots: targetRoots,
          romPath: path.resolve("roms", "Example.rom"),
        });
      } else if (strategy === "per-title-files") {
        sourcePath = path.join(
          sourceRoots[0],
          "USA",
          "Card A",
          "01-GMSE-save.gci"
        );
        targetPath = path.join(
          targetRoots[0],
          "USA",
          "Card A",
          "01-GMSE-save.gci"
        );
        sourceRestorePatterns = [];
        targetRestorePatterns = [
          path.join(targetRoots[0], "USA", "Card A", "*.gci"),
        ];
      } else {
        const identity = identityFor(system);
        assert.ok(identity, system);
        sourceRestorePatterns = buildEmulatorRestorePatterns({
          system,
          binary,
          roots: sourceRoots,
          identity,
        });
        targetRestorePatterns = buildEmulatorRestorePatterns({
          system,
          binary,
          roots: targetRoots,
          identity,
        });
        assert.ok(sourceRestorePatterns.length > 0, `${system}:source`);
        assert.ok(targetRestorePatterns.length > 0, `${system}:target`);
        sourcePath = isolatedTitlePathFor(system, sourceRoots[0], identity);
        targetPath = isolatedTitlePathFor(system, targetRoots[0], identity);
      }

      const uploaded = buildGameHubEmulatorRules({
        shop: "launchbox",
        objectId: `matrix-${system}`,
        platform,
        binary,
        system,
        emulatorInstallDir: sourceInstall,
        saveRoots: sourceRoots,
        backupPaths: [sourcePath],
        restorePatterns:
          strategy === "per-rom-files" || system === "psp"
            ? sourceRestorePatterns
            : [],
      });
      assert.equal(uploaded.length, 1, `${system}:upload`);

      const restored = buildGameHubEmulatorRules({
        shop: "launchbox",
        objectId: `matrix-${system}`,
        platform,
        binary,
        system,
        emulatorInstallDir: targetInstall,
        saveRoots: targetRoots,
        backupPaths: [],
        restorePatterns:
          strategy === "per-rom-files" ||
          strategy === "per-title-files" ||
          system === "psp"
            ? targetRestorePatterns
            : [targetPath],
        remoteFiles: [
          {
            rawPath: uploaded[0].rawPath,
            relativePath: path.basename(sourcePath),
          },
        ],
      });
      assert.equal(restored.length, 1, `${system}:restore`);
      assert.equal(restored[0].rawPath, uploaded[0].rawPath, system);
    }
  });
});
