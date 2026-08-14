import type { GameShop } from "@types";

export const levelKeys = {
  games: "games",
  game: (shop: GameShop, objectId: string) => `${shop}:${objectId}`,
  user: "user",
  auth: "auth",
  themes: "themes",
  gameShopAssets: "gameShopAssets",
  gameStatsCache: "gameStatsAssets",
  gameShopCache: "gameShopCache",
  gameShopCacheItem: (shop: GameShop, objectId: string, language: string) =>
    `${shop}:${objectId}:${language}`,
  gameAchievements: "gameAchievements",
  downloads: "downloads",
  downloadLayoutState: "downloadLayoutState",
  userPreferences: "userPreferences",
  language: "language",
  screenState: "screenState",
  rpcPassword: "rpcPassword",
  downloadSources: "downloadSources",
  downloadSourcesCheckBaseline: "downloadSourcesCheckBaseline", // When we last started the app
  downloadSourcesSinceValue: "downloadSourcesSinceValue", // The 'since' value API used (for modal comparison)
  localNotifications: "localNotifications",
  exophaseCache: "exophaseCache", // Shared Exophase achievement-definition cache (R2-synced)
  playnitePlaytimeCache: "playnitePlaytimeCache", // Playtime for Playnite games not yet in the library
  sgdbSearchCache: "sgdbSearchCache", // Persistent SteamGridDB title -> game id cache
  musicPlaylists: "musicPlaylists", // User-created music playlists (Deezer + yt-dlp player)

  exophaseSyncReport: "exophaseSyncReport", // Last background sync report (for the notification modal)
  exophaseCacheSyncedAt: "exophaseCacheSyncedAt", // Last time the shared cache blob was pulled from R2
  commonRedistPassed: "commonRedistPassed", // Whether common redistributables preflight has passed
  libraryOriginRepairV2: "libraryOriginRepairV2", // One-time demotion of wrongly "sync"-stamped scan/repack games
  libraryOriginRepairV3: "libraryOriginRepairV3", // Lock-down attempt (v4.6.4) — superseded by V4
  libraryOriginRepairV4: "libraryOriginRepairV4", // URI-exe-based stamp repair: fix V3 over-demotion, stamp platform-URI games "sync"
  ps2MemoryCardSave: (cardFilePath: string, folderName: string) =>
    `${cardFilePath}:${folderName}`,
  ps1MemoryCardSave: (cardFilePath: string, folderName: string) =>
    `${cardFilePath}:${folderName}`,
  cloudSaveLocalHashCache: "cloud-save-local-hash-cache",
  cloudSavePrefixGenerations: "cloud-save-prefix-generations",
  cloudSaveSyncAnchors: "cloud-save-sync-anchors",
  cloudSaveAutomaticSyncSettings: "cloud-save-automatic-sync-settings",
  cloudSaveCustomPaths: "cloud-save-custom-paths",
  cloudSavePendingDeletions: "cloud-save-pending-deletions",
  cloudSavePendingPostExit: "cloud-save-pending-post-exit",
  achievementSouvenirs: "achievement-souvenirs",
};
