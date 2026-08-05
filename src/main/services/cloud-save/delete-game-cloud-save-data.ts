import type { GameShop } from "@types";

import { buildLocalGameSnapshotContext } from "./build-local-game-snapshot";
import { clearCloudSaveLocalState } from "./clear-cloud-save-local-state";
import { assertCloudSaveSubscription } from "./cloud-save-access";
import { cloudSaveFileKey } from "./cloud-save-contract";
import { getCloudSaveGameContext } from "./cloud-save-game-context";
import { cloudSaveCustomPathContextFromPathContext } from "./custom-path";
import { withCloudSaveCustomPathStoreMutation } from "./custom-path-store";
import { executeDeleteGameCloudSaveData } from "./delete-game-cloud-save-data-policy";
import { deleteLocalSaveTargets } from "./delete-local-save-targets";
import { assertCloudSaveEnvironmentCurrent } from "./environment-guard";
import {
  cloudSaveOperationGate,
  cloudSaveOperationScopeKey,
} from "./operation-gate";
import {
  beginCloudSavePendingDeletion,
  clearCloudSavePendingDeletion,
  markCloudSaveRemoteDeletionStarted,
} from "./pending-deletion";
import {
  beginR2CloudSaveGameDeletion,
  deleteR2CloudSaveGameObjects,
  finishR2CloudSaveGameDeletion,
} from "./r2-snapshot-store";

export const deleteGameCloudSaveData = async (
  objectId: string,
  shop: GameShop,
  assertGameNotRunning: () => void
) => {
  assertCloudSaveSubscription();
  let deletionOperationId = "";

  return cloudSaveOperationGate.runDeletion(
    cloudSaveOperationScopeKey(objectId, shop),
    "delete-game-cloud-save-data",
    () =>
      executeDeleteGameCloudSaveData({
        beginPendingDeletion: async () => {
          const pending = await beginCloudSavePendingDeletion(objectId, shop);
          deletionOperationId = pending.operationId;
          return pending.phase;
        },
        markRemoteDeletionStarted: () =>
          markCloudSaveRemoteDeletionStarted(objectId, shop),
        clearPendingDeletion: () =>
          clearCloudSavePendingDeletion(objectId, shop),
        runWithLocalDeletionSnapshot: async (operation) => {
          const context = await getCloudSaveGameContext(objectId, shop);
          const customPathContext = cloudSaveCustomPathContextFromPathContext(
            context.pathContext
          );
          return withCloudSaveCustomPathStoreMutation(
            shop,
            objectId,
            customPathContext,
            async (customPathStorageKey, bindings) => {
              // Build the local deletion set without reading the remote head.
              // A recovered deletion intentionally leaves the R2 control in a
              // `deleting` state, so remote analysis must not be a prerequisite
              // for finishing local cleanup after a crash.
              const localSnapshotContext = await buildLocalGameSnapshotContext(
                objectId,
                shop,
                context,
                { customPathBindings: bindings }
              );
              const localEntryIds =
                localSnapshotContext.sourceFiles.map(cloudSaveFileKey);
              const cleanupRootPaths = [
                ...bindings.ready.map((binding) => binding.path),
                ...localSnapshotContext.sourceFiles.map(
                  (file) => file.localBindings.concretePath
                ),
              ];

              await operation({
                deleteLocalFiles: async () => {
                  await deleteLocalSaveTargets(
                    localSnapshotContext,
                    localEntryIds,
                    async () => {
                      assertGameNotRunning();
                      await assertCloudSaveEnvironmentCurrent(
                        objectId,
                        shop,
                        localSnapshotContext.environmentId
                      );
                    },
                    cleanupRootPaths
                  );
                },
                clearLocalState: () =>
                  clearCloudSaveLocalState(
                    objectId,
                    shop,
                    customPathStorageKey
                  ),
              });
            }
          );
        },
        assertGameNotRunning,
        deleteRemoteSnapshots: async () => {
          if (!deletionOperationId) {
            throw new Error("cloud_save_delete_pending_missing");
          }
          await beginR2CloudSaveGameDeletion(
            objectId,
            shop,
            deletionOperationId
          );
          await deleteR2CloudSaveGameObjects(
            objectId,
            shop,
            deletionOperationId
          );
        },
        finishRemoteDeletion: async () => {
          if (!deletionOperationId) {
            throw new Error("cloud_save_delete_pending_missing");
          }
          await finishR2CloudSaveGameDeletion(
            objectId,
            shop,
            deletionOperationId
          );
        },
      })
  );
};
