import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  ACHIEVEMENT_SOUVENIR_QUARANTINE_DIRECTORY,
  achievementSouvenirScreenshotPath,
} from "./achievement-souvenir-policy";
import { AchievementSouvenirLocalStorage } from "./achievement-souvenir-local-storage";

const temporaryRoots: string[] = [];

const temporaryRoot = async () => {
  const root = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "gamehub-souvenir-storage-")
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

describe("achievement souvenir local storage", () => {
  it("quarantines an ambiguous legacy cache without assigning it to an account", async () => {
    const root = await temporaryRoot();
    const storage = new AchievementSouvenirLocalStorage(root);
    const legacyPath = path.join(root, "Shared Game-old", "Winner-old.jpeg");
    await fs.promises.mkdir(path.dirname(legacyPath), { recursive: true });
    await fs.promises.writeFile(legacyPath, "legacy-owner-unknown");

    assert.equal(
      await storage.reconcilePersistedPath("account-a", legacyPath),
      null
    );
    assert.equal(fs.existsSync(legacyPath), false);
    const quarantined = await fs.promises.readdir(
      path.join(root, ACHIEVEMENT_SOUVENIR_QUARANTINE_DIRECTORY)
    );
    assert.equal(quarantined.length, 1);
    assert.doesNotMatch(quarantined[0], /account-a|Shared Game|Winner/i);
  });

  it("never returns or removes another account's owned cache", async () => {
    const root = await temporaryRoot();
    const storage = new AchievementSouvenirLocalStorage(root);
    const accountAPath = achievementSouvenirScreenshotPath(root, {
      ownerId: "account-a",
      shop: "steam",
      objectId: "123",
      gameTitle: "Shared Game",
      achievementName: "ACH_WIN",
      achievementDisplayName: "Winner",
    });
    await fs.promises.mkdir(path.dirname(accountAPath), { recursive: true });
    await fs.promises.writeFile(accountAPath, "account-a-private");

    assert.equal(
      await storage.prepareOwnedFilePath("account-a", accountAPath),
      accountAPath
    );
    await assert.rejects(
      storage.prepareOwnedFilePath("account-b", accountAPath),
      /achievement_souvenir_path_outside_root/
    );

    assert.equal(
      await storage.reconcilePersistedPath("account-b", accountAPath),
      null
    );
    await assert.rejects(
      storage.delete("account-b", accountAPath),
      /achievement_souvenir_path_outside_root/
    );
    assert.equal(
      await fs.promises.readFile(accountAPath, "utf8"),
      "account-a-private"
    );
    assert.equal(
      await storage.reconcilePersistedPath("account-a", accountAPath),
      accountAPath
    );
  });
});
