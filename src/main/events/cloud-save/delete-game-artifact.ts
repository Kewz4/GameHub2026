import { UploadcareSync } from "@main/services/uploadcare-sync";
import { registerEvent } from "../register-event";
import { logger } from "@main/services/logger";
import { invalidateCachedArtifacts } from "@main/services/cloud-artifacts-cache";
import { CloudSync } from "@main/services/cloud-sync";
import { assertGameArtifactKeyForUser } from "@main/services/cloud-save/game-artifact-key-policy";

const deleteGameArtifact = async (
  _event: Electron.IpcMainInvokeEvent,
  artifactId: string
) => {
  try {
    const userId = await CloudSync.getOrCreateUserId();
    assertGameArtifactKeyForUser(artifactId, userId);
    await UploadcareSync.deleteFile(artifactId);
    await invalidateCachedArtifacts();
    return { ok: true };
  } catch (err) {
    logger.error("deleteGameArtifact failed for", artifactId, err);
    throw err;
  }
};

registerEvent("deleteGameArtifact", deleteGameArtifact);
