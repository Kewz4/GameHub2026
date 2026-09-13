import assert from "node:assert/strict";
import test from "node:test";
import { buildGameHubEmulatorRules } from "./gamehub-emulator-rules";

const source = {
  shop: "launchbox" as const,
  objectId: "psp:example",
  binary: "ralibretro",
  system: "psp",
  platform: "windows" as const,
  emulatorInstallDir: "C:/GameHub/RALibretro",
  saveRoots: ["C:/GameHub/RALibretro/Saves/PSP/SAVEDATA"],
  backupPaths: ["C:/GameHub/RALibretro/Saves/PSP/SAVEDATA/ULUS12345DATA00"],
  restorePatterns: ["C:/GameHub/RALibretro/Saves/PSP/SAVEDATA/ULUS12345*"],
};
const target = {
  ...source,
  platform: "linux" as const,
  emulatorInstallDir: "/usr/bin",
  saveRoots: ["/home/deck/.config/retroarch/saves/PPSSPP/PSP/SAVEDATA"],
  backupPaths: [],
  restorePatterns: [
    "/home/deck/.config/retroarch/saves/PPSSPP/PSP/SAVEDATA/ULUS12345*",
  ],
};

test("PSP clean-machine restore retains save-slot directory and the whole isolated save, across Windows/Linux", () => {
  const uploaded = buildGameHubEmulatorRules(source);
  assert.equal(uploaded.length, 1);
  assert.equal(uploaded[0].kind, "dir");
  const remoteFiles = ["PARAM.SFO", "DATA.BIN", "ICON0.PNG"].map(
    (relativePath) => ({ relativePath, rawPath: uploaded[0].rawPath })
  );
  const restored = buildGameHubEmulatorRules({ ...target, remoteFiles });
  assert.equal(restored.length, 1);
  assert.equal(restored[0].rawPath, uploaded[0].rawPath);
  assert.equal(
    restored[0].preferredPath,
    `${target.saveRoots[0]}/ULUS12345DATA00`
  );
});

test("PSP restore rejects another game's identity, tampered slot names and ambiguous roots", () => {
  const uploaded = buildGameHubEmulatorRules(source)[0];
  const remoteFiles = [{ rawPath: uploaded.rawPath, relativePath: "DATA.BIN" }];
  assert.deepEqual(
    buildGameHubEmulatorRules({
      ...target,
      objectId: "another-game",
      remoteFiles,
    }),
    []
  );
  assert.deepEqual(
    buildGameHubEmulatorRules({
      ...target,
      restorePatterns: [`${target.saveRoots[0]}/ULUS99999*`],
      remoteFiles,
    }),
    []
  );
  assert.deepEqual(
    buildGameHubEmulatorRules({
      ...target,
      remoteFiles: [
        {
          rawPath: uploaded.rawPath.replace("DATA00", "DATA01"),
          relativePath: "DATA.BIN",
        },
      ],
    }),
    []
  );
  assert.deepEqual(
    buildGameHubEmulatorRules({
      ...target,
      saveRoots: [...target.saveRoots, "/mnt/other/SAVEDATA"],
      restorePatterns: [
        ...target.restorePatterns,
        "/mnt/other/SAVEDATA/ULUS12345*",
      ],
      remoteFiles,
    }),
    []
  );
  assert.deepEqual(
    buildGameHubEmulatorRules({
      ...source,
      backupPaths: [
        `${source.saveRoots[0]}/ULUS99999DATA00`,
        source.saveRoots[0],
      ],
    }),
    []
  );
});
