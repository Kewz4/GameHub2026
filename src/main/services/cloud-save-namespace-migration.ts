import { logger } from "./logger";
import { R2Sync } from "./r2-sync";
import {
  assertCloudSaveAccountSessionCurrent,
  getCloudSaveAccountScopeKey,
  runWithCloudSaveAccountSession,
} from "./cloud-save/account-session";
import {
  completeCloudSaveNamespaceMigration,
  getPendingCloudSaveNamespaceMigration,
} from "./cloud-save-namespace-state";

const migrationsInFlight = new Map<string, Promise<void>>();

const runMigration = async () => {
  const pending = await getPendingCloudSaveNamespaceMigration();
  if (!pending) return;

  for (const legacyUserId of pending.legacyUserIds) {
    assertCloudSaveAccountSessionCurrent();
    const result = await R2Sync.migrateUserNamespace(
      legacyUserId,
      pending.accountUserId
    );
    assertCloudSaveAccountSessionCurrent();
    if (result.conflicts > 0) {
      logger.warn("R2 account namespace migration needs review", {
        copied: result.copied,
        alreadyCopied: result.alreadyCopied,
        conflicts: result.conflicts,
      });
      return;
    }
  }

  await completeCloudSaveNamespaceMigration(
    pending.accountUserId,
    pending.legacyUserIds
  );
};

/** Run at startup/sign-in. Calls are coalesced and failures are retryable. */
export const migratePendingCloudSaveAccountNamespace = () =>
  runWithCloudSaveAccountSession(async () => {
    const scopeKey = getCloudSaveAccountScopeKey();
    const active = migrationsInFlight.get(scopeKey);
    if (active) return active;

    const migration = runMigration()
      .catch((error: unknown) => {
        logger.warn("R2 account namespace migration deferred", {
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        if (migrationsInFlight.get(scopeKey) === migration) {
          migrationsInFlight.delete(scopeKey);
        }
      });
    migrationsInFlight.set(scopeKey, migration);
    return migration;
  });
