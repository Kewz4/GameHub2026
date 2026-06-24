import { registerEvent } from "../register-event";
import { HydraApi, logger } from "@main/services";
import { gamesSublevel } from "@main/level";
import { WindowManager } from "@main/services/window-manager";

/**
 * Wipes the user's ENTIRE Hydra cloud library. Enumerates every game on the
 * cloud profile and DELETEs each one, then clears the locally-cached remoteId so
 * a subsequent login won't try to reconcile against stale cloud records.
 *
 * This is the nuclear reset for when the cloud library has accumulated junk
 * (Playnite/Exophase imports, ghost entries) that keeps repopulating the local
 * library on login. It does NOT touch the local library itself — use "Delete
 * Entire Library" for that — it only empties the cloud side.
 */
const deleteCloudLibrary = async (_event: Electron.IpcMainInvokeEvent) => {
  if (!HydraApi.isLoggedIn()) {
    return { deleted: 0, error: "not-logged-in" };
  }

  const remoteGames = await HydraApi.get<
    Array<{ id: string; shop: string; objectId: string }>
  >("/profile/games").catch(() => []);

  let deleted = 0;
  for (const remote of remoteGames) {
    const ok = await HydraApi.delete(`/profile/games/${remote.id}`)
      .then(() => true)
      .catch(() => false);
    if (ok) deleted++;
  }

  // Strip the cached remoteId from every local game so the next login doesn't
  // treat them as still-present in the cloud (and so removing them locally
  // later won't fire a spurious cloud delete).
  const entries = await gamesSublevel
    .iterator()
    .all()
    .catch(() => []);
  for (const [key, game] of entries) {
    if (game && game.remoteId) {
      await gamesSublevel.put(key, { ...game, remoteId: null }).catch(() => {});
    }
  }

  logger.info(
    `[deleteCloudLibrary] Deleted ${deleted}/${remoteGames.length} cloud games`
  );

  WindowManager.sendToAppWindows("on-library-batch-complete");

  return { deleted, total: remoteGames.length };
};

registerEvent("deleteCloudLibrary", deleteCloudLibrary);
