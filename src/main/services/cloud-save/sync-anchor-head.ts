import type { CloudSaveSyncAnchor } from "@types";

/** An anchor describes one existing snapshot lineage, not proof of deletion.
 * A missing head, a replacement snapshot, or a rolled-back version must go
 * through first-sync reconciliation. Only an explicit remote tombstone can
 * offer the separate, user-confirmed whole-game deletion flow.
 */
export function selectCloudSaveSyncAnchor(
  anchor: CloudSaveSyncAnchor | null,
  activeSnapshot: { id: string; version: number } | null
): CloudSaveSyncAnchor | null {
  if (
    !anchor ||
    !activeSnapshot ||
    anchor.baseSnapshotId !== activeSnapshot.id ||
    anchor.baseVersion > activeSnapshot.version
  )
    return null;
  return anchor;
}
