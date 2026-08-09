import { registerEvent } from "../register-event";
import {
  DownloadManager,
  HydraApi,
  WSClient,
  WindowManager,
  emulators,
  gamesPlaytime,
} from "@main/services";
import {
  db,
  downloadLayoutStateSublevel,
  downloadsSublevel,
  exophaseCacheSublevel,
  gameAchievementsSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";

const signOut = async (_event: Electron.IpcMainInvokeEvent) => {
  const databaseOperations = db
    .batch([
      {
        type: "del",
        key: levelKeys.auth,
      },
      {
        type: "del",
        key: levelKeys.user,
      },
    ])
    .then(() => {
      /* Removes all games being played */
      gamesPlaytime.clear();

      return Promise.all([
        gamesSublevel.clear(),
        gameAchievementsSublevel.clear(),
        exophaseCacheSublevel.clear(),
        downloadsSublevel.clear(),
        downloadLayoutStateSublevel.clear(),
        db.del(levelKeys.exophaseSyncReport).catch(() => {}),
        db.del(levelKeys.exophaseCacheSyncedAt).catch(() => {}),
        emulators.resetEmulatorScanData(),
      ]);
    });

  /* Cancels any ongoing downloads */
  DownloadManager.cancelDownload();

  HydraApi.handleSignOut();

  /* The friends window is only meaningful while signed in */
  WindowManager.closeFriendsWindow();

  await Promise.all([
    databaseOperations,
    HydraApi.post("/auth/logout").catch(() => {}),
  ]);

  WSClient.close();
};

registerEvent("signOut", signOut);
