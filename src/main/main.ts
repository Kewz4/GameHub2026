import { downloadsSublevel } from "./level/sublevels/downloads";
import { orderBy } from "lodash-es";
import { Downloader } from "@shared";
import { levelKeys, db } from "./level";
import { type Download, type UserPreferences } from "../types";
import path from "node:path";
import fs from "node:fs";
import {
  SystemPath,
  CommonRedistManager,
  TorBoxClient,
  RealDebridClient,
  PremiumizeClient,
  AllDebridClient,
  DownloadManager,
  HydraApi,
  uploadGamesBatch,
  startMainLoop,
  Ludusavi,
  Lock,
  DeckyPlugin,
  DownloadSourcesChecker,
  DownloadOrchestrator,
  WSClient,
  WindowManager,
  logger,
} from "@main/services";
import { migrateDownloadSources } from "./helpers/migrate-download-sources";
import { seedDefaultSources } from "./helpers/seed-default-sources";
import { getDirSize } from "./services/download/helpers";
import { GofileApi } from "./services/hosters";

// TorBox API token shipped with the app so TorBox (the recommended default
// downloader) works out of the box. Overridden by any token the user enters.
const BAKED_TORBOX_API_TOKEN = "70d847f9-46e3-410b-bc0e-9f8fceb9fe8c";

const hasMissingSeedFiles = async (download: Download): Promise<boolean> => {
  if (!download.folderName) return false;

  const downloadTargetPath = path.join(
    download.downloadPath,
    download.folderName
  );

  if (!fs.existsSync(downloadTargetPath)) {
    return true;
  }

  const expectedSize = download.selectedFilesSize ?? download.fileSize ?? 0;

  if (expectedSize <= 0) {
    return false;
  }

  const currentSize = await getDirSize(downloadTargetPath);
  return currentSize < expectedSize;
};

export const loadState = async () => {
  // Ensure the database is fully open before any operations.
  // ClassicLevel opens asynchronously; if loadState() is called before the
  // internal open resolves, db.get() throws "Database is not open".
  await db.open().catch(() => {});

  await Lock.acquireLock();

  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    {
      valueEncoding: "json",
    }
  );

  await import("./events");

  void seedDefaultSources();

  // Re-sync Xbox achievements for library games that have a stored titleId
  if ((userPreferences as any)?.xboxXuid && userPreferences?.xboxXstsToken) {
    Promise.all([
      import("./services/achievements/get-xbox-achievements"),
      import("./level"),
    ])
      .then(([{ syncXboxGameAchievements }, { gamesSublevel }]) => {
        gamesSublevel
          .values()
          .all()
          .then((games) => {
            for (const g of games) {
              if (g.shop === "xbox" && (g as any).xboxTitleId) {
                syncXboxGameAchievements(
                  g.objectId,
                  (g as any).xboxTitleId
                ).catch(() => {});
              }
            }
          });
      })
      .catch(() => {});
  }

  // Ship with a TorBox API token baked in so TorBox works out of the box (it's
  // the recommended default downloader). If the user hasn't set their own
  // token, seed ours and persist it so the settings UI shows TorBox as
  // configured. A user-entered token always takes precedence.
  if (!userPreferences?.torBoxApiToken && BAKED_TORBOX_API_TOKEN) {
    const seeded = {
      ...(userPreferences ?? {}),
      torBoxApiToken: BAKED_TORBOX_API_TOKEN,
    } as UserPreferences;
    await db
      .put(levelKeys.userPreferences, seeded, { valueEncoding: "json" })
      .catch(() => {});
    if (userPreferences) {
      (userPreferences as UserPreferences).torBoxApiToken =
        BAKED_TORBOX_API_TOKEN;
    }
    TorBoxClient.authorize(BAKED_TORBOX_API_TOKEN);
  }

  if (userPreferences?.realDebridApiToken) {
    RealDebridClient.authorize(userPreferences.realDebridApiToken);
  }

  if (userPreferences?.premiumizeApiToken) {
    PremiumizeClient.authorize(userPreferences.premiumizeApiToken);
  }

  if (userPreferences?.allDebridApiToken) {
    AllDebridClient.authorize(userPreferences.allDebridApiToken);
  }

  if (userPreferences?.torBoxApiToken) {
    TorBoxClient.authorize(userPreferences.torBoxApiToken);
  }

  GofileApi.initialize();

  Ludusavi.copyConfigFileToUserData();
  Ludusavi.copyBinaryToUserData();
  // Download/refresh ludusavi game database in background (non-blocking)
  Ludusavi.updateManifest().catch(() => {});

  if (process.platform === "linux") {
    DeckyPlugin.checkAndUpdateIfOutdated();
  }

  await HydraApi.setupApi().then(async () => {
    uploadGamesBatch();
    void migrateDownloadSources();

    // Repair corrupted library records (title-as-objectId) and stamp
    // libraryOrigin on legacy entries. Non-blocking.
    import("./services/library-migrations")
      .then(({ runLibraryMigrations }) => runLibraryMigrations())
      .catch(() => {});

    const { syncDownloadSourcesFromApi } = await import("./services/user");
    void syncDownloadSourcesFromApi();

    // Check for new download options on startup (if enabled)
    (async () => {
      await DownloadSourcesChecker.checkForChanges();
    })();
    WSClient.connect();
  });

  const downloadToResume =
    await DownloadOrchestrator.bootstrapDownloadsOnStartup();
  const normalizedDownloads = await downloadsSublevel
    .values()
    .all()
    .then((games) => orderBy(games, "timestamp", "desc"));

  const downloadsToSeed: Download[] = [];

  for (const game of normalizedDownloads) {
    if (
      !game.shouldSeed ||
      game.downloader !== Downloader.Torrent ||
      game.progress !== 1 ||
      game.status !== "seeding" ||
      game.uri === null
    ) {
      continue;
    }

    if (!(await hasMissingSeedFiles(game))) {
      downloadsToSeed.push(game);
      continue;
    }

    const gameKey = levelKeys.game(game.shop, game.objectId);
    const expectedSize = game.selectedFilesSize ?? game.fileSize ?? 0;
    let progress = game.progress;

    if (game.folderName) {
      const downloadTargetPath = path.join(game.downloadPath, game.folderName);
      const currentSize = fs.existsSync(downloadTargetPath)
        ? await getDirSize(downloadTargetPath)
        : 0;
      progress =
        expectedSize > 0
          ? Math.min(currentSize / expectedSize, 1)
          : game.progress;
    }

    await downloadsSublevel.put(gameKey, {
      ...game,
      status: "paused",
      shouldSeed: false,
      queued: false,
      pinnedToHero: false,
      progress,
    });

    logger.warn(
      `[Startup] Seed files missing for ${gameKey}; seeding was disabled`
    );
  }

  // Torrent support is optional at runtime. A missing or broken Python RPC
  // helper must not prevent process tracking, overlay shortcuts, cloud saves,
  // or the rest of the application from starting.
  const isTorrent = downloadToResume?.downloader === Downloader.Torrent;
  if (downloadToResume && !isTorrent) {
    // Start Python RPC for seeding only. An HTTP resume uses the JavaScript
    // downloader and must still proceed if the optional RPC helper is absent.
    try {
      await DownloadManager.startRPC(undefined, downloadsToSeed);
    } catch (err) {
      logger.error(
        "Download RPC failed to start; continuing without torrent support",
        err
      );
    }
    await DownloadManager.startDownload(downloadToResume).catch((err) => {
      // If resume fails, just log it - user can manually retry.
      logger.error("Failed to auto-resume download:", err);
    });
  } else {
    // Use Python RPC for everything (torrent or fallback).
    try {
      await DownloadManager.startRPC(
        downloadToResume ?? undefined,
        downloadsToSeed
      );
    } catch (err) {
      logger.error(
        "Download RPC failed to start; continuing without torrent support",
        err
      );
    }
  }

  WindowManager.sendDownloadsUpdated();

  startMainLoop();

  // Sync all connected libraries on launch (non-blocking)
  import("@main/services/main-loop").then(({ syncAllLibraries }) => {
    syncAllLibraries().catch(() => {});
  });

  CommonRedistManager.downloadCommonRedist();

  SystemPath.checkIfPathsAreAvailable();
};
