import type { CloudSaveState } from "@types";

export interface FirstCloudSaveSyncAnalysis {
  localSnapshot: {
    files: unknown[];
    aggregateHash: string | null;
  };
  localSnapshotContext: { customPathRawPaths: string[] };
  state: {
    activeRemoteSnapshot: { aggregateHash: string } | null;
  };
  remoteManifest: { customPathRawPaths: string[] } | null;
}

export const getFirstSyncState = (
  analysis: FirstCloudSaveSyncAnalysis
): CloudSaveState => {
  const hasLocalState =
    analysis.localSnapshot.files.length > 0 ||
    analysis.localSnapshotContext.customPathRawPaths.length > 0;
  const remoteSnapshot = analysis.state.activeRemoteSnapshot;

  if (hasLocalState && remoteSnapshot) {
    const localPaths = analysis.localSnapshotContext.customPathRawPaths;
    const remotePaths = analysis.remoteManifest?.customPathRawPaths ?? [];
    const pathsMatch =
      localPaths.length === remotePaths.length &&
      localPaths.every((value, index) => value === remotePaths[index]);
    return analysis.localSnapshot.aggregateHash ===
      remoteSnapshot.aggregateHash && pathsMatch
      ? "synced"
      : "conflict";
  }
  if (hasLocalState) return "local-ahead";
  if (remoteSnapshot) return "remote-ahead";
  return "untracked";
};
