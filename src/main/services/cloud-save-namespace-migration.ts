import { logger } from "./logger";
import { R2Sync } from "./r2-sync";
import {
  completeCloudSaveNamespaceMigration,
  getPendingCloudSaveNamespaceMigration,
} from "./cloud-save-namespace-state";

let migrationInFlight: Promise<void> | null = null;

const runMigration = async () => {
  const pending = await getPendingCloudSaveNamespaceMigration();
  if (!pending) return;

  for (const legacyUserId of pending.legacyUserIds) {
    const result = await R2Sync.migrateUserNamespace(
      legacyUserId,
      pending.accountUserId
    );
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
export const migratePendingCloudSaveAccountNamespace = () => {
  if (!migrationInFlight) {
    migrationInFlight = runMigration()
      .catch((error: unknown) => {
        logger.warn("R2 account namespace migration deferred", {
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        migrationInFlight = null;
      });
  }
  return migrationInFlight;
};
