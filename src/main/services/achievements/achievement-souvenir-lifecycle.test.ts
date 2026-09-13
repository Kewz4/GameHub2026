import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import type { AchievementSouvenirRecord, Game, SteamAchievement } from "@types";
import {
  achievementSouvenirR2Key,
  achievementSouvenirScreenshotPath,
  isOwnedAchievementSouvenirPath,
} from "./achievement-souvenir-policy";
import {
  AchievementSouvenirLifecycle,
  type AchievementSouvenirLifecycleDependencies,
} from "./achievement-souvenir-lifecycle";

const game = {
  shop: "steam",
  objectId: "123",
  title: "Shared Game",
  iconUrl: null,
} as Game;

const achievement = {
  name: "ACH_WIN",
  displayName: "Winner",
  description: "Defeat the final boss.",
  icon: "https://cdn.example/achievement.png",
} as SteamAchievement;

class MemoryStore {
  readonly records = new Map<string, AchievementSouvenirRecord>();

  async get(key: string) {
    const record = this.records.get(key);
    if (!record) throw new Error("not_found");
    return structuredClone(record);
  }

  async put(key: string, record: AchievementSouvenirRecord) {
    this.records.set(key, structuredClone(record));
  }

  async values() {
    return [...this.records.values()].map((record) => structuredClone(record));
  }
}

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
};

describe("achievement souvenir lifecycle", () => {
  it("separates identical captures and lookups across account sessions", async () => {
    const root = path.join("C:\\", "private-souvenirs");
    const store = new MemoryStore();
    const files = new Set<string>();
    const cleanupOwners: string[] = [];
    let ownerId: string | null = "account-a";
    let switchOwnerDuringList = false;
    const dependencies: AchievementSouvenirLifecycleDependencies = {
      store,
      currentOwnerId: async () => ownerId,
      now: () => 1,
      fileExists: (filePath) => files.has(filePath),
      warn: () => undefined,
      screenshots: {
        capture: async (captureOwner, captureGame, captureAchievement) => {
          const filePath = achievementSouvenirScreenshotPath(root, {
            ownerId: captureOwner,
            shop: captureGame.shop,
            objectId: captureGame.objectId,
            gameTitle: captureGame.title,
            achievementName: captureAchievement.name,
            achievementDisplayName: captureAchievement.displayName,
          });
          files.add(filePath);
          return filePath;
        },
        reconcilePersistedPath: async (expectedOwner, filePath) =>
          filePath &&
          files.has(filePath) &&
          isOwnedAchievementSouvenirPath(root, expectedOwner, filePath)
            ? filePath
            : null,
        delete: async (expectedOwner, filePath) => {
          if (
            filePath &&
            isOwnedAchievementSouvenirPath(root, expectedOwner, filePath)
          ) {
            files.delete(filePath);
          }
        },
        cleanup: async (cleanupOwner, protectedPaths = []) => {
          cleanupOwners.push(cleanupOwner);
          for (const protectedPath of protectedPaths) {
            assert.equal(
              isOwnedAchievementSouvenirPath(root, cleanupOwner, protectedPath),
              true
            );
          }
        },
      },
      remote: {
        upload: async () => {
          throw new Error("unexpected_upload");
        },
        list: async () => {
          if (switchOwnerDuringList) ownerId = "account-b";
          return [];
        },
        cache: async () => {
          throw new Error("unexpected_cache");
        },
        delete: async () => undefined,
      },
    };
    const lifecycle = new AchievementSouvenirLifecycle(dependencies);

    const accountAKey = await lifecycle.capture(game, achievement, 10);
    ownerId = "account-b";
    const accountBKey = await lifecycle.capture(game, achievement, 20);
    assert.ok(accountAKey);
    assert.ok(accountBKey);
    assert.notEqual(accountAKey, accountBKey);
    const accountARecord = store.records.get(accountAKey);
    const accountBRecord = store.records.get(accountBKey);
    assert.ok(accountARecord?.localPath);
    assert.ok(accountBRecord?.localPath);
    assert.notEqual(accountARecord.localPath, accountBRecord.localPath);
    assert.equal(
      accountARecord.achievementDescription,
      "Defeat the final boss."
    );
    assert.equal(
      accountARecord.achievementIconUrl,
      "https://cdn.example/achievement.png"
    );

    const accountBProfile = await lifecycle.listProfile("account-b");
    assert.equal(accountBProfile.length, 1);
    assert.equal(accountBProfile[0].ownerId, "account-b");
    assert.equal(accountBProfile[0].imageUrl.includes("account-a"), false);
    assert.equal(
      accountBProfile[0].achievementDescription,
      "Defeat the final boss."
    );
    assert.equal(
      accountBProfile[0].achievementIconUrl,
      "https://cdn.example/achievement.png"
    );
    assert.deepEqual(await lifecycle.listProfile("account-a"), []);
    assert.deepEqual(cleanupOwners, ["account-a", "account-b"]);

    ownerId = "account-a";
    switchOwnerDuringList = true;
    assert.deepEqual(await lifecycle.listProfile("account-a"), []);
  });

  it("retains a tombstone through upload races, delete failure, and restart", async () => {
    const root = path.join("C:\\", "private-souvenirs");
    const store = new MemoryStore();
    const files = new Set<string>();
    const remoteObjects = new Map<string, AchievementSouvenirRecord>();
    const uploadStarted = deferred();
    const releaseUpload = deferred();
    let failRemoteDelete = true;
    let deleteAttempts = 0;
    let captureCount = 0;
    let clock = 100;

    const dependencies: AchievementSouvenirLifecycleDependencies = {
      store,
      currentOwnerId: async () => "account-a",
      now: () => ++clock,
      fileExists: (filePath) => files.has(filePath),
      warn: () => undefined,
      screenshots: {
        capture: async (ownerId, captureGame, captureAchievement) => {
          captureCount += 1;
          const filePath = achievementSouvenirScreenshotPath(root, {
            ownerId,
            shop: captureGame.shop,
            objectId: captureGame.objectId,
            gameTitle: captureGame.title,
            achievementName: captureAchievement.name,
            achievementDisplayName: captureAchievement.displayName,
          });
          files.add(filePath);
          return filePath;
        },
        reconcilePersistedPath: async (ownerId, filePath) =>
          filePath &&
          files.has(filePath) &&
          isOwnedAchievementSouvenirPath(root, ownerId, filePath)
            ? filePath
            : null,
        delete: async (ownerId, filePath) => {
          if (
            filePath &&
            isOwnedAchievementSouvenirPath(root, ownerId, filePath)
          ) {
            files.delete(filePath);
          }
        },
        cleanup: async () => undefined,
      },
      remote: {
        upload: async (record) => {
          uploadStarted.resolve();
          await releaseUpload.promise;
          const key = achievementSouvenirR2Key(
            record.ownerId,
            record.shop,
            record.objectId,
            record.achievementName
          );
          remoteObjects.set(key, {
            ...record,
            localPath: null,
            r2Key: key,
            status: "synced",
          });
          return key;
        },
        list: async (ownerId) =>
          [...remoteObjects.values()].filter(
            (record) => record.ownerId === ownerId
          ),
        cache: async () => {
          throw new Error("unexpected_cache");
        },
        delete: async (_ownerId, key) => {
          deleteAttempts += 1;
          if (failRemoteDelete) throw new Error("r2_unavailable");
          remoteObjects.delete(key);
        },
      },
    };

    const firstProcess = new AchievementSouvenirLifecycle(dependencies);
    const recordKey = await firstProcess.capture(game, achievement, 10);
    assert.ok(recordKey);
    const syncing = firstProcess.sync(recordKey);
    await uploadStarted.promise;

    // This is intentionally best-effort: the user-visible delete succeeds as
    // soon as the durable fence exists, even while R2 is unavailable.
    await firstProcess.delete("steam", "123", "ACH_WIN");
    let persisted = store.records.get(recordKey);
    assert.equal(persisted?.status, "pending-delete");
    assert.equal(persisted?.localPath, null);
    assert.equal(files.size, 0);

    releaseUpload.resolve();
    await syncing;
    const deterministicKey = achievementSouvenirR2Key(
      "account-a",
      "steam",
      "123",
      "ACH_WIN"
    );
    assert.equal(remoteObjects.has(deterministicKey), true);
    assert.equal(deleteAttempts, 2);
    assert.equal(store.records.get(recordKey)?.status, "pending-delete");

    // A new process has no in-memory race state. Its remote refresh sees the
    // late object, but the persisted tombstone wins and drives another DELETE.
    failRemoteDelete = false;
    const restartedProcess = new AchievementSouvenirLifecycle(dependencies);
    assert.deepEqual(await restartedProcess.listProfile("account-a"), []);
    assert.equal(remoteObjects.has(deterministicKey), false);
    persisted = store.records.get(recordKey);
    assert.equal(persisted?.status, "pending-delete");
    assert.equal(persisted?.r2Key, deterministicKey);
    assert.equal(deleteAttempts, 3);

    // A repeated watcher event cannot clear the deletion fence or recreate the
    // deterministic R2 object.
    assert.equal(await restartedProcess.capture(game, achievement, 30), null);
    assert.equal(captureCount, 1);
    assert.equal(store.records.get(recordKey)?.status, "pending-delete");
  });
});
