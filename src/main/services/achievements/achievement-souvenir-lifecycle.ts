import type {
  AchievementSouvenirRecord,
  Game,
  GameShop,
  ProfileAchievementSouvenir,
  SteamAchievement,
} from "@types";
import {
  achievementSouvenirR2Key,
  achievementSouvenirRecordKey,
  localAchievementSouvenirUrl,
  mergeAchievementSouvenirRecords,
  normalizeAchievementSouvenirName,
  profileAchievementSouvenirFromRecord,
} from "./achievement-souvenir-policy";

export interface AchievementSouvenirStore {
  get(key: string): Promise<AchievementSouvenirRecord>;
  put(key: string, record: AchievementSouvenirRecord): Promise<void>;
  values(): Promise<AchievementSouvenirRecord[]>;
}

export interface AchievementSouvenirRemote {
  upload(record: AchievementSouvenirRecord, filePath: string): Promise<string>;
  list(
    ownerId: string,
    game?: { shop: GameShop; objectId: string }
  ): Promise<AchievementSouvenirRecord[]>;
  cache(record: AchievementSouvenirRecord): Promise<string>;
  delete(ownerId: string, key: string): Promise<void>;
}

export interface AchievementSouvenirScreenshots {
  capture(
    ownerId: string,
    game: Game,
    achievement: Pick<SteamAchievement, "name" | "displayName">
  ): Promise<string>;
  reconcilePersistedPath(
    ownerId: string,
    filePath: string | null
  ): Promise<string | null>;
  delete(ownerId: string, filePath: string | null): Promise<void>;
  cleanup(ownerId: string, protectedPaths?: readonly string[]): Promise<void>;
}

export interface AchievementSouvenirLifecycleDependencies {
  store: AchievementSouvenirStore;
  remote: AchievementSouvenirRemote;
  screenshots: AchievementSouvenirScreenshots;
  currentOwnerId(): Promise<string | null>;
  fileExists(filePath: string): boolean;
  now(): number;
  warn(message: string, error: unknown): void;
}

/**
 * Account-isolated souvenir lifecycle with a durable deletion fence.
 *
 * A tombstone is deliberately retained after a successful R2 DELETE. R2 keys
 * are deterministic, so removing the fence would allow a late upload, stale
 * listing, or interrupted process to recreate an image the user deleted.
 */
export class AchievementSouvenirLifecycle {
  private readonly syncInFlight = new Map<string, Promise<void>>();
  private readonly deleteInFlight = new Map<string, Promise<void>>();
  private readonly remoteRefreshInFlight = new Map<string, Promise<void>>();
  private readonly mutationTails = new Map<string, Promise<void>>();
  private readonly uploadSourcePaths = new Set<string>();

  constructor(
    private readonly dependencies: AchievementSouvenirLifecycleDependencies
  ) {}

  private getRecord(key: string) {
    return this.dependencies.store.get(key).catch(() => null);
  }

  private enqueueMutation<T>(key: string, mutation: () => Promise<T>) {
    const previous = this.mutationTails.get(key) ?? Promise.resolve();
    const result = previous.then(mutation, mutation);
    const tail = result.then(
      () => undefined,
      () => undefined
    );
    this.mutationTails.set(key, tail);
    void tail.finally(() => {
      if (this.mutationTails.get(key) === tail) {
        this.mutationTails.delete(key);
      }
    });
    return result;
  }

  private recordsForOwner(ownerId: string) {
    return this.dependencies.store
      .values()
      .then((records) =>
        records.filter((record) => record.ownerId === ownerId)
      );
  }

  async capture(
    game: Game,
    achievement: SteamAchievement,
    unlockTime: number
  ): Promise<string | null> {
    const ownerId = await this.dependencies.currentOwnerId();
    if (!ownerId) return null;
    const key = achievementSouvenirRecordKey(
      ownerId,
      game.shop,
      game.objectId,
      achievement.name
    );

    return this.enqueueMutation(key, async () => {
      const existing = await this.getRecord(key);
      // A repeated watcher event must never clear an explicit deletion.
      if (existing?.status === "pending-delete") return null;

      const localPath = await this.dependencies.screenshots.capture(
        ownerId,
        game,
        achievement
      );
      const record: AchievementSouvenirRecord = {
        schemaVersion: 1,
        ownerId,
        shop: game.shop,
        objectId: game.objectId,
        achievementName: achievement.name,
        achievementDisplayName: achievement.displayName,
        achievementDescription: achievement.description?.trim() || null,
        achievementIconUrl: achievement.icon?.trim() || null,
        gameTitle: game.title,
        gameIconUrl: game.iconUrl,
        unlockTime,
        localPath,
        r2Key: existing?.r2Key ?? null,
        status: "local",
        updatedAt: this.dependencies.now(),
      };
      await this.dependencies.store.put(key, record);
      await this.dependencies.screenshots
        .cleanup(ownerId, [localPath, ...this.uploadSourcePaths])
        .catch((error) =>
          this.dependencies.warn(
            "Failed to prune achievement souvenirs after capture",
            error
          )
        );
      return key;
    });
  }

  sync(recordKey: string): Promise<void> {
    const existing = this.syncInFlight.get(recordKey);
    if (existing) return existing;

    const operation = (async () => {
      const record = await this.enqueueMutation(recordKey, async () => {
        const current = await this.getRecord(recordKey);
        if (!current || current.status === "pending-delete") return null;

        const localPath = await this.dependencies.screenshots
          .reconcilePersistedPath(current.ownerId, current.localPath)
          .catch((error) => {
            this.dependencies.warn(
              "Could not reconcile achievement souvenir path",
              error
            );
            return null;
          });
        if (localPath !== current.localPath) {
          const reconciled = {
            ...current,
            localPath,
            updatedAt: this.dependencies.now(),
          };
          await this.dependencies.store.put(recordKey, reconciled);
          if (localPath) this.uploadSourcePaths.add(localPath);
          return reconciled;
        }
        if (current.localPath) this.uploadSourcePaths.add(current.localPath);
        return current;
      });

      if (
        !record ||
        !record.localPath ||
        (await this.dependencies.currentOwnerId()) !== record.ownerId ||
        !this.dependencies.fileExists(record.localPath)
      ) {
        if (record?.localPath) this.uploadSourcePaths.delete(record.localPath);
        return;
      }

      let r2Key: string;
      try {
        r2Key = await this.dependencies.remote.upload(record, record.localPath);
      } finally {
        this.uploadSourcePaths.delete(record.localPath);
      }
      let deletionOwnerId: string | null = null;
      await this.enqueueMutation(recordKey, async () => {
        const current = await this.getRecord(recordKey);
        if (!current || current.status === "pending-delete") {
          deletionOwnerId = record.ownerId;
          return;
        }
        await this.dependencies.store.put(recordKey, {
          ...current,
          r2Key,
          status: "synced",
          updatedAt: this.dependencies.now(),
        });
      });

      // Delete again after a racing upload finishes. The first deletion may
      // have completed before this deterministic PUT reached R2.
      if (deletionOwnerId) {
        await this.dependencies.remote
          .delete(deletionOwnerId, r2Key)
          .catch((error) =>
            this.dependencies.warn(
              "Failed to remove achievement souvenir uploaded during delete",
              error
            )
          );
      }
      await this.dependencies.screenshots
        .cleanup(record.ownerId, [...this.uploadSourcePaths])
        .catch((error) =>
          this.dependencies.warn(
            "Failed to prune achievement souvenirs after sync",
            error
          )
        );
    })()
      .catch((error) => {
        this.dependencies.warn(
          "Achievement souvenir remains local; R2 sync will retry",
          error
        );
      })
      .finally(() => {
        if (this.syncInFlight.get(recordKey) === operation) {
          this.syncInFlight.delete(recordKey);
        }
      });
    this.syncInFlight.set(recordKey, operation);
    return operation;
  }

  private async saveRemoteRecords(
    ownerId: string,
    remoteRecords: AchievementSouvenirRecord[]
  ) {
    for (const remote of remoteRecords) {
      if (remote.ownerId !== ownerId) continue;
      const key = achievementSouvenirRecordKey(
        ownerId,
        remote.shop,
        remote.objectId,
        remote.achievementName
      );
      await this.enqueueMutation(key, async () => {
        const local = await this.getRecord(key);
        await this.dependencies.store.put(
          key,
          mergeAchievementSouvenirRecords(local, remote)
        );
      });
    }
  }

  private refreshRemote(
    ownerId: string,
    game?: { shop: GameShop; objectId: string }
  ) {
    const refreshKey = game
      ? `${ownerId}:${game.shop}:${game.objectId}`
      : `${ownerId}:*`;
    const existing = this.remoteRefreshInFlight.get(refreshKey);
    if (existing) return existing;

    const operation = this.dependencies.remote
      .list(ownerId, game)
      .then((records) => this.saveRemoteRecords(ownerId, records))
      .catch((error) => {
        this.dependencies.warn(
          "Could not refresh achievement souvenirs from R2",
          error
        );
      })
      .finally(() => {
        if (this.remoteRefreshInFlight.get(refreshKey) === operation) {
          this.remoteRefreshInFlight.delete(refreshKey);
        }
      });
    this.remoteRefreshInFlight.set(refreshKey, operation);
    return operation;
  }

  private async resolveRecordImage(
    key: string,
    expected: AchievementSouvenirRecord
  ): Promise<string | null> {
    return this.enqueueMutation(key, async () => {
      const record = await this.getRecord(key);
      if (
        !record ||
        record.ownerId !== expected.ownerId ||
        (await this.dependencies.currentOwnerId()) !== record.ownerId ||
        record.status === "pending-delete"
      ) {
        return null;
      }

      const localPath = await this.dependencies.screenshots
        .reconcilePersistedPath(record.ownerId, record.localPath)
        .catch((error) => {
          this.dependencies.warn(
            "Could not reconcile achievement souvenir path",
            error
          );
          return null;
        });
      if (localPath && this.dependencies.fileExists(localPath)) {
        if (localPath !== record.localPath) {
          await this.dependencies.store.put(key, {
            ...record,
            localPath,
            updatedAt: this.dependencies.now(),
          });
        }
        return localAchievementSouvenirUrl(localPath);
      }

      const withoutLegacyPath =
        localPath === record.localPath
          ? record
          : {
              ...record,
              localPath,
              updatedAt: this.dependencies.now(),
            };
      if (!withoutLegacyPath.r2Key) {
        if (withoutLegacyPath !== record) {
          await this.dependencies.store.put(key, withoutLegacyPath);
        }
        return null;
      }

      try {
        const cachedPath =
          await this.dependencies.remote.cache(withoutLegacyPath);
        const ownedCachedPath =
          await this.dependencies.screenshots.reconcilePersistedPath(
            record.ownerId,
            cachedPath
          );
        if (
          !ownedCachedPath ||
          !this.dependencies.fileExists(ownedCachedPath)
        ) {
          throw new Error("achievement_souvenir_cache_owner_invalid");
        }
        await this.dependencies.store.put(key, {
          ...withoutLegacyPath,
          localPath: ownedCachedPath,
          status: "synced",
          updatedAt: this.dependencies.now(),
        });
        await this.dependencies.screenshots
          .cleanup(record.ownerId, [ownedCachedPath, ...this.uploadSourcePaths])
          .catch((error) =>
            this.dependencies.warn(
              "Failed to prune cached achievement souvenirs",
              error
            )
          );
        return (await this.dependencies.currentOwnerId()) === record.ownerId
          ? localAchievementSouvenirUrl(ownedCachedPath)
          : null;
      } catch (error) {
        if (withoutLegacyPath !== record) {
          await this.dependencies.store.put(key, withoutLegacyPath);
        }
        this.dependencies.warn("Could not cache achievement souvenir", error);
        return null;
      }
    });
  }

  async getGameImages(
    shop: GameShop,
    objectId: string,
    refreshRemote: boolean
  ): Promise<Map<string, string>> {
    const ownerId = await this.dependencies.currentOwnerId();
    if (!ownerId) return new Map();
    if (refreshRemote) {
      await this.refreshRemote(ownerId, { shop, objectId });
    }

    const records = (await this.recordsForOwner(ownerId)).filter(
      (record) => record.shop === shop && record.objectId === objectId
    );
    const images = new Map<string, string>();
    for (const record of records) {
      const key = achievementSouvenirRecordKey(
        ownerId,
        record.shop,
        record.objectId,
        record.achievementName
      );
      if (record.status === "pending-delete") {
        await this.finishDelete(key);
        continue;
      }
      const imageUrl = await this.resolveRecordImage(key, record);
      if (imageUrl) {
        images.set(
          normalizeAchievementSouvenirName(record.achievementName),
          imageUrl
        );
      }
      if (record.status === "local") void this.sync(key);
    }
    return (await this.dependencies.currentOwnerId()) === ownerId
      ? images
      : new Map();
  }

  async listProfile(
    requestedOwnerId: string
  ): Promise<ProfileAchievementSouvenir[]> {
    const ownerId = await this.dependencies.currentOwnerId();
    // Private R2 capabilities never permit reading another account's prefix.
    if (!ownerId || ownerId !== requestedOwnerId) return [];

    await this.refreshRemote(ownerId);
    const records = await this.recordsForOwner(ownerId);
    const result: ProfileAchievementSouvenir[] = [];
    for (const record of records) {
      const key = achievementSouvenirRecordKey(
        ownerId,
        record.shop,
        record.objectId,
        record.achievementName
      );
      if (record.status === "pending-delete") {
        await this.finishDelete(key);
        continue;
      }
      const imageUrl = await this.resolveRecordImage(key, record);
      if (imageUrl) {
        result.push(profileAchievementSouvenirFromRecord(record, imageUrl));
      }
      if (record.status === "local") void this.sync(key);
    }
    return (await this.dependencies.currentOwnerId()) === ownerId
      ? result.toSorted((left, right) => right.unlockTime - left.unlockTime)
      : [];
  }

  private finishDelete(key: string): Promise<void> {
    const existing = this.deleteInFlight.get(key);
    if (existing) return existing;

    const operation = (async () => {
      const remoteTarget = await this.enqueueMutation(key, async () => {
        const record = await this.getRecord(key);
        if (!record || record.status !== "pending-delete") return null;

        let localPath = record.localPath;
        if (localPath) {
          localPath = await this.dependencies.screenshots
            .reconcilePersistedPath(record.ownerId, localPath)
            .catch((error) => {
              this.dependencies.warn(
                "Could not reconcile deleted souvenir path",
                error
              );
              return null;
            });
          if (localPath) {
            try {
              await this.dependencies.screenshots.delete(
                record.ownerId,
                localPath
              );
              localPath = null;
            } catch (error) {
              this.dependencies.warn(
                "Could not delete local achievement souvenir",
                error
              );
            }
          }
        }

        const r2Key = achievementSouvenirR2Key(
          record.ownerId,
          record.shop,
          record.objectId,
          record.achievementName
        );
        // Never delete this fence. It is also the durable retry record for an
        // R2 failure and the guard against a stale listing after restart.
        await this.dependencies.store.put(key, {
          ...record,
          localPath,
          r2Key,
          status: "pending-delete",
          updatedAt: this.dependencies.now(),
        });
        return { ownerId: record.ownerId, r2Key };
      });

      if (remoteTarget) {
        await this.dependencies.remote
          .delete(remoteTarget.ownerId, remoteTarget.r2Key)
          .catch((error) =>
            this.dependencies.warn(
              "Could not delete achievement souvenir from R2; retry retained",
              error
            )
          );
      }
    })().finally(() => {
      if (this.deleteInFlight.get(key) === operation) {
        this.deleteInFlight.delete(key);
      }
    });
    this.deleteInFlight.set(key, operation);
    return operation;
  }

  async delete(
    shop: GameShop,
    objectId: string,
    achievementName: string
  ): Promise<void> {
    const ownerId = await this.dependencies.currentOwnerId();
    if (!ownerId) throw new Error("achievement_souvenir_login_required");
    const key = achievementSouvenirRecordKey(
      ownerId,
      shop,
      objectId,
      achievementName
    );

    const persisted = await this.enqueueMutation(key, async () => {
      const record = await this.getRecord(key);
      if (!record || record.ownerId !== ownerId) return false;
      await this.dependencies.store.put(key, {
        ...record,
        r2Key: achievementSouvenirR2Key(
          record.ownerId,
          record.shop,
          record.objectId,
          record.achievementName
        ),
        status: "pending-delete",
        updatedAt: this.dependencies.now(),
      });
      return true;
    });
    if (persisted) await this.finishDelete(key);
  }
}
