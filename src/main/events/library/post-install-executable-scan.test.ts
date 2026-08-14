import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  findKnownExecutableInInstallFolder,
  findPostInstallExecutable,
  findTitleMatchedInstallFolders,
  isPlausibleGameInstallFolder,
} from "./post-install-executable-scan";

const temporaryRoots: string[] = [];

const makeTemporaryRoot = async () => {
  const root = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "gamehub-post-install-")
  );
  temporaryRoots.push(root);
  return root;
};

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => fs.promises.rm(root, { recursive: true, force: true }))
  );
});

describe("post-install executable discovery", () => {
  it("matches a release-tagged folder only to its exact normalized title", () => {
    assert.equal(
      isPlausibleGameInstallFolder(
        "Marvel's Spider-Man 2 - DODI Repack",
        "Marvel's Spider-Man 2"
      ),
      true
    );
    assert.equal(
      isPlausibleGameInstallFolder("Marvel's Spider-Man", "Spider-Man 2"),
      false
    );
  });

  it("does not scan an unrelated shared-root folder with a generic exe", async () => {
    const root = await makeTemporaryRoot();
    const wrongFolder = path.join(root, "Acme Chat");
    const gameFolder = path.join(root, "Marvel's Spider-Man 2");
    await fs.promises.mkdir(wrongFolder);
    await fs.promises.mkdir(path.join(gameFolder, "bin"), { recursive: true });
    await fs.promises.writeFile(path.join(wrongFolder, "game.exe"), "wrong");
    const expected = path.join(gameFolder, "bin", "game.exe");
    await fs.promises.writeFile(expected, "right");

    assert.deepEqual(
      await findTitleMatchedInstallFolders(root, "Marvel's Spider-Man 2"),
      [gameFolder]
    );

    const result = await findPostInstallExecutable({
      gameTitle: "Marvel's Spider-Man 2",
      downloadFolderPath: path.join(root, "missing-download"),
      executableNames: ["game.exe"],
      sharedLibraryRoots: [root],
    });

    assert.deepEqual(result, {
      status: "found",
      executablePath: expected,
    });
  });

  it("prefers known executable ordering and shallower paths", async () => {
    const root = await makeTemporaryRoot();
    const shallow = path.join(root, "preferred.exe");
    await fs.promises.mkdir(path.join(root, "nested"));
    await fs.promises.writeFile(shallow, "preferred");
    await fs.promises.writeFile(path.join(root, "nested", "fallback.exe"), "x");

    assert.deepEqual(
      await findKnownExecutableInInstallFolder(root, [
        "preferred.exe",
        "fallback.exe",
      ]),
      { status: "found", executablePath: shallow }
    );
  });

  it("fails closed when equally ranked matches are ambiguous", async () => {
    const root = await makeTemporaryRoot();
    await fs.promises.mkdir(path.join(root, "a"));
    await fs.promises.mkdir(path.join(root, "b"));
    await fs.promises.writeFile(path.join(root, "a", "game.exe"), "a");
    await fs.promises.writeFile(path.join(root, "b", "game.exe"), "b");

    assert.deepEqual(
      await findKnownExecutableInInstallFolder(root, ["game.exe"]),
      { status: "ambiguous", executablePath: null }
    );
  });

  it("fails closed when separate shared roots contain the same game", async () => {
    const root = await makeTemporaryRoot();
    const firstRoot = path.join(root, "first-library");
    const secondRoot = path.join(root, "second-library");
    const gameTitle = "Khazan";
    const firstGameFolder = path.join(firstRoot, gameTitle);
    const secondGameFolder = path.join(secondRoot, gameTitle);

    await fs.promises.mkdir(firstGameFolder, { recursive: true });
    await fs.promises.mkdir(secondGameFolder, { recursive: true });
    await fs.promises.writeFile(path.join(firstGameFolder, "Khazan.exe"), "a");
    await fs.promises.writeFile(path.join(secondGameFolder, "Khazan.exe"), "b");

    assert.deepEqual(
      await findPostInstallExecutable({
        gameTitle,
        downloadFolderPath: path.join(root, "missing-download"),
        executableNames: ["Khazan.exe"],
        sharedLibraryRoots: [firstRoot, secondRoot],
      }),
      { status: "ambiguous", executablePath: null }
    );
  });

  it("fails closed instead of walking beyond its entry budget", async () => {
    const root = await makeTemporaryRoot();
    await fs.promises.mkdir(path.join(root, "nested"));
    await fs.promises.writeFile(path.join(root, "nested", "game.exe"), "x");

    assert.deepEqual(
      await findKnownExecutableInInstallFolder(root, ["game.exe"], {
        maxEntries: 1,
      }),
      { status: "budget-exceeded", executablePath: null }
    );
  });
});
