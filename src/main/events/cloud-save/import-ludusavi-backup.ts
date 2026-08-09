import { gamesSublevel, levelKeys } from "@main/level";
import { logger } from "@main/services/logger";
import { NativeAddon } from "@main/services/native-addon";
import {
  assertCloudSaveAccountSessionCurrent,
  runWithCloudSaveAccountSession,
} from "@main/services/cloud-save/account-session";
import { assertCloudSaveSubscription } from "@main/services/cloud-save/cloud-save-access";
import { buildLocalGameSnapshotContext } from "@main/services/cloud-save/build-local-game-snapshot";
import { createRemoteSnapshotFromLocalState } from "@main/services/cloud-save/create-remote-snapshot-from-local-state";
import {
  buildLudusaviImportSnapshotContext,
  loadVerifiedLudusaviBackup,
} from "@main/services/cloud-save/ludusavi-import-plan";
import { getR2ActiveCloudSaveSnapshot } from "@main/services/cloud-save/r2-snapshot-store";
import type { GameShop, LudusaviImportResult } from "@types";

import { registerEvent } from "../register-event";

interface LudusaviImportOptions {
  dryRun?: boolean;
  replaceExisting?: boolean;
  expectedSnapshotId?: string;
}

const importLudusaviBackup = async (
  _event: Electron.IpcMainInvokeEvent,
  backupFolderPath: string,
  objectId: string,
  shop: GameShop,
  options: LudusaviImportOptions = {}
): Promise<LudusaviImportResult> =>
  runWithCloudSaveAccountSession(async () => {
    assertCloudSaveSubscription();
    const game = await gamesSublevel
      .get(levelKeys.game(shop, objectId))
      .catch(() => undefined);
    if (!game || game.isDeleted) {
      throw new Error("ludusavi_import_target_not_in_library");
    }

    const backup = await loadVerifiedLudusaviBackup(backupFolderPath);
    assertCloudSaveAccountSessionCurrent();
    const localContext = await buildLocalGameSnapshotContext(objectId, shop);
    const importedContext = buildLudusaviImportSnapshotContext(
      backup,
      localContext,
      (input) => NativeAddon.buildSnapshotAggregateHash(input)
    );
    assertCloudSaveAccountSessionCurrent();

    const current = await getR2ActiveCloudSaveSnapshot(objectId, shop);
    const currentSnapshot = current?.document?.snapshot ?? null;
    if (options.dryRun) {
      return {
        ok: false,
        status: "preview",
        currentSnapshotId: currentSnapshot?.id ?? null,
        currentVersion: currentSnapshot?.version ?? 0,
        wouldReplace:
          Boolean(currentSnapshot) &&
          currentSnapshot?.aggregateHash !== importedContext.aggregateHash,
        aggregateHash: importedContext.aggregateHash,
        fileCount: importedContext.fileCount,
        totalSizeBytes: importedContext.totalSizeBytes,
      };
    }
    if (currentSnapshot?.aggregateHash === importedContext.aggregateHash) {
      return {
        ok: true,
        status: "already-current",
        snapshotId: currentSnapshot.id,
        version: currentSnapshot.version,
        fileCount: currentSnapshot.fileCount,
        totalSizeBytes: currentSnapshot.totalSizeBytes,
      };
    }

    if (currentSnapshot && !options.replaceExisting) {
      return {
        ok: false,
        status: "confirmation-required",
        expectedSnapshotId: currentSnapshot.id,
        currentVersion: currentSnapshot.version,
        fileCount: importedContext.fileCount,
        totalSizeBytes: importedContext.totalSizeBytes,
      };
    }
    if (currentSnapshot && options.expectedSnapshotId !== currentSnapshot.id) {
      throw new Error("ludusavi_import_remote_changed");
    }

    assertCloudSaveAccountSessionCurrent();
    const snapshot = await createRemoteSnapshotFromLocalState(
      objectId,
      shop,
      undefined,
      importedContext,
      {
        baseVersion: currentSnapshot?.version ?? 0,
        expectedSnapshotId: currentSnapshot?.id ?? null,
        variants: importedContext.variants,
        files: importedContext.files,
        aggregateHash: importedContext.aggregateHash,
        customPathRawPaths: importedContext.customPathRawPaths,
        updateAnchor: false,
        assertEnvironmentCurrent: async () =>
          assertCloudSaveAccountSessionCurrent(),
      }
    );
    if (!snapshot) throw new Error("ludusavi_import_empty_snapshot");

    logger.log(
      `[Cloud Save V2] Imported verified Ludusavi backup for ${shop}:${objectId}`,
      {
        backupName: backup.gameName,
        fileCount: snapshot.fileCount,
        snapshotId: snapshot.id,
      }
    );
    return {
      ok: true,
      status: "imported",
      snapshotId: snapshot.id,
      version: snapshot.version,
      fileCount: snapshot.fileCount,
      totalSizeBytes: snapshot.totalSizeBytes,
    };
  });

registerEvent("importLudusaviBackup", importLudusaviBackup);
