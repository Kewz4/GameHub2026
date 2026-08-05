import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { buildEmulatorRestorePatterns } from "../emulators/emulator-save-paths";
import {
  buildGameHubEmulatorRules,
  gameHubLegacyEmulatorRawPath,
} from "./gamehub-emulator-rules";

const gameId = {
  shop: "launchbox" as const,
  objectId: "local-emulator-game",
};

const platform =
  process.platform === "win32"
    ? ("windows" as const)
    : process.platform === "darwin"
      ? ("mac" as const)
      : ("linux" as const);

const rules = (
  options: Omit<
    Parameters<typeof buildGameHubEmulatorRules>[0],
    "shop" | "objectId" | "platform"
  >
) =>
  buildGameHubEmulatorRules({
    ...gameId,
    platform,
    ...options,
  });

const remoteFiles = (generated: ReturnType<typeof rules>) =>
  generated.map((rule) => ({
    rawPath: rule.rawPath,
    relativePath: "save.dat",
  }));

const withTempDir = async (
  run: (directory: string) => void | Promise<void>
) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "gamehub-emulator-v2-")
  );
  try {
    await run(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
};

describe("GameHub emulator V2 rules", () => {
  it("uses stable title/profile descriptors across different install roots", async () => {
    await withTempDir((directory) => {
      const cases = [
        {
          binary: "cemu",
          system: "wiiu",
          saveRoot: "portable/mlc01/usr/save",
          titleRoot: "00050000/1019e600",
        },
        {
          binary: "eden",
          system: "switch",
          saveRoot: "user/nand/user/save",
          titleRoot: `${"0".repeat(16)}/${"a".repeat(32)}/01002b00111a2000`,
        },
        {
          binary: "azahar",
          system: "n3ds",
          saveRoot: "user/sdmc",
          titleRoot: `Nintendo 3DS/${"a".repeat(32)}/${"b".repeat(32)}/title/00040000/00033600`,
        },
        {
          binary: "dolphin",
          system: "wii",
          saveRoot: "User/Wii",
          titleRoot: "title/00010000/524d4345",
        },
        {
          binary: "rpcs3",
          system: "ps3",
          saveRoot: "dev_hdd0/home/00000001/savedata",
          titleRoot: "BLES12345-PROFILE",
        },
      ] as const;

      for (const emulator of cases) {
        const sourceInstall = path.join(directory, "source", emulator.binary);
        const targetInstall = path.join(directory, "target", emulator.binary);
        const sourceSaveRoot = path.join(sourceInstall, emulator.saveRoot);
        const targetSaveRoot = path.join(targetInstall, emulator.saveRoot);
        const sourceTitleRoot = path.join(sourceSaveRoot, emulator.titleRoot);
        const targetTitleRoot = path.join(targetSaveRoot, emulator.titleRoot);
        const uploaded = rules({
          binary: emulator.binary,
          system: emulator.system,
          emulatorInstallDir: sourceInstall,
          saveRoots: [sourceSaveRoot],
          backupPaths: [sourceTitleRoot],
          restorePatterns: [],
        });
        const cleanTarget = rules({
          binary: emulator.binary,
          system: emulator.system,
          emulatorInstallDir: targetInstall,
          saveRoots: [targetSaveRoot],
          backupPaths: [],
          restorePatterns: [targetTitleRoot],
          remoteFiles: remoteFiles(uploaded),
        });

        assert.equal(uploaded.length, 1, emulator.binary);
        assert.match(uploaded[0].rawPath, /\/v2-[0-9a-f]{64}$/);
        assert.equal(cleanTarget.length, 1, emulator.binary);
        assert.equal(cleanTarget[0].rawPath, uploaded[0].rawPath);
        assert.equal(cleanTarget[0].preferredPath, targetTitleRoot);
      }
    });
  });

  it("maps reordered Switch profiles by descriptor and never by position", async () => {
    await withTempDir((directory) => {
      const sourceInstall = path.join(directory, "source", "eden");
      const targetInstall = path.join(directory, "target", "eden");
      const sourceRoot = path.join(
        sourceInstall,
        "user",
        "nand",
        "user",
        "save"
      );
      const targetRoot = path.join(
        targetInstall,
        "user",
        "nand",
        "user",
        "save"
      );
      const account = "0".repeat(16);
      const titleId = "01002b00111a2000";
      const profileA = "a".repeat(32);
      const profileB = "b".repeat(32);
      const sourceA = path.join(sourceRoot, account, profileA, titleId);
      const sourceB = path.join(sourceRoot, account, profileB, titleId);
      const targetA = path.join(targetRoot, account, profileA, titleId);
      const targetB = path.join(targetRoot, account, profileB, titleId);
      const uploaded = rules({
        binary: "eden",
        system: "switch",
        emulatorInstallDir: sourceInstall,
        saveRoots: [sourceRoot],
        backupPaths: [sourceA, sourceB],
        restorePatterns: [],
      });
      const sourceRawByProfile = new Map(
        uploaded.map((rule) => [
          rule.preferredPath!.includes(profileA) ? profileA : profileB,
          rule.rawPath,
        ])
      );

      const reordered = rules({
        binary: "eden",
        system: "switch",
        emulatorInstallDir: targetInstall,
        saveRoots: [targetRoot],
        backupPaths: [],
        restorePatterns: [targetB, targetA],
        remoteFiles: remoteFiles(uploaded),
      });
      assert.equal(reordered.length, 2);
      for (const rule of reordered) {
        const profile = rule.preferredPath!.includes(profileA)
          ? profileA
          : profileB;
        assert.equal(rule.rawPath, sourceRawByProfile.get(profile));
      }

      const missingProfile = rules({
        binary: "eden",
        system: "switch",
        emulatorInstallDir: targetInstall,
        saveRoots: [targetRoot],
        backupPaths: [],
        restorePatterns: [targetB],
        remoteFiles: remoteFiles(uploaded),
      });
      assert.equal(missingProfile.length, 1);
      assert.equal(missingProfile[0].preferredPath, targetB);
      assert.equal(missingProfile[0].rawPath, sourceRawByProfile.get(profileB));
      assert.notEqual(
        missingProfile[0].rawPath,
        sourceRawByProfile.get(profileA)
      );

      const legacy = rules({
        binary: "eden",
        system: "switch",
        emulatorInstallDir: targetInstall,
        saveRoots: [targetRoot],
        backupPaths: [],
        restorePatterns: [targetB],
        remoteFiles: [
          {
            rawPath: gameHubLegacyEmulatorRawPath(
              gameId.shop,
              gameId.objectId,
              0
            ),
            relativePath: "save.dat",
          },
        ],
      });
      assert.deepEqual(legacy, []);
    });
  });

  it("maps reordered RPCS3 homes by account and blocks a missing profile", async () => {
    await withTempDir((directory) => {
      const sourceInstall = path.join(directory, "source", "rpcs3");
      const targetInstall = path.join(directory, "target", "rpcs3");
      const sourceRoot = (profile: string) =>
        path.join(sourceInstall, "dev_hdd0", "home", profile, "savedata");
      const targetRoot = (profile: string) =>
        path.join(targetInstall, "dev_hdd0", "home", profile, "savedata");
      const profiles = ["00000001", "00000002"];
      const sourcePaths = profiles.map((profile) =>
        path.join(sourceRoot(profile), "BLES12345-PROFILE")
      );
      const targetPaths = profiles.map((profile) =>
        path.join(targetRoot(profile), "BLES12345-PROFILE")
      );
      const uploaded = rules({
        binary: "rpcs3",
        system: "ps3",
        emulatorInstallDir: sourceInstall,
        saveRoots: profiles.map(sourceRoot),
        backupPaths: sourcePaths,
        restorePatterns: [],
      });
      const sourceRawByProfile = new Map(
        uploaded.map((rule) => [
          profiles.find((profile) => rule.preferredPath!.includes(profile))!,
          rule.rawPath,
        ])
      );

      const reordered = rules({
        binary: "rpcs3",
        system: "ps3",
        emulatorInstallDir: targetInstall,
        saveRoots: profiles.toReversed().map(targetRoot),
        backupPaths: [],
        restorePatterns: targetPaths.toReversed(),
        remoteFiles: remoteFiles(uploaded),
      });
      assert.equal(reordered.length, 2);
      for (const rule of reordered) {
        const profile = profiles.find((candidate) =>
          rule.preferredPath!.includes(candidate)
        )!;
        assert.equal(rule.rawPath, sourceRawByProfile.get(profile));
      }

      const missing = rules({
        binary: "rpcs3",
        system: "ps3",
        emulatorInstallDir: targetInstall,
        saveRoots: [targetRoot(profiles[1])],
        backupPaths: [],
        restorePatterns: [targetPaths[1]],
        remoteFiles: remoteFiles(uploaded),
      });
      assert.equal(missing.length, 1);
      assert.equal(missing[0].rawPath, sourceRawByProfile.get(profiles[1]));
      assert.equal(missing[0].preferredPath, targetPaths[1]);
    });
  });

  it("keeps legacy restore only for one deterministic profile-free root", async () => {
    await withTempDir((directory) => {
      const installDir = path.join(directory, "cemu");
      const saveRoot = path.join(
        installDir,
        "portable",
        "mlc01",
        "usr",
        "save"
      );
      const titleRoot = path.join(saveRoot, "00050000", "1019e600");
      const legacyRawPath = gameHubLegacyEmulatorRawPath(
        gameId.shop,
        gameId.objectId,
        0
      );
      const restored = rules({
        binary: "cemu",
        system: "wiiu",
        emulatorInstallDir: installDir,
        saveRoots: [saveRoot],
        backupPaths: [],
        restorePatterns: [titleRoot],
        remoteFiles: [
          { rawPath: legacyRawPath, relativePath: "user/save.dat" },
        ],
      });

      assert.equal(restored.length, 1);
      assert.equal(restored[0].rawPath, legacyRawPath);
      assert.equal(restored[0].preferredPath, titleRoot);
    });
  });

  it("rebinds stable and legacy RALibretro files by exact filename", async () => {
    await withTempDir((directory) => {
      const sourceInstall = path.join(directory, "source", "ralibretro");
      const targetInstall = path.join(directory, "target", "ralibretro");
      const sourceRoot = path.join(sourceInstall, "Saves");
      const targetRoot = path.join(targetInstall, "Saves");
      const romPath = path.join(directory, "Pokemon Red.gba");
      const sourcePaths = [
        path.join(sourceRoot, "mGBA", "Pokemon Red.gba.rtc"),
        path.join(sourceRoot, "Pokemon Red.gba.sram"),
      ];
      const uploaded = rules({
        binary: "ralibretro",
        system: "gba",
        emulatorInstallDir: sourceInstall,
        saveRoots: [sourceRoot],
        backupPaths: sourcePaths,
        restorePatterns: [],
      });
      const uploadedFiles = uploaded.map((rule) => ({
        rawPath: rule.rawPath,
        relativePath: path.basename(rule.preferredPath!),
      }));
      const patterns = buildEmulatorRestorePatterns({
        system: "gba",
        binary: "ralibretro",
        roots: [targetRoot],
        romPath,
      });
      const cleanTarget = rules({
        binary: "ralibretro",
        system: "gba",
        emulatorInstallDir: targetInstall,
        saveRoots: [targetRoot],
        backupPaths: [],
        restorePatterns: patterns,
        remoteFiles: uploadedFiles,
      });
      assert.equal(cleanTarget.length, 2);
      for (const remoteFile of uploadedFiles) {
        const target = cleanTarget.find(
          (rule) => rule.rawPath === remoteFile.rawPath
        );
        assert.equal(
          target?.preferredPath,
          path.join(targetRoot, remoteFile.relativePath)
        );
      }

      const legacyRawPath = gameHubLegacyEmulatorRawPath(
        gameId.shop,
        gameId.objectId,
        1
      );
      const legacy = rules({
        binary: "ralibretro",
        system: "gba",
        emulatorInstallDir: targetInstall,
        saveRoots: [targetRoot],
        backupPaths: [],
        restorePatterns: patterns,
        remoteFiles: [
          { rawPath: legacyRawPath, relativePath: "Pokemon Red.gba.sram" },
        ],
      });
      assert.equal(legacy.length, 1);
      assert.equal(legacy[0].rawPath, legacyRawPath);
      assert.equal(
        legacy[0].preferredPath,
        path.join(targetRoot, "Pokemon Red.gba.sram")
      );
    });
  });

  it("never widens wildcard-only or unknown emulator identities", async () => {
    await withTempDir((directory) => {
      const installDir = path.join(directory, "eden");
      const saveRoot = path.join(installDir, "user", "nand", "user", "save");
      assert.deepEqual(
        rules({
          binary: "eden",
          system: "switch",
          emulatorInstallDir: installDir,
          saveRoots: [saveRoot],
          backupPaths: [],
          restorePatterns: [path.join(saveRoot, "**", "01002b00111a2000")],
        }),
        []
      );
      assert.deepEqual(
        rules({
          binary: "eden",
          system: "switch",
          emulatorInstallDir: installDir,
          saveRoots: [saveRoot],
          backupPaths: [],
          restorePatterns: [
            path.join(
              saveRoot,
              "0".repeat(16),
              "a".repeat(32),
              "01002b00111a2000"
            ),
          ],
          remoteFiles: [
            {
              rawPath: `<gamehubEmulator>/${gameId.shop}/v2-${"f".repeat(64)}`,
              relativePath: "save.dat",
            },
          ],
        }),
        []
      );
    });
  });
});
