import { randomUUID } from "node:crypto";

export type ImmutableSnapshotPublicationResult =
  | "created"
  | "already-present"
  | "collision";

export const createCloudSaveSnapshotProposalId = () => randomUUID();

export const createCloudSaveRemoteHeadConflictError = () => {
  const error = new Error("cloud_save_remote_head_conflict") as Error & {
    code?: string;
  };
  error.code = "cloud_save_remote_head_conflict";
  return error;
};

/**
 * Publish a proposal's immutable manifest before conditionally advancing the
 * control document. The two writes intentionally are not a transaction: a
 * failed control write can leave a harmless orphan, while the control CAS is
 * the sole authority for the active snapshot.
 */
export const publishCloudSaveSnapshotProposal = async ({
  publishImmutableSnapshot,
  advanceControl,
}: {
  publishImmutableSnapshot: () => Promise<ImmutableSnapshotPublicationResult>;
  advanceControl: () => Promise<void>;
}) => {
  const result = await publishImmutableSnapshot();
  if (result === "collision") {
    // A new proposal will receive a new UUID, so this is recoverable through
    // the same full-flow retry used for a losing control CAS.
    throw createCloudSaveRemoteHeadConflictError();
  }
  await advanceControl();
};
