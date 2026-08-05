import type {
  CloudSaveCustomPathBindings,
  CloudSaveState,
  GameShop,
} from "@types";

import { NativeAddon } from "../native-addon";
import { buildLocalGameSnapshotContext } from "./build-local-game-snapshot";
import { getCloudSaveGameContext } from "./cloud-save-game-context";
import { getRemoteGameSnapshotState } from "./list-remote-game-snapshots";
import { mergeUserVariantSnapshots } from "./merge-user-variant-snapshots";
import { getRemoteSnapshotRestoreManifest } from "./resolve-remote-snapshot-targets";
import { storeUserContextWithSnapshotAccounts } from "./snapshot-store-user-context";
import { getCloudSaveSyncAnchor } from "./sync-anchor";
import type { SyncDirection } from "./sync-game/policy";

interface AnalyzeCloudSaveStateOptions {
  customPathBindings?: CloudSaveCustomPathBindings;
}

export const analyzeCloudSaveState = async (
  objectId: string,
  shop: GameShop,
  suppliedContext?: Awaited<ReturnType<typeof getCloudSaveGameContext>>,
  syncDirection: SyncDirection = "bidirectional",
  options: AnalyzeCloudSaveStateOptions = {}
) => {
  const [context, remoteState] = await Promise.all([
    suppliedContext ?? getCloudSaveGameContext(objectId, shop),
    getRemoteGameSnapshotState(objectId, shop),
  ]);
  const { snapshots: remoteSnapshots, deletionTombstone } = remoteState;
  const activeRemoteSnapshot = remoteSnapshots[0] ?? null;
  const remoteManifest = activeRemoteSnapshot
    ? await getRemoteSnapshotRestoreManifest(activeRemoteSnapshot, {
        objectId,
        shop,
      })
    : null;
  if (
    remoteManifest &&
    (remoteManifest.snapshot.shop !== shop ||
      remoteManifest.snapshot.objectId !== objectId)
  ) {
    throw new Error("Active Cloud Save snapshot belongs to another game");
  }
  const scanStoreUserContext = storeUserContextWithSnapshotAccounts(
    context.pathContext.storeUserContext,
    remoteManifest?.variants ?? []
  );
  const localSnapshotContext = await buildLocalGameSnapshotContext(
    objectId,
    shop,
    context,
    {
      scanStoreUserContext,
      customPathBindings: options.customPathBindings,
    }
  );

  const {
    sourceFiles: _,
    environmentId,
    pathContext: __,
    ...localSnapshot
  } = localSnapshotContext;
  const anchor = await getCloudSaveSyncAnchor(
    shop,
    objectId,
    environmentId,
    localSnapshot.aggregateHash,
    localSnapshot.fileCount
  );
  const merge = mergeUserVariantSnapshots({
    local: localSnapshotContext,
    remoteVariants: remoteManifest?.variants ?? [],
    remoteFiles: remoteManifest?.files ?? [],
    base: anchor,
    direction: syncDirection,
  });
  const mergedAggregateHash = NativeAddon.buildSnapshotAggregateHash({
    variants: merge.variants,
    files: merge.files,
  });

  let currentState: CloudSaveState;
  if (deletionTombstone && localSnapshot.files.length > 0) {
    // A deletion tombstone is authoritative across devices. Local data may be
    // kept, but only through an explicit conflict choice; automatic sync must
    // never silently resurrect a save that another device deleted.
    currentState = "conflict";
  } else if (!activeRemoteSnapshot) {
    currentState = "untracked";
  } else if (merge.conflicts.length > 0) {
    currentState = "conflict";
  } else if (mergedAggregateHash !== activeRemoteSnapshot.aggregateHash) {
    currentState = "local-ahead";
  } else if (
    merge.restoreEntryIds.length > 0 ||
    merge.deleteLocalEntryIds.length > 0
  ) {
    currentState = "remote-ahead";
  } else if (merge.partial) {
    currentState = "partial";
  } else {
    currentState = "synced";
  }

  return {
    context,
    localSnapshot,
    localSnapshotContext,
    environmentId,
    syncDirection,
    anchor,
    activeRemoteSnapshot,
    remoteManifest,
    remoteDeletionTombstone: deletionTombstone,
    merge,
    mergedAggregateHash,
    state: {
      state: currentState,
      hasChanged: currentState !== "synced",
      activeRemoteSnapshot,
    },
  };
};
