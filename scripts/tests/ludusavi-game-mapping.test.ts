import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import {
  extractLudusaviInstallDirName,
  extractLudusaviManifestSaveMapping,
  getBuiltInSaveOverride,
  getLudusaviManifestOs,
  getLudusaviManifestStore,
  isAcceptedLudusaviFuzzyScore,
  resolveInstallDirFromExecutable,
} from "../../src/main/services/ludusavi-game-mapping.ts";

const fixture = (t: TestContext) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gamehub-pc-mapper-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
};

test("rejects the false Emberlight and Heartomics fuzzy scores", () => {
  assert.equal(isAcceptedLudusaviFuzzyScore(0.9184615384615384), false);
  assert.equal(isAcceptedLudusaviFuzzyScore(0.89556), false);
  assert.equal(isAcceptedLudusaviFuzzyScore(0.95), true);
});

test("uses the verified Ember Knights save override by exact Steam ID", () => {
  assert.deepEqual(getBuiltInSaveOverride("steam", "1135230"), {
    installDirName: "EmberKnights",
    paths: ["<base>/EmberKnights_64_Data/SaveData"],
  });
  assert.equal(getBuiltInSaveOverride("steam", "4025700"), null);
});

test("finds a nested game's manifest-named ancestor", (t) => {
  const root = fixture(t);
  const game = path.join(root, "The First Berserker Khazan");
  const binary = path.join(game, "BBQ", "Binaries", "Win64", "game.exe");
  fs.mkdirSync(path.dirname(binary), { recursive: true });
  fs.writeFileSync(binary, "");

  assert.equal(
    resolveInstallDirFromExecutable(binary, "The First Berserker: Khazan"),
    game
  );
});

test("finds the real game beside a shared launcher", (t) => {
  const root = fixture(t);
  const launcher = path.join(root, "Riot Games", "Riot Client");
  const game = path.join(root, "Riot Games", "League of Legends");
  const executable = path.join(launcher, "RiotClientServices.exe");
  fs.mkdirSync(launcher, { recursive: true });
  fs.mkdirSync(game, { recursive: true });
  fs.writeFileSync(executable, "");

  assert.equal(
    resolveInstallDirFromExecutable(executable, "League of Legends"),
    game
  );
});

test("reads installDir when it follows files in the manifest", () => {
  assert.equal(
    extractLudusaviInstallDirName([
      "  files:",
      '    "<base>/Config":',
      "      tags:",
      "        - config",
      "  installDir:",
      "    League of Legends: {}",
    ]),
    "League of Legends"
  );

  assert.equal(
    extractLudusaviInstallDirName([
      "  files: {}",
      "  installDir:",
      '    "The First Berserker: Khazan": {}',
    ]),
    "The First Berserker: Khazan"
  );
});

const conditionalManifestFixture = [
  "  files:",
  '    "<base>/shared.sav": {}',
  '    "<winDocuments>/Steam/Game/save.dat":',
  "      when:",
  "        - os: windows",
  "          store: steam",
  '    "<winLocalAppData>/Packages/Game/save.dat":',
  "      when:",
  "        - os: windows",
  "          store: microsoft",
  '    "<home>/Library/Application Support/Game/save.dat":',
  "      when:",
  "        - os: mac",
  "          store: steam",
  "  registry:",
  "    HKEY_CURRENT_USER/Software/Game/Common: {}",
  "    HKEY_CURRENT_USER/Software/Game/Steam:",
  "      when:",
  "        - store: steam",
  "    HKEY_CURRENT_USER/Software/Game/Microsoft:",
  "      when:",
  "        - store: microsoft",
  "  installDir:",
  "    Game: {}",
];

test("selects only Windows Steam files and registry from manifest conditions", () => {
  assert.deepEqual(
    extractLudusaviManifestSaveMapping(conditionalManifestFixture, {
      os: "windows",
      shop: "steam",
    }),
    {
      paths: ["<base>/shared.sav", "<winDocuments>/Steam/Game/save.dat"],
      registry: [
        "HKEY_CURRENT_USER/Software/Game/Common",
        "HKEY_CURRENT_USER/Software/Game/Steam",
      ],
      installDirName: "Game",
    }
  );
});

test("maps Xbox to Ludusavi's Microsoft store conditions", () => {
  assert.equal(getLudusaviManifestStore("xbox"), "microsoft");
  assert.deepEqual(
    extractLudusaviManifestSaveMapping(conditionalManifestFixture, {
      os: "windows",
      shop: "xbox",
    }),
    {
      paths: ["<base>/shared.sav", "<winLocalAppData>/Packages/Game/save.dat"],
      registry: [
        "HKEY_CURRENT_USER/Software/Game/Common",
        "HKEY_CURRENT_USER/Software/Game/Microsoft",
      ],
      installDirName: "Game",
    }
  );
});

test("selects macOS alternatives and never emits Windows registry there", () => {
  assert.equal(getLudusaviManifestOs("darwin"), "mac");
  assert.deepEqual(
    extractLudusaviManifestSaveMapping(conditionalManifestFixture, {
      os: "mac",
      shop: "steam",
    }),
    {
      paths: [
        "<base>/shared.sav",
        "<home>/Library/Application Support/Game/save.dat",
      ],
      registry: [],
      installDirName: "Game",
    }
  );
});
