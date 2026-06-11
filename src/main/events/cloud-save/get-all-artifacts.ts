import { UploadcareSync } from "@main/services/uploadcare-sync";
import { registerEvent } from "../register-event";
import { db, gamesSublevel, levelKeys } from "@main/level";
import type { UserPreferences } from "@types";

const getAllArtifacts = async (_event: Electron.IpcMainInvokeEvent) => {
  const prefs = await db
    .get<
      string,
      UserPreferences
    >(levelKeys.userPreferences, { valueEncoding: "json" })
    .catch(() => ({}) as UserPreferences);

  const userId = prefs?.cloudSyncUserId ?? "anonymous";

  const artifacts = await UploadcareSync.listAllArtifacts(userId);

  // Enrich with game title and icon from local DB
  const enriched = await Promise.all(
    artifacts.map(async (artifact) => {
      let game = await gamesSublevel
        .get(levelKeys.game(artifact.shop, artifact.objectId))
        .catch(() => null);

      // Legacy imports used the game title as objectId — search by title
      if (!game) {
        const all = await gamesSublevel.iterator().all().catch(() => []);
        const match = all.find(
          ([, g]) =>
            !g.isDeleted &&
            g.title?.toLowerCase() === artifact.objectId?.toLowerCase()
        );
        if (match) game = match[1];
      }

      return {
        ...artifact,
        gameTitle: game?.title ?? artifact.objectId ?? `${artifact.shop}:${artifact.objectId}`,
        gameIconUrl: game?.customIconUrl ?? game?.iconUrl ?? null,
      };
    })
  );

  return enriched;
};

registerEvent("getAllArtifacts", getAllArtifacts);
