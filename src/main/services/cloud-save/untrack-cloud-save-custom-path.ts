import crypto from "node:crypto";

import type { CloudSaveCustomPathBindings, GameShop } from "@types";

import { NativeAddon } from "../native-addon.js";
import {
  assertCloudSaveAccountSessionCurrent,
  runWithCloudSaveAccountSession,
} from "./account-session.js";
import { invalidateCloudSaveOverview } from "./cloud-save-overview-cache.js";
import { buildLocalGameSnapshotContext } from "./build-local-game-snapshot.js";
import { createRemoteSnapshotFromLocalState } from "./create-remote-snapshot-from-local-state.js";
import {
  buildCloudSaveCustomPathRemovalProposal,
  executeCloudSaveCustomPathRemoteRemoval,
} from "./custom-path-removal.js";
import { dismissPendingCloudSaveCustomPathApprovalForRawPath } from "./custom-path-approval.js";
import { cloudSaveCustomPathContextFromPathContext } from "./custom-path.js";
import { withCloudSaveCustomPathStoreMutation } from "./custom-path-store.js";
import { executeCloudSaveCustomPathUntracking } from "./custom-path-untracking-policy.js";
import { getCloudSaveGameContext } from "./cloud-save-game-context.js";
import { listRemoteGameSnapshots } from "./list-remote-game-snapshots.js";
import {
  cloudSaveOperationGate,
  cloudSaveOperationScopeKey,
} from "./operation-gate.js";
import { getRemoteSnapshotRestoreManifest } from "./resolve-remote-snapshot-targets.js";
import {
  beginR2CloudSaveGameDeletion,
  deleteR2CloudSaveGameObjects,
  finishR2CloudSaveGameDeletion,
} from "./r2-snapshot-store.js";
import { shouldRetryCloudSaveConflict } from "./snapshot-retry-policy.js";

const publishCustomPathRemoval = async (
  objectId: string,
  shop: GameShop,
  rawPath: string,
  context: Awaited<ReturnType<typeof getCloudSaveGameContext>>,
  bindings: CloudSaveCustomPathBindings,
  attempt = 0
): Promise<void> => {
  try {
    const activeSnapshot = (await listRemoteGameSnapshots(objectId, shop))[0];
    if (!activeSnapshot) return;

    const manifest = await getRemoteSnapshotRestoreManifest(activeSnapshot, {
      objectId,
      shop,
    });
    const proposal = buildCloudSaveCustomPathRemovalProposal(manifest, rawPath);
    await executeCloudSaveCustomPathRemoteRemoval({
      proposal,
      deleteSnapshot: async () => {
        const operationId = crypto.randomUUID();
        await beginR2CloudSaveGameDeletion(objectId, shop, operationId);
        try {
          await deleteR2CloudSaveGameObjects(objectId, shop, operationId);
        } finally {
          // Publishing the active tombstone is authoritative even if orphaned
          // immutable objects remain for a later garbage-collection pass.
          await finishR2CloudSaveGameDeletion(objectId, shop, operationId);
        }
      },
      updateSnapshot: async () => {
        const aggregateHash = NativeAddon.buildSnapshotAggregateHash({
          variants: proposal.variants,
          files: proposal.files,
        });
        const localSnapshotContext = await buildLocalGameSnapshotContext(
          objectId,
          shop,
          context,
          { customPathBindings: bindings }
        );
        const committed = await createRemoteSnapshotFromLocalState(
          objectId,
          shop,
          undefined,
          localSnapshotContext,
          {
            baseVersion: activeSnapshot.version,
            expectedSnapshotId: activeSnapshot.id,
            customPathRawPaths: proposal.customPathRawPaths,
            variants: proposal.variants,
            files: proposal.files,
            aggregateHash,
            updateAnchor: false,
          }
        );
        if (!committed) {
          throw new Error("Cloud Save custom path removal was not committed");
        }
      },
    });
  } catch (error) {
    if (shouldRetryCloudSaveConflict(error, attempt)) {
      return publishCustomPathRemoval(
        objectId,
        shop,
        rawPath,
        context,
        bindings,
        attempt + 1
      );
    }
    throw error;
  }
};

const untrackCloudSaveCustomPathInAccount = (
  objectId: string,
  shop: GameShop,
  rawPath: string
) => {
  assertCloudSaveAccountSessionCurrent();
  if (!rawPath.startsWith("<custom>")) {
    throw new Error("cloud_save_custom_path_invalid");
  }

  const scopeKey = cloudSaveOperationScopeKey(objectId, shop);
  return cloudSaveOperationGate
    .runSync(
      scopeKey,
      JSON.stringify(["untrack-custom-path", rawPath]),
      async () => {
        const context = await getCloudSaveGameContext(objectId, shop);
        const customPathContext = cloudSaveCustomPathContextFromPathContext(
          context.pathContext
        );
        return withCloudSaveCustomPathStoreMutation(
          shop,
          objectId,
          customPathContext,
          async (_storageKey, bindings, mutations) =>
            executeCloudSaveCustomPathUntracking({
              publishRemoval: () =>
                publishCustomPathRemoval(
                  objectId,
                  shop,
                  rawPath,
                  context,
                  bindings
                ),
              removeBinding: () => mutations.remove(rawPath),
              dismissPendingApproval: () =>
                dismissPendingCloudSaveCustomPathApprovalForRawPath(
                  shop,
                  objectId,
                  rawPath
                ),
            })
        );
      }
    )
    .finally(() => invalidateCloudSaveOverview(objectId, shop));
};

export const untrackCloudSaveCustomPath = (
  objectId: string,
  shop: GameShop,
  rawPath: string
) =>
  runWithCloudSaveAccountSession(() =>
    untrackCloudSaveCustomPathInAccount(objectId, shop, rawPath)
  );
