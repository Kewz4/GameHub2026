// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import { contextBridge, ipcRenderer } from "electron";

import type {
  GameShop,
  DownloadProgress,
  UserPreferences,
  AppUpdaterEvent,
  StartGameDownloadPayload,
  GameRunning,
  FriendRequestAction,
  UpdateProfileRequest,
  SeedingStatus,
  GameAchievement,
  Theme,
  FriendRequestSync,
  FriendPresenceSync,
  NotificationSync,
  ShortcutLocation,
  CreateSteamShortcutOptions,
  AchievementCustomNotificationPosition,
  AchievementNotificationInfo,
  ProtonVersion,
  TorrentFilesResponse,
  DownloadLayoutState,
  EmulatorSystem,
  ClassicsDiscUpdate,
} from "@types";
import type { AuthPage } from "@shared";
import type { AxiosProgressEvent } from "axios";

const fileExplorerApi = {
  readDirectory: (path: string) => ipcRenderer.invoke("readDirectory", path),
  getPathInfo: (path: string) => ipcRenderer.invoke("getPathInfo", path),
  listDrives: () => ipcRenderer.invoke("listDrives"),
};

contextBridge.exposeInMainWorld("electron", {
  /* Torrenting */
  startGameDownload: (payload: StartGameDownloadPayload) =>
    ipcRenderer.invoke("startGameDownload", payload),
  addGameToQueue: (payload: StartGameDownloadPayload) =>
    ipcRenderer.invoke("addGameToQueue", payload),
  cancelGameDownload: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("cancelGameDownload", shop, objectId),
  pauseGameDownload: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("pauseGameDownload", shop, objectId),
  resumeGameDownload: (
    shop: GameShop,
    objectId: string,
    strategy?: "interruptActive" | "queueIfActive"
  ) => ipcRenderer.invoke("resumeGameDownload", shop, objectId, strategy),
  pauseGameSeed: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("pauseGameSeed", shop, objectId),
  resumeGameSeed: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("resumeGameSeed", shop, objectId),
  updateDownloadQueuePosition: (
    shop: GameShop,
    objectId: string,
    direction: "up" | "down"
  ) =>
    ipcRenderer.invoke(
      "updateDownloadQueuePosition",
      shop,
      objectId,
      direction
    ),
  setDownloadQueuePosition: (
    shop: GameShop,
    objectId: string,
    targetIndex: number
  ) =>
    ipcRenderer.invoke("setDownloadQueuePosition", shop, objectId, targetIndex),
  setPausedDownloadPosition: (
    shop: GameShop,
    objectId: string,
    targetIndex: number
  ) =>
    ipcRenderer.invoke(
      "setPausedDownloadPosition",
      shop,
      objectId,
      targetIndex
    ),
  moveDownloadPlacement: (
    shop: GameShop,
    objectId: string,
    targetArea: "hero" | "queue" | "paused",
    targetIndex?: number
  ) =>
    ipcRenderer.invoke(
      "moveDownloadPlacement",
      shop,
      objectId,
      targetArea,
      targetIndex
    ),
  getDownloadLayoutState: () =>
    ipcRenderer.invoke(
      "getDownloadLayoutState"
    ) as Promise<DownloadLayoutState>,
  onDownloadProgress: (cb: (value: DownloadProgress | null) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      value: DownloadProgress | null
    ) => cb(value);
    ipcRenderer.on("on-download-progress", listener);
    return () => ipcRenderer.removeListener("on-download-progress", listener);
  },
  onHardDelete: (cb: () => void) => {
    const listener = (_event: Electron.IpcRendererEvent) => cb();
    ipcRenderer.on("on-hard-delete", listener);
    return () => ipcRenderer.removeListener("on-hard-delete", listener);
  },
  onSeedingStatus: (cb: (value: SeedingStatus[]) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      value: SeedingStatus[]
    ) => cb(value);
    ipcRenderer.on("on-seeding-status", listener);
    return () => ipcRenderer.removeListener("on-seeding-status", listener);
  },
  checkDebridAvailability: (magnets: string[]) =>
    ipcRenderer.invoke("checkDebridAvailability", magnets),
  getTorrentFiles: (magnet: string) =>
    ipcRenderer.invoke("getTorrentFiles", magnet) as Promise<
      { ok: true; data: TorrentFilesResponse } | { ok: false; error: string }
    >,

  /* Catalogue */
  getGameShopDetails: (objectId: string, shop: GameShop, language: string) =>
    ipcRenderer.invoke("getGameShopDetails", objectId, shop, language),
  getRandomGame: () => ipcRenderer.invoke("getRandomGame"),
  getGameStats: (objectId: string, shop: GameShop) =>
    ipcRenderer.invoke("getGameStats", objectId, shop),
  getGameAssets: (objectId: string, shop: GameShop, title?: string) =>
    ipcRenderer.invoke("getGameAssets", objectId, shop, title),
  onUpdateAchievements: (
    objectId: string,
    shop: GameShop,
    cb: (achievements: GameAchievement[]) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      achievements: GameAchievement[]
    ) => cb(achievements);
    ipcRenderer.on(`on-update-achievements-${objectId}-${shop}`, listener);
    return () =>
      ipcRenderer.removeListener(
        `on-update-achievements-${objectId}-${shop}`,
        listener
      );
  },

  /* User preferences */
  getUserPreferences: () => ipcRenderer.invoke("getUserPreferences"),
  updateUserPreferences: (preferences: Partial<UserPreferences>) =>
    ipcRenderer.invoke("updateUserPreferences", preferences),
  backupSettingsToCloud: () => ipcRenderer.invoke("backupSettingsToCloud"),
  restoreSettingsFromCloud: () =>
    ipcRenderer.invoke("restoreSettingsFromCloud"),
  onUserPreferencesUpdated: (
    cb: (preferences: UserPreferences | null) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      preferences: UserPreferences | null
    ) => cb(preferences);
    ipcRenderer.on("on-user-preferences-updated", listener);
    return () =>
      ipcRenderer.removeListener("on-user-preferences-updated", listener);
  },
  autoLaunch: (autoLaunchProps: { enabled: boolean; minimized: boolean }) =>
    ipcRenderer.invoke("autoLaunch", autoLaunchProps),
  authenticateRealDebrid: (apiToken: string) =>
    ipcRenderer.invoke("authenticateRealDebrid", apiToken),
  authenticatePremiumize: (apiToken: string) =>
    ipcRenderer.invoke("authenticatePremiumize", apiToken),
  authenticateAllDebrid: (apiToken: string) =>
    ipcRenderer.invoke("authenticateAllDebrid", apiToken),
  authenticateTorBox: (apiToken: string) =>
    ipcRenderer.invoke("authenticateTorBox", apiToken),

  /* Download sources */
  addDownloadSource: (url: string) =>
    ipcRenderer.invoke("addDownloadSource", url),
  removeDownloadSource: (url: string, removeAll?: boolean) =>
    ipcRenderer.invoke("removeDownloadSource", url, removeAll),
  getDownloadSources: () => ipcRenderer.invoke("getDownloadSources"),
  syncDownloadSources: () => ipcRenderer.invoke("syncDownloadSources"),
  getDownloadSourcesCheckBaseline: () =>
    ipcRenderer.invoke("getDownloadSourcesCheckBaseline"),
  getDownloadSourcesSinceValue: () =>
    ipcRenderer.invoke("getDownloadSourcesSinceValue"),

  /* Library */
  toggleAutomaticCloudSync: (
    shop: GameShop,
    objectId: string,
    automaticCloudSync: boolean
  ) =>
    ipcRenderer.invoke(
      "toggleAutomaticCloudSync",
      shop,
      objectId,
      automaticCloudSync
    ),
  toggleGameMangohud: (
    shop: GameShop,
    objectId: string,
    autoRunMangohud: boolean
  ) =>
    ipcRenderer.invoke("toggleGameMangohud", shop, objectId, autoRunMangohud),
  toggleGameGamemode: (
    shop: GameShop,
    objectId: string,
    autoRunGamemode: boolean
  ) =>
    ipcRenderer.invoke("toggleGameGamemode", shop, objectId, autoRunGamemode),
  isGamemodeAvailable: () => ipcRenderer.invoke("isGamemodeAvailable"),
  isMangohudAvailable: () => ipcRenderer.invoke("isMangohudAvailable"),
  isWinetricksAvailable: () => ipcRenderer.invoke("isWinetricksAvailable"),
  addGameToLibrary: (shop: GameShop, objectId: string, title: string) =>
    ipcRenderer.invoke("addGameToLibrary", shop, objectId, title),
  getSteamPlayerSummary: (steamId: string, apiKey?: string) =>
    ipcRenderer.invoke("getSteamPlayerSummary", steamId, apiKey),
  syncSteamLibrary: (steamId: string, apiKey?: string) =>
    ipcRenderer.invoke("syncSteamLibrary", steamId, apiKey),
  getLegendaryStatus: () => ipcRenderer.invoke("getLegendaryStatus"),
  installLegendary: () => ipcRenderer.invoke("installLegendary"),
  openLegendaryAuthWindow: () => ipcRenderer.invoke("openLegendaryAuthWindow"),
  completeEpicAuth: (code: string) =>
    ipcRenderer.invoke("completeEpicAuth", code),
  epicDirectLogin: (email: string, password: string) =>
    ipcRenderer.invoke("epicDirectLogin", email, password),
  epicDirectLoginMfa: (otp: string, mfaToken: string, challengeType: string) =>
    ipcRenderer.invoke("epicDirectLoginMfa", otp, mfaToken, challengeType),
  openEpicSocialAuthWindow: (provider: "google" | "facebook" | "apple") =>
    ipcRenderer.invoke("openEpicSocialAuthWindow", provider),
  gogDirectLogin: (email: string, password: string) =>
    ipcRenderer.invoke("gogDirectLogin", email, password),
  epicSignOut: () => ipcRenderer.invoke("epicSignOut"),
  completeGogAuth: (code: string) =>
    ipcRenderer.invoke("completeGogAuth", code),
  syncEpicLibrary: () => ipcRenderer.invoke("syncEpicLibrary"),
  installBattleNet: () => ipcRenderer.invoke("installBattleNet"),
  openGogAuthWindow: () => ipcRenderer.invoke("openGogAuthWindow"),
  syncGogLibrary: () => ipcRenderer.invoke("syncGogLibrary"),
  getGogUserInfo: () => ipcRenderer.invoke("getGogUserInfo"),
  getBattleNetGames: () => ipcRenderer.invoke("getBattleNetGames"),
  addBattleNetGamesToLibrary: (productCodes: string[]) =>
    ipcRenderer.invoke("addBattleNetGamesToLibrary", productCodes),
  getRiotGames: () => ipcRenderer.invoke("getRiotGames"),
  addRiotGamesToLibrary: (productIds: string[]) =>
    ipcRenderer.invoke("addRiotGamesToLibrary", productIds),
  getUbisoftGames: () => ipcRenderer.invoke("getUbisoftGames"),
  addUbisoftGamesToLibrary: (installIds: string[]) =>
    ipcRenderer.invoke("addUbisoftGamesToLibrary", installIds),
  getEaGames: () => ipcRenderer.invoke("getEaGames"),
  addEaGamesToLibrary: (titles: string[]) =>
    ipcRenderer.invoke("addEaGamesToLibrary", titles),
  openUbisoftAuthWindow: () => ipcRenderer.invoke("openUbisoftAuthWindow"),
  syncUbisoftLibrary: () => ipcRenderer.invoke("syncUbisoftLibrary"),
  openEaAuthWindow: () => ipcRenderer.invoke("openEaAuthWindow"),
  syncEaLibrary: () => ipcRenderer.invoke("syncEaLibrary"),
  importPlatformAchievements: (platform: "steam" | "epic" | "gog" | "xbox") =>
    ipcRenderer.invoke("importPlatformAchievements", platform),
  // Exophase — unified achievement source
  openExophaseAuthWindow: () => ipcRenderer.invoke("openExophaseAuthWindow"),
  getExophaseAuthState: (revalidate?: boolean) =>
    ipcRenderer.invoke("getExophaseAuthState", revalidate),
  validateExophaseProfile: (input: string) =>
    ipcRenderer.invoke("validateExophaseProfile", input),
  clearExophaseSession: () => ipcRenderer.invoke("clearExophaseSession"),
  syncExophaseAchievements: () =>
    ipcRenderer.invoke("syncExophaseAchievements"),
  importPlaystationAchievements: () =>
    ipcRenderer.invoke("importPlaystationAchievements"),
  getExophaseSyncReport: () => ipcRenderer.invoke("getExophaseSyncReport"),
  getExophaseSyncState: () => ipcRenderer.invoke("getExophaseSyncState"),
  getHydraCloudAchievements: () =>
    ipcRenderer.invoke("getHydraCloudAchievements"),
  runExophaseBackgroundSync: () =>
    ipcRenderer.invoke("runExophaseBackgroundSync"),
  onExophaseSyncProgress: (
    cb: (progress: { current: number; total: number; title: string }) => void
  ) => {
    const listener = (
      _e: Electron.IpcRendererEvent,
      progress: { current: number; total: number; title: string }
    ) => cb(progress);
    ipcRenderer.on("on-exophase-sync-progress", listener);
    return () => {
      ipcRenderer.removeListener("on-exophase-sync-progress", listener);
    };
  },
  onExophaseSyncActive: (cb: (active: boolean) => void) => {
    const listener = (
      _e: Electron.IpcRendererEvent,
      payload: { active: boolean }
    ) => cb(payload.active);
    ipcRenderer.on("on-exophase-sync-active", listener);
    return () => {
      ipcRenderer.removeListener("on-exophase-sync-active", listener);
    };
  },
  lookupGameAchievements: (shop: string, objectId: string) =>
    ipcRenderer.invoke("lookupGameAchievements", shop, objectId),
  onExophaseLookupProgress: (
    cb: (info: { status: string; message: string }) => void
  ) => {
    const listener = (
      _e: Electron.IpcRendererEvent,
      info: { status: string; message: string }
    ) => cb(info);
    ipcRenderer.on("on-exophase-lookup-progress", listener);
    return () => {
      ipcRenderer.removeListener("on-exophase-lookup-progress", listener);
    };
  },
  syncGamePassLibrary: () => ipcRenderer.invoke("syncGamePassLibrary"),
  openXboxAuthWindow: () => ipcRenderer.invoke("openXboxAuthWindow"),
  addCustomGameToLibrary: (
    title: string,
    executablePath: string,
    iconUrl?: string,
    logoImageUrl?: string,
    libraryHeroImageUrl?: string
  ) =>
    ipcRenderer.invoke(
      "addCustomGameToLibrary",
      title,
      executablePath,
      iconUrl,
      logoImageUrl,
      libraryHeroImageUrl
    ),
  copyCustomGameAsset: (
    sourcePath: string,
    assetType: "icon" | "logo" | "hero"
  ) => ipcRenderer.invoke("copyCustomGameAsset", sourcePath, assetType),
  saveTempFile: (fileName: string, fileData: Uint8Array) =>
    ipcRenderer.invoke("saveTempFile", fileName, fileData),
  deleteTempFile: (filePath: string) =>
    ipcRenderer.invoke("deleteTempFile", filePath),
  cleanupUnusedAssets: () => ipcRenderer.invoke("cleanupUnusedAssets"),
  updateCustomGame: (params: {
    shop: GameShop;
    objectId: string;
    title: string;
    iconUrl?: string;
    logoImageUrl?: string;
    libraryHeroImageUrl?: string;
    originalIconPath?: string;
    originalLogoPath?: string;
    originalHeroPath?: string;
  }) => ipcRenderer.invoke("updateCustomGame", params),
  updateGameCustomAssets: (params: {
    shop: GameShop;
    objectId: string;
    title: string;
    customIconUrl?: string | null;
    customLogoImageUrl?: string | null;
    customHeroImageUrl?: string | null;
    customOriginalIconPath?: string | null;
    customOriginalLogoPath?: string | null;
    customOriginalHeroPath?: string | null;
  }) => ipcRenderer.invoke("updateGameCustomAssets", params),
  searchGameArtwork: (params: {
    shop: GameShop;
    objectId: string;
    title: string;
    assetType: "cover" | "hero" | "logo" | "icon";
    source: "steamgriddb" | "igdb";
  }) => ipcRenderer.invoke("searchGameArtwork", params),
  applyGameArtwork: (params: {
    shop: GameShop;
    objectId: string;
    assetType: "cover" | "hero" | "logo" | "icon";
    url: string;
  }) => ipcRenderer.invoke("applyGameArtwork", params),
  createGameShortcut: (
    shop: GameShop,
    objectId: string,
    location: ShortcutLocation
  ) => ipcRenderer.invoke("createGameShortcut", shop, objectId, location),
  updateExecutablePath: (
    shop: GameShop,
    objectId: string,
    executablePath: string | null
  ) =>
    ipcRenderer.invoke("updateExecutablePath", shop, objectId, executablePath),
  updateTrackingExecutablePaths: (
    shop: GameShop,
    objectId: string,
    trackingExecutablePaths: string[]
  ) =>
    ipcRenderer.invoke(
      "updateTrackingExecutablePaths",
      shop,
      objectId,
      trackingExecutablePaths
    ),
  addGameToFavorites: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("addGameToFavorites", shop, objectId),
  removeGameFromFavorites: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("removeGameFromFavorites", shop, objectId),
  assignGameToCollection: (
    shop: GameShop,
    objectId: string,
    collectionIds: string[]
  ) =>
    ipcRenderer.invoke("assignGameToCollection", shop, objectId, collectionIds),
  clearNewDownloadOptions: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("clearNewDownloadOptions", shop, objectId),
  toggleGamePin: (shop: GameShop, objectId: string, pinned: boolean) =>
    ipcRenderer.invoke("toggleGamePin", shop, objectId, pinned),
  updateLaunchOptions: (
    shop: GameShop,
    objectId: string,
    launchOptions: string | null
  ) => ipcRenderer.invoke("updateLaunchOptions", shop, objectId, launchOptions),

  selectGameWinePrefix: (
    shop: GameShop,
    objectId: string,
    winePrefixPath: string | null
  ) =>
    ipcRenderer.invoke("selectGameWinePrefix", shop, objectId, winePrefixPath),
  selectGameProtonPath: (
    shop: GameShop,
    objectId: string,
    protonPath: string | null
  ) => ipcRenderer.invoke("selectGameProtonPath", shop, objectId, protonPath),
  getInstalledProtonVersions: () =>
    ipcRenderer.invoke("getInstalledProtonVersions") as Promise<
      ProtonVersion[]
    >,
  getGameLaunchProtonVersion: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("getGameLaunchProtonVersion", shop, objectId),
  verifyExecutablePathInUse: (executablePath: string) =>
    ipcRenderer.invoke("verifyExecutablePathInUse", executablePath),
  getLibrary: () => ipcRenderer.invoke("getLibrary"),
  getAchievementGames: () => ipcRenderer.invoke("getAchievementGames"),
  refreshLibraryAssets: () => ipcRenderer.invoke("refreshLibraryAssets"),
  generateMissingMetadata: () => ipcRenderer.invoke("generateMissingMetadata"),
  mergeDuplicateGames: () => ipcRenderer.invoke("mergeDuplicateGames"),
  clearLibrary: (): Promise<{ cleared: number }> =>
    ipcRenderer.invoke("clearLibrary"),
  deleteCloudLibrary: (): Promise<{
    deleted: number;
    total?: number;
    error?: string;
  }> => ipcRenderer.invoke("deleteCloudLibrary"),
  openGameInstaller: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("openGameInstaller", shop, objectId),
  getGameInstallerActionType: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("getGameInstallerActionType", shop, objectId),
  openGameInstallerPath: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("openGameInstallerPath", shop, objectId),
  openGameWinetricks: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("openGameWinetricks", shop, objectId),
  openGameExecutablePath: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("openGameExecutablePath", shop, objectId),
  getGameSaveFolder: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("getGameSaveFolder", shop, objectId),
  openGameSaveFolder: (
    shop: GameShop,
    objectId: string,
    saveFolderPath: string
  ) => ipcRenderer.invoke("openGameSaveFolder", shop, objectId, saveFolderPath),
  openGame: (
    shop: GameShop,
    objectId: string,
    executablePath: string,
    launchOptions?: string | null
  ) =>
    ipcRenderer.invoke(
      "openGame",
      shop,
      objectId,
      executablePath,
      launchOptions
    ),
  closeGame: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("closeGame", shop, objectId),
  removeGameFromLibrary: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("removeGameFromLibrary", shop, objectId),
  removeGame: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("removeGame", shop, objectId),
  deleteGameFolder: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("deleteGameFolder", shop, objectId),
  getGameByObjectId: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("getGameByObjectId", shop, objectId),
  resetGameAchievements: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("resetGameAchievements", shop, objectId),
  changeGamePlayTime: (shop: GameShop, objectId: string, playtime: number) =>
    ipcRenderer.invoke("changeGamePlayTime", shop, objectId, playtime),
  extractGameDownload: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("extractGameDownload", shop, objectId),
  scanInstalledGames: (dryRun?: boolean) =>
    ipcRenderer.invoke("scanInstalledGames", dryRun),
  selectiveScanInstalledGames: (scanPaths: string[], dryRun?: boolean) =>
    ipcRenderer.invoke("selectiveScanInstalledGames", scanPaths, dryRun),
  confirmScanGames: (
    approvedGames: Array<{
      key: string;
      executablePath: string;
      title?: string;
      isNew?: boolean;
    }>
  ) => ipcRenderer.invoke("confirmScanGames", approvedGames),
  onScanProgress: (
    cb: (progress: {
      scanned: number;
      total: number;
      foundCount: number;
      currentTitle: string;
    }) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      progress: {
        scanned: number;
        total: number;
        foundCount: number;
        currentTitle: string;
      }
    ) => cb(progress);
    ipcRenderer.on("on-scan-progress", listener);
    return () => ipcRenderer.removeListener("on-scan-progress", listener);
  },
  importPlaynitePlaytime: (dbPath?: string) =>
    ipcRenderer.invoke("importPlaynitePlaytime", dbPath),
  getExclusionList: () => ipcRenderer.invoke("getExclusionList"),
  addGameToExclusionList: (shop: GameShop, objectId: string, title: string) =>
    ipcRenderer.invoke("addGameToExclusionList", shop, objectId, title),
  removeGameFromExclusionList: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("removeGameFromExclusionList", shop, objectId),
  getDefaultWinePrefixSelectionPath: () =>
    ipcRenderer.invoke("getDefaultWinePrefixSelectionPath"),
  createSteamShortcut: (
    shop: GameShop,
    objectId: string,
    options?: CreateSteamShortcutOptions
  ) => ipcRenderer.invoke("createSteamShortcut", shop, objectId, options),
  deleteSteamShortcut: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("deleteSteamShortcut", shop, objectId),
  checkSteamShortcut: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("checkSteamShortcut", shop, objectId),
  onGamesRunning: (
    cb: (
      gamesRunning: Pick<GameRunning, "id" | "sessionDurationInMillis">[]
    ) => void
  ) => {
    const listener = (_event: Electron.IpcRendererEvent, gamesRunning) =>
      cb(gamesRunning);
    ipcRenderer.on("on-games-running", listener);
    return () => ipcRenderer.removeListener("on-games-running", listener);
  },
  onLibraryBatchComplete: (cb: () => void) => {
    const listener = (_event: Electron.IpcRendererEvent) => cb();
    ipcRenderer.on("on-library-batch-complete", listener);
    return () =>
      ipcRenderer.removeListener("on-library-batch-complete", listener);
  },
  onCloudArtifactsUpdated: (cb: (artifacts: any[]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, artifacts: any[]) =>
      cb(artifacts);
    ipcRenderer.on("on-cloud-artifacts-updated", listener);
    return () =>
      ipcRenderer.removeListener("on-cloud-artifacts-updated", listener);
  },
  onDownloadsUpdated: (cb: () => void) => {
    const listener = (_event: Electron.IpcRendererEvent) => cb();
    ipcRenderer.on("on-downloads-updated", listener);
    return () => ipcRenderer.removeListener("on-downloads-updated", listener);
  },
  onExtractionComplete: (cb: (shop: GameShop, objectId: string) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      shop: GameShop,
      objectId: string
    ) => cb(shop, objectId);
    ipcRenderer.on("on-extraction-complete", listener);
    return () => ipcRenderer.removeListener("on-extraction-complete", listener);
  },
  onExtractionProgress: (
    cb: (shop: GameShop, objectId: string, progress: number) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      shop: GameShop,
      objectId: string,
      progress: number
    ) => cb(shop, objectId, progress);
    ipcRenderer.on("on-extraction-progress", listener);
    return () => ipcRenderer.removeListener("on-extraction-progress", listener);
  },
  onExtractionFailed: (cb: (shop: GameShop, objectId: string) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      shop: GameShop,
      objectId: string
    ) => cb(shop, objectId);
    ipcRenderer.on("on-extraction-failed", listener);
    return () => ipcRenderer.removeListener("on-extraction-failed", listener);
  },
  onArchiveDeletionPrompt: (cb: (archivePaths: string[]) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      archivePaths: string[]
    ) => cb(archivePaths);
    ipcRenderer.on("on-archive-deletion-prompt", listener);
    return () =>
      ipcRenderer.removeListener("on-archive-deletion-prompt", listener);
  },
  deleteArchive: (filePath: string) =>
    ipcRenderer.invoke("deleteArchive", filePath),
  enableExperimentalAchievements: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("enableExperimentalAchievements", shop, objectId),
  onAchievementSupportMissing: (
    callback: (data: {
      objectId: string;
      shop: GameShop;
      title: string;
    }) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      data: { objectId: string; shop: GameShop; title: string }
    ) => callback(data);
    ipcRenderer.on("on-achievement-support-missing", listener);
    return () =>
      ipcRenderer.removeListener("on-achievement-support-missing", listener);
  },

  /* Hardware */
  getDiskFreeSpace: (path: string) =>
    ipcRenderer.invoke("getDiskFreeSpace", path),
  checkFolderWritePermission: (path: string) =>
    ipcRenderer.invoke("checkFolderWritePermission", path),
  getNetworkInterfaces: () => ipcRenderer.invoke("getNetworkInterfaces"),

  /* Cloud save */
  uploadSaveGame: (
    objectId: string,
    shop: GameShop,
    downloadOptionTitle: string | null
  ) =>
    ipcRenderer.invoke("uploadSaveGame", objectId, shop, downloadOptionTitle),
  downloadGameArtifact: (
    objectId: string,
    shop: GameShop,
    gameArtifactId: string
  ) =>
    ipcRenderer.invoke("downloadGameArtifact", objectId, shop, gameArtifactId),
  getGameArtifacts: (objectId: string, shop: GameShop) =>
    ipcRenderer.invoke("getGameArtifacts", objectId, shop),
  getAllArtifacts: () => ipcRenderer.invoke("getAllArtifacts"),
  deleteGameArtifact: (artifactId: string) =>
    ipcRenderer.invoke("deleteGameArtifact", artifactId),
  scanLudusaviBackupFolder: (folderPath: string) =>
    ipcRenderer.invoke("scanLudusaviBackupFolder", folderPath),
  importLudusaviBackup: (
    backupFolderPath: string,
    gameName: string,
    objectId: string,
    shop: GameShop
  ) =>
    ipcRenderer.invoke(
      "importLudusaviBackup",
      backupFolderPath,
      gameName,
      objectId,
      shop
    ),
  getGameBackupPreview: (objectId: string, shop: GameShop) =>
    ipcRenderer.invoke("getGameBackupPreview", objectId, shop),
  selectGameBackupPath: (
    shop: GameShop,
    objectId: string,
    backupPath: string | null
  ) => ipcRenderer.invoke("selectGameBackupPath", shop, objectId, backupPath),
  onUploadComplete: (objectId: string, shop: GameShop, cb: () => void) => {
    const listener = (_event: Electron.IpcRendererEvent) => cb();
    ipcRenderer.on(`on-upload-complete-${objectId}-${shop}`, listener);
    return () =>
      ipcRenderer.removeListener(
        `on-upload-complete-${objectId}-${shop}`,
        listener
      );
  },
  onBackupDownloadProgress: (
    objectId: string,
    shop: GameShop,
    cb: (progress: AxiosProgressEvent) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      progress: AxiosProgressEvent
    ) => cb(progress);
    ipcRenderer.on(`on-backup-download-progress-${objectId}-${shop}`, listener);
    return () =>
      ipcRenderer.removeListener(
        `on-backup-download-progress-${objectId}-${shop}`,
        listener
      );
  },
  onBackupDownloadComplete: (
    objectId: string,
    shop: GameShop,
    cb: (success: boolean) => void
  ) => {
    const listener = (_event: Electron.IpcRendererEvent, success: boolean) =>
      cb(success);
    ipcRenderer.on(`on-backup-download-complete-${objectId}-${shop}`, listener);
    return () =>
      ipcRenderer.removeListener(
        `on-backup-download-complete-${objectId}-${shop}`,
        listener
      );
  },

  /* Clipboard (renderer-side `navigator.clipboard.*` is deprecated in Electron 40+;
     direct `electron.clipboard` access from preload is also deprecated, so go through main via IPC) */
  clipboard: {
    writeText: (text: string) =>
      ipcRenderer.invoke("clipboardWriteText", text) as Promise<void>,
  },

  /* Emulators / Classics */
  getEmulatorConfigs: () => ipcRenderer.invoke("getEmulatorConfigs"),
  detectEmulator: (system: EmulatorSystem) =>
    ipcRenderer.invoke("detectEmulator", system),
  detectEmulators: () => ipcRenderer.invoke("detectEmulators"),
  previewEmulatorExecutable: (
    system: EmulatorSystem,
    executablePath?: string
  ) => ipcRenderer.invoke("previewEmulatorExecutable", system, executablePath),
  setEmulatorExecutablePath: (
    system: EmulatorSystem,
    executablePath: string | null
  ) => ipcRenderer.invoke("setEmulatorExecutablePath", system, executablePath),
  removeEmulator: (system: EmulatorSystem) =>
    ipcRenderer.invoke("removeEmulator", system),
  checkEmulatorExecutable: (system: EmulatorSystem) =>
    ipcRenderer.invoke("checkEmulatorExecutable", system),
  checkEmulatorBios: (system: EmulatorSystem, executablePath: string | null) =>
    ipcRenderer.invoke("checkEmulatorBios", system, executablePath),
  downloadEmulatorBios: (system: EmulatorSystem) =>
    ipcRenderer.invoke("downloadEmulatorBios", system),
  onBiosDownloadProgress: (
    cb: (payload: {
      system: EmulatorSystem;
      stage: "downloading" | "extracting" | "installing";
      progress: number;
    }) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: {
        system: EmulatorSystem;
        stage: "downloading" | "extracting" | "installing";
        progress: number;
      }
    ) => cb(payload);
    ipcRenderer.on("on-bios-download-progress", listener);
    return () => {
      ipcRenderer.removeListener("on-bios-download-progress", listener);
    };
  },
  checkPs3Firmware: (executablePath: string | null) =>
    ipcRenderer.invoke("checkPs3Firmware", executablePath),
  getEmulatorRomExtensions: (system: EmulatorSystem) =>
    ipcRenderer.invoke("getEmulatorRomExtensions", system),
  addRomFolder: (
    system: EmulatorSystem,
    folderPath: string,
    scanSubfolders: boolean
  ) => ipcRenderer.invoke("addRomFolder", system, folderPath, scanSubfolders),
  removeRomFolder: (system: EmulatorSystem, folderId: string) =>
    ipcRenderer.invoke("removeRomFolder", system, folderId),
  toggleRomFolderSubfolders: (
    system: EmulatorSystem,
    folderId: string,
    scanSubfolders: boolean
  ) =>
    ipcRenderer.invoke(
      "toggleRomFolderSubfolders",
      system,
      folderId,
      scanSubfolders
    ),
  rescanEmulator: (system: EmulatorSystem) =>
    ipcRenderer.invoke("rescanEmulator", system),
  listEmulatorRoms: (system: EmulatorSystem) =>
    ipcRenderer.invoke("listEmulatorRoms", system),
  openClassicsGame: (
    shop: GameShop,
    objectId: string,
    discPath?: string,
    force?: boolean
  ) => ipcRenderer.invoke("openClassicsGame", shop, objectId, discPath, force),
  updateClassicsDisc: (
    shop: GameShop,
    objectId: string,
    disc: ClassicsDiscUpdate
  ) => ipcRenderer.invoke("updateClassicsDisc", shop, objectId, disc),
  getClassicsImportStatus: () => ipcRenderer.invoke("getClassicsImportStatus"),
  getActiveClassicsImport: () => ipcRenderer.invoke("getActiveClassicsImport"),
  onClassicsImportProgress: (cb: (payload: any) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: any) =>
      cb(payload);
    ipcRenderer.on("on-classics-import-progress", listener);
    return () =>
      ipcRenderer.removeListener("on-classics-import-progress", listener);
  },
  getEmulatorInstallOptions: (binary: any) =>
    ipcRenderer.invoke("getEmulatorInstallOptions", binary),
  installEmulator: (binary: any, optionId: string) =>
    ipcRenderer.invoke("installEmulator", binary, optionId),
  isEmulatorReady: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("isEmulatorReady", shop, objectId),
  getEmulatorSettings: (system: EmulatorSystem) =>
    ipcRenderer.invoke("getEmulatorSettings", system),
  setEmulatorSettings: (system: EmulatorSystem, values: any) =>
    ipcRenderer.invoke("setEmulatorSettings", system, values),
  listCemuGraphicPacks: (
    shop?: string | null,
    objectId?: string | null,
    showAll?: boolean
  ) => ipcRenderer.invoke("listCemuGraphicPacks", shop, objectId, showAll),
  downloadCemuGraphicPacks: () =>
    ipcRenderer.invoke("downloadCemuGraphicPacks"),
  setCemuGraphicPackEnabled: (id: string, enabled: boolean) =>
    ipcRenderer.invoke("setCemuGraphicPackEnabled", id, enabled),
  setCemuGraphicPackPreset: (id: string, category: string, preset: string) =>
    ipcRenderer.invoke("setCemuGraphicPackPreset", id, category, preset),
  getModStatus: (shop: string, objectId: string) =>
    ipcRenderer.invoke("getModStatus", shop, objectId),
  installUkmm: () => ipcRenderer.invoke("installUkmm"),
  setModsEnabled: (shop: string, objectId: string, enabled: boolean) =>
    ipcRenderer.invoke("setModsEnabled", shop, objectId, enabled),
  browseGameBananaMods: (opts: {
    page?: number;
    sort?: string;
    categoryId?: number | null;
    search?: string;
  }) => ipcRenderer.invoke("browseGameBananaMods", opts),
  listModCategories: () => ipcRenderer.invoke("listModCategories"),
  getGameBananaMod: (modId: number) =>
    ipcRenderer.invoke("getGameBananaMod", modId),
  installMod: (
    shop: string,
    objectId: string,
    modId: number,
    fileId?: number
  ) => ipcRenderer.invoke("installMod", shop, objectId, modId, fileId),
  finalizeModInstall: (
    shop: string,
    objectId: string,
    stagingId: string,
    selectedFolders: string[]
  ) =>
    ipcRenderer.invoke(
      "finalizeModInstall",
      shop,
      objectId,
      stagingId,
      selectedFolders
    ),
  cancelModInstall: (stagingId: string) =>
    ipcRenderer.invoke("cancelModInstall", stagingId),
  installModFromBcmlUri: (shop: string, objectId: string, uri: string) =>
    ipcRenderer.invoke("installModFromBcmlUri", shop, objectId, uri),
  uninstallMod: (shop: string, objectId: string, index: number) =>
    ipcRenderer.invoke("uninstallMod", shop, objectId, index),
  resetMods: (shop: string, objectId: string) =>
    ipcRenderer.invoke("resetMods", shop, objectId),
  onModInstallProgress: (cb: (phase: string) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, phase: string) =>
      cb(phase);
    ipcRenderer.on("on-mod-install-progress", listener);
    return () =>
      ipcRenderer.removeListener("on-mod-install-progress", listener);
  },
  exportModpack: (shop: string, objectId: string) =>
    ipcRenderer.invoke("exportModpack", shop, objectId),
  importModpack: (shop: string, objectId: string) =>
    ipcRenderer.invoke("importModpack", shop, objectId),
  getControllerProfile: (binary?: any) =>
    ipcRenderer.invoke("getControllerProfile", binary),
  saveControllerProfile: (profile: any, binary?: any, type?: any) =>
    ipcRenderer.invoke("saveControllerProfile", profile, binary, type),
  useGlobalController: (binary: any) =>
    ipcRenderer.invoke("useGlobalController", binary),
  onEmulatorInstallProgress: (cb: (payload: any) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: any) =>
      cb(payload);
    ipcRenderer.on("on-emulator-install-progress", listener);
    return () =>
      ipcRenderer.removeListener("on-emulator-install-progress", listener);
  },
  startRomScan: (
    system: EmulatorSystem,
    folderPath: string,
    scanSubfolders: boolean
  ) => ipcRenderer.invoke("startRomScan", system, folderPath, scanSubfolders),
  cancelRomScan: (requestId: string) =>
    ipcRenderer.invoke("cancelRomScan", requestId),
  getEmulatorRomPaths: (system: EmulatorSystem) =>
    ipcRenderer.invoke("getEmulatorRomPaths", system),
  addEmulatorRomPath: (system: EmulatorSystem, folderPath: string) =>
    ipcRenderer.invoke("addEmulatorRomPath", system, folderPath),
  getRpcs3DefaultSources: () => ipcRenderer.invoke("getRpcs3DefaultSources"),
  onRomScanProgress: (requestId: string, cb: (payload: any) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: any) =>
      cb(payload);
    const channel = `on-rom-scan-progress-${requestId}`;
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  importLaunchboxRoms: (
    system: EmulatorSystem,
    folders: { path: string; scanSubfolders: boolean }[],
    language: string
  ) => ipcRenderer.invoke("importLaunchboxRoms", system, folders, language),
  cancelLaunchboxImport: (requestId: string) =>
    ipcRenderer.invoke("cancelLaunchboxImport", requestId),
  scanPs2Memcards: (input: any) => ipcRenderer.invoke("scanPs2Memcards", input),
  cancelPs2MemcardScan: (requestId: string) =>
    ipcRenderer.invoke("cancelPs2MemcardScan", requestId),
  onPs2MemcardScanProgress: (requestId: string, cb: (payload: any) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: any) =>
      cb(payload);
    const channel = `on-ps2-memcard-scan-progress-${requestId}`;
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  listPs2MemcardSaves: () => ipcRenderer.invoke("listPs2MemcardSaves"),
  forgetPs2MemcardSave: (cardFilePath: string, folderName: string) =>
    ipcRenderer.invoke("forgetPs2MemcardSave", cardFilePath, folderName),
  forgetPs2MemcardCard: (cardFilePath: string) =>
    ipcRenderer.invoke("forgetPs2MemcardCard", cardFilePath),
  exportPs2Save: (
    cardFilePath: string,
    folderName: string,
    suggestedName: string
  ) =>
    ipcRenderer.invoke(
      "exportPs2Save",
      cardFilePath,
      folderName,
      suggestedName
    ),
  scanPs1Memcards: (input: any) => ipcRenderer.invoke("scanPs1Memcards", input),
  cancelPs1MemcardScan: (requestId: string) =>
    ipcRenderer.invoke("cancelPs1MemcardScan", requestId),
  onPs1MemcardScanProgress: (requestId: string, cb: (payload: any) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: any) =>
      cb(payload);
    const channel = `on-ps1-memcard-scan-progress-${requestId}`;
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  listPs1MemcardSaves: () => ipcRenderer.invoke("listPs1MemcardSaves"),
  forgetPs1MemcardSave: (cardFilePath: string, identifier: string) =>
    ipcRenderer.invoke("forgetPs1MemcardSave", cardFilePath, identifier),
  forgetPs1MemcardCard: (cardFilePath: string) =>
    ipcRenderer.invoke("forgetPs1MemcardCard", cardFilePath),
  exportPs1Save: (
    cardFilePath: string,
    identifier: string,
    suggestedName: string
  ) =>
    ipcRenderer.invoke(
      "exportPs1Save",
      cardFilePath,
      identifier,
      suggestedName
    ),
  uploadEmulationSave: (
    platform: any,
    cardFilePath: string,
    folderName: string
  ) =>
    ipcRenderer.invoke(
      "uploadEmulationSave",
      platform,
      cardFilePath,
      folderName
    ),
  uploadEmulationSavesForCard: (platform: any, cardFilePath: string) =>
    ipcRenderer.invoke("uploadEmulationSavesForCard", platform, cardFilePath),
  onEmulationBackupProgress: (cb: (payload: any) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: any) =>
      cb(payload);
    ipcRenderer.on("on-emulation-backup-progress", listener);
    return () =>
      ipcRenderer.removeListener("on-emulation-backup-progress", listener);
  },
  getActiveEmulationBackups: () =>
    ipcRenderer.invoke("getActiveEmulationBackups"),
  listEmulationSaves: (platform: any, objectId?: string | null) =>
    ipcRenderer.invoke("listEmulationSaves", platform, objectId),
  getMemcardRestoreTargets: (platform: any) =>
    ipcRenderer.invoke("getMemcardRestoreTargets", platform),
  restoreEmulationSave: (
    platform: any,
    saveId: string,
    targetCardFilePath: string
  ) =>
    ipcRenderer.invoke(
      "restoreEmulationSave",
      platform,
      saveId,
      targetCardFilePath
    ),
  deleteEmulationSave: (saveId: string) =>
    ipcRenderer.invoke("deleteEmulationSave", saveId),
  updateEmulationSaveLabel: (saveId: string, label: string) =>
    ipcRenderer.invoke("updateEmulationSaveLabel", saveId, label),

  /* Misc */
  ping: () => ipcRenderer.invoke("ping"),
  getVersion: () => ipcRenderer.invoke("getVersion"),
  getDefaultDownloadsPath: () => ipcRenderer.invoke("getDefaultDownloadsPath"),
  isStaging: () => ipcRenderer.invoke("isStaging"),
  isPortableVersion: () => ipcRenderer.invoke("isPortableVersion"),
  openExternal: (src: string) => ipcRenderer.invoke("openExternal", src),
  openCheckout: () => ipcRenderer.invoke("openCheckout"),
  getExeName: (exePath: string) =>
    ipcRenderer.invoke("getExeName", exePath) as Promise<string | null>,
  resolveCustomGameInfo: (exePath: string) =>
    ipcRenderer.invoke("resolveCustomGameInfo", exePath),
  showOpenDialog: (options: Electron.OpenDialogOptions) =>
    ipcRenderer.invoke("showOpenDialog", options),
  ...fileExplorerApi,
  showItemInFolder: (path: string) =>
    ipcRenderer.invoke("showItemInFolder", path),
  getImageDataUrl: (imageUrl: string) =>
    ipcRenderer.invoke("getImageDataUrl", imageUrl),
  hydraApi: {
    get: (
      url: string,
      options?: {
        params?: unknown;
        needsAuth?: boolean;
        needsSubscription?: boolean;
        ifModifiedSince?: Date;
      }
    ) =>
      ipcRenderer.invoke("hydraApiCall", {
        method: "get",
        url,
        params: options?.params,
        options: {
          needsAuth: options?.needsAuth,
          needsSubscription: options?.needsSubscription,
          ifModifiedSince: options?.ifModifiedSince,
        },
      }),
    post: (
      url: string,
      options?: {
        data?: unknown;
        needsAuth?: boolean;
        needsSubscription?: boolean;
      }
    ) =>
      ipcRenderer.invoke("hydraApiCall", {
        method: "post",
        url,
        data: options?.data,
        options: {
          needsAuth: options?.needsAuth,
          needsSubscription: options?.needsSubscription,
        },
      }),
    put: (
      url: string,
      options?: {
        data?: unknown;
        needsAuth?: boolean;
        needsSubscription?: boolean;
      }
    ) =>
      ipcRenderer.invoke("hydraApiCall", {
        method: "put",
        url,
        data: options?.data,
        options: {
          needsAuth: options?.needsAuth,
          needsSubscription: options?.needsSubscription,
        },
      }),
    patch: (
      url: string,
      options?: {
        data?: unknown;
        needsAuth?: boolean;
        needsSubscription?: boolean;
      }
    ) =>
      ipcRenderer.invoke("hydraApiCall", {
        method: "patch",
        url,
        data: options?.data,
        options: {
          needsAuth: options?.needsAuth,
          needsSubscription: options?.needsSubscription,
        },
      }),
    delete: (
      url: string,
      options?: {
        needsAuth?: boolean;
        needsSubscription?: boolean;
      }
    ) =>
      ipcRenderer.invoke("hydraApiCall", {
        method: "delete",
        url,
        options: {
          needsAuth: options?.needsAuth,
          needsSubscription: options?.needsSubscription,
        },
      }),
  },
  canInstallCommonRedist: () => ipcRenderer.invoke("canInstallCommonRedist"),
  installCommonRedist: () => ipcRenderer.invoke("installCommonRedist"),
  installHydraDeckyPlugin: () => ipcRenderer.invoke("installHydraDeckyPlugin"),
  getHydraDeckyPluginInfo: () => ipcRenderer.invoke("getHydraDeckyPluginInfo"),
  checkHomebrewFolderExists: () =>
    ipcRenderer.invoke("checkHomebrewFolderExists"),
  platform: process.platform,

  /* Auto update */
  onAutoUpdaterEvent: (cb: (value: AppUpdaterEvent) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      value: AppUpdaterEvent
    ) => cb(value);

    ipcRenderer.on("autoUpdaterEvent", listener);

    return () => {
      ipcRenderer.removeListener("autoUpdaterEvent", listener);
    };
  },
  onCommonRedistProgress: (
    cb: (value: { log: string; complete: boolean }) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      value: { log: string; complete: boolean }
    ) => cb(value);
    ipcRenderer.on("common-redist-progress", listener);
    return () => ipcRenderer.removeListener("common-redist-progress", listener);
  },
  onPreflightProgress: (
    cb: (value: { status: string; detail: string | null }) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      value: { status: string; detail: string | null }
    ) => cb(value);
    ipcRenderer.on("preflight-progress", listener);
    return () => ipcRenderer.removeListener("preflight-progress", listener);
  },
  onMetadataProgress: (
    cb: (value: {
      current: number;
      total: number;
      title: string | null;
      done?: boolean;
    }) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      value: {
        current: number;
        total: number;
        title: string | null;
        done?: boolean;
      }
    ) => cb(value);
    ipcRenderer.on("on-metadata-progress", listener);
    return () => ipcRenderer.removeListener("on-metadata-progress", listener);
  },
  onDedupProgress: (
    cb: (value: {
      current: number;
      total: number;
      title: string | null;
      done?: boolean;
    }) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      value: {
        current: number;
        total: number;
        title: string | null;
        done?: boolean;
      }
    ) => cb(value);
    ipcRenderer.on("on-dedup-progress", listener);
    return () => ipcRenderer.removeListener("on-dedup-progress", listener);
  },
  resetCommonRedistPreflight: () =>
    ipcRenderer.invoke("resetCommonRedistPreflight"),
  checkForUpdates: () => ipcRenderer.invoke("checkForUpdates"),
  restartAndInstallUpdate: () => ipcRenderer.invoke("restartAndInstallUpdate"),
  updateCheckerProceed: () => ipcRenderer.invoke("updateCheckerProceed"),
  updateCheckerApply: () => ipcRenderer.invoke("updateCheckerApply"),
  toggleConsoleWindow: () => ipcRenderer.invoke("toggleConsoleWindow"),
  onUpdateCheckerEvent: (cb: (event: unknown) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, event: unknown) =>
      cb(event);
    ipcRenderer.on("updateCheckerEvent", listener);
    return () => ipcRenderer.removeListener("updateCheckerEvent", listener);
  },

  /* Profile */
  getMe: () => ipcRenderer.invoke("getMe"),
  getProfileImages: (userId: string) =>
    ipcRenderer.invoke("getProfileImages", userId),
  updateProfile: (updateProfile: UpdateProfileRequest) =>
    ipcRenderer.invoke("updateProfile", updateProfile),
  getProfileImageMetadata: (imagePath: string) =>
    ipcRenderer.invoke("getProfileImageMetadata", imagePath),
  processProfileImage: (imagePath: string) =>
    ipcRenderer.invoke("processProfileImage", imagePath),
  cropProfileImage: (
    imagePath: string,
    params: {
      left: number;
      top: number;
      width: number;
      height: number;
      outputWidth: number;
      outputHeight: number;
      rotation?: number;
    }
  ) => ipcRenderer.invoke("cropProfileImage", imagePath, params),
  onSyncFriendRequests: (cb: (friendRequests: FriendRequestSync) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      friendRequests: FriendRequestSync
    ) => cb(friendRequests);
    ipcRenderer.on("on-sync-friend-requests", listener);
    return () =>
      ipcRenderer.removeListener("on-sync-friend-requests", listener);
  },
  onSyncNotificationCount: (cb: (notification: NotificationSync) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      notification: NotificationSync
    ) => cb(notification);
    ipcRenderer.on("on-sync-notification-count", listener);
    return () =>
      ipcRenderer.removeListener("on-sync-notification-count", listener);
  },
  updateFriendRequest: (userId: string, action: FriendRequestAction) =>
    ipcRenderer.invoke("updateFriendRequest", userId, action),

  /* User */
  getComparedUnlockedAchievements: (
    objectId: string,
    shop: GameShop,
    userId: string
  ) =>
    ipcRenderer.invoke(
      "getComparedUnlockedAchievements",
      objectId,
      shop,
      userId
    ),
  getUnlockedAchievements: (objectId: string, shop: GameShop) =>
    ipcRenderer.invoke("getUnlockedAchievements", objectId, shop),
  loadRetroAchievementsList: (
    shop: GameShop,
    objectId: string,
    system: string,
    title: string
  ) =>
    ipcRenderer.invoke(
      "loadRetroAchievementsList",
      shop,
      objectId,
      system,
      title
    ),
  loginRetroAchievements: (username: string, password: string) =>
    ipcRenderer.invoke("loginRetroAchievements", username, password),
  syncRalibretroLogin: () => ipcRenderer.invoke("syncRalibretroLogin"),

  /* Auth */
  getAuth: () => ipcRenderer.invoke("getAuth"),
  signOut: () => ipcRenderer.invoke("signOut"),
  openAuthWindow: (page: AuthPage) =>
    ipcRenderer.invoke("openAuthWindow", page),
  getSessionHash: () => ipcRenderer.invoke("getSessionHash"),
  onSignIn: (cb: () => void) => {
    const listener = (_event: Electron.IpcRendererEvent) => cb();
    ipcRenderer.on("on-signin", listener);
    return () => ipcRenderer.removeListener("on-signin", listener);
  },
  onAccountUpdated: (cb: () => void) => {
    const listener = (_event: Electron.IpcRendererEvent) => cb();
    ipcRenderer.on("on-account-updated", listener);
    return () => ipcRenderer.removeListener("on-account-updated", listener);
  },
  onLegendaryInstallProgress: (cb: (pct: number) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, pct: number) =>
      cb(pct);
    ipcRenderer.on("on-legendary-install-progress", listener);
    return () =>
      ipcRenderer.removeListener("on-legendary-install-progress", listener);
  },
  onBattleNetInstallProgress: (cb: (pct: number) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, pct: number) =>
      cb(pct);
    ipcRenderer.on("on-battlenet-install-progress", listener);
    return () =>
      ipcRenderer.removeListener("on-battlenet-install-progress", listener);
  },
  startSteamOpenIdLogin: (): Promise<string> =>
    ipcRenderer.invoke("startSteamOpenIdLogin"),
  openSteamLoginWindow: (): Promise<{ steamId: string } | null> =>
    ipcRenderer.invoke("openSteamLoginWindow"),
  downloadViaLegendary: (objectId: string, downloadPath?: string) =>
    ipcRenderer.invoke("downloadViaLegendary", objectId, downloadPath),
  cancelLegendaryDownload: (objectId: string) =>
    ipcRenderer.invoke("cancelLegendaryDownload", objectId),
  downloadViaGogdl: (objectId: string, downloadPath?: string) =>
    ipcRenderer.invoke("downloadViaGogdl", objectId, downloadPath),
  cancelGogdlDownload: (objectId: string) =>
    ipcRenderer.invoke("cancelGogdlDownload", objectId),
  installGogdl: () => ipcRenderer.invoke("installGogdl"),
  onGogdlInstallProgress: (cb: (pct: number) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, pct: number) =>
      cb(pct);
    ipcRenderer.on("on-gogdl-install-progress", listener);
    return () =>
      ipcRenderer.removeListener("on-gogdl-install-progress", listener);
  },
  getGogdlStatus: () => ipcRenderer.invoke("getGogdlStatus"),
  findLibraryGameByTitle: (title: string) =>
    ipcRenderer.invoke("findLibraryGameByTitle", title),
  onLegendaryProcessLog: (
    cb: (value: { objectId: string; line: string; isError: boolean }) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      value: { objectId: string; line: string; isError: boolean }
    ) => cb(value);
    ipcRenderer.on("on-legendary-process-log", listener);
    return () =>
      ipcRenderer.removeListener("on-legendary-process-log", listener);
  },
  onGogdlProcessLog: (
    cb: (value: { objectId: string; line: string; isError: boolean }) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      value: { objectId: string; line: string; isError: boolean }
    ) => cb(value);
    ipcRenderer.on("on-gogdl-process-log", listener);
    return () => ipcRenderer.removeListener("on-gogdl-process-log", listener);
  },
  onSignOut: (cb: () => void) => {
    const listener = (_event: Electron.IpcRendererEvent) => cb();
    ipcRenderer.on("on-signout", listener);
    return () => ipcRenderer.removeListener("on-signout", listener);
  },

  /* Notifications */
  publishNewRepacksNotification: (newRepacksCount: number) =>
    ipcRenderer.invoke("publishNewRepacksNotification", newRepacksCount),
  getLocalNotifications: () => ipcRenderer.invoke("getLocalNotifications"),
  getLocalNotificationsCount: () =>
    ipcRenderer.invoke("getLocalNotificationsCount"),
  markLocalNotificationRead: (id: string) =>
    ipcRenderer.invoke("markLocalNotificationRead", id),
  markAllLocalNotificationsRead: () =>
    ipcRenderer.invoke("markAllLocalNotificationsRead"),
  deleteLocalNotification: (id: string) =>
    ipcRenderer.invoke("deleteLocalNotification", id),
  clearAllLocalNotifications: () =>
    ipcRenderer.invoke("clearAllLocalNotifications"),
  onLocalNotificationCreated: (cb: (notification: unknown) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      notification: unknown
    ) => cb(notification);
    ipcRenderer.on("on-local-notification-created", listener);
    return () =>
      ipcRenderer.removeListener("on-local-notification-created", listener);
  },
  onAchievementUnlocked: (
    cb: (
      position?: AchievementCustomNotificationPosition,
      achievements?: AchievementNotificationInfo[]
    ) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      position?: AchievementCustomNotificationPosition,
      achievements?: AchievementNotificationInfo[]
    ) => cb(position, achievements);
    ipcRenderer.on("on-achievement-unlocked", listener);
    return () =>
      ipcRenderer.removeListener("on-achievement-unlocked", listener);
  },
  onInAppAchievementUnlocked: (
    cb: (
      position: AchievementCustomNotificationPosition,
      achievements: AchievementNotificationInfo[]
    ) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      position: AchievementCustomNotificationPosition,
      achievements: AchievementNotificationInfo[]
    ) => cb(position, achievements);
    ipcRenderer.on("on-achievement-unlocked-in-app", listener);
    return () =>
      ipcRenderer.removeListener("on-achievement-unlocked-in-app", listener);
  },
  onCombinedAchievementsUnlocked: (
    cb: (
      gameCount: number,
      achievementsCount: number,
      position: AchievementCustomNotificationPosition
    ) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      gameCount: number,
      achievementCount: number,
      position: AchievementCustomNotificationPosition
    ) => cb(gameCount, achievementCount, position);
    ipcRenderer.on("on-combined-achievements-unlocked", listener);
    return () =>
      ipcRenderer.removeListener("on-combined-achievements-unlocked", listener);
  },
  updateAchievementCustomNotificationWindow: () =>
    ipcRenderer.invoke("updateAchievementCustomNotificationWindow"),
  hideAchievementCustomNotificationWindow: () =>
    ipcRenderer.invoke("hideAchievementCustomNotificationWindow"),
  showAchievementTestNotification: () =>
    ipcRenderer.invoke("showAchievementTestNotification"),

  /* Themes */
  addCustomTheme: (theme: Theme) => ipcRenderer.invoke("addCustomTheme", theme),
  getAllCustomThemes: () => ipcRenderer.invoke("getAllCustomThemes"),
  deleteAllCustomThemes: () => ipcRenderer.invoke("deleteAllCustomThemes"),
  deleteCustomTheme: (themeId: string) =>
    ipcRenderer.invoke("deleteCustomTheme", themeId),
  updateCustomTheme: (themeId: string, code: string) =>
    ipcRenderer.invoke("updateCustomTheme", themeId, code),
  getCustomThemeById: (themeId: string) =>
    ipcRenderer.invoke("getCustomThemeById", themeId),
  getActiveCustomTheme: () => ipcRenderer.invoke("getActiveCustomTheme"),
  toggleCustomTheme: (themeId: string, isActive: boolean) =>
    ipcRenderer.invoke("toggleCustomTheme", themeId, isActive),
  copyThemeAchievementSound: (themeId: string, sourcePath: string) =>
    ipcRenderer.invoke("copyThemeAchievementSound", themeId, sourcePath),
  removeThemeAchievementSound: (themeId: string) =>
    ipcRenderer.invoke("removeThemeAchievementSound", themeId),
  getThemeSoundPath: (themeId: string) =>
    ipcRenderer.invoke("getThemeSoundPath", themeId),
  getThemeSoundDataUrl: (themeId: string) =>
    ipcRenderer.invoke("getThemeSoundDataUrl", themeId),
  importThemeSoundFromStore: (
    themeId: string,
    themeName: string,
    storeUrl: string
  ) =>
    ipcRenderer.invoke(
      "importThemeSoundFromStore",
      themeId,
      themeName,
      storeUrl
    ),

  /* Editor */
  openEditorWindow: (themeId: string) =>
    ipcRenderer.invoke("openEditorWindow", themeId),
  onCustomThemeUpdated: (cb: () => void) => {
    const listener = (_event: Electron.IpcRendererEvent) => cb();
    ipcRenderer.on("on-custom-theme-updated", listener);
    return () =>
      ipcRenderer.removeListener("on-custom-theme-updated", listener);
  },
  onNewDownloadOptions: (
    cb: (gamesWithNewOptions: { gameId: string; count: number }[]) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      gamesWithNewOptions: { gameId: string; count: number }[]
    ) => cb(gamesWithNewOptions);
    ipcRenderer.on("on-new-download-options", listener);
    return () =>
      ipcRenderer.removeListener("on-new-download-options", listener);
  },
  closeEditorWindow: (themeId?: string) =>
    ipcRenderer.invoke("closeEditorWindow", themeId),

  /* Big Picture */
  openBigPictureWindow: () => ipcRenderer.invoke("openBigPictureWindow"),

  /* Game Launcher Window */
  showGameLauncherWindow: () => ipcRenderer.invoke("showGameLauncherWindow"),
  closeGameLauncherWindow: () => ipcRenderer.invoke("closeGameLauncherWindow"),
  openMainWindow: () => ipcRenderer.invoke("openMainWindow"),
  isMainWindowOpen: () => ipcRenderer.invoke("isMainWindowOpen"),
  setWindowSize: (
    width: number,
    height: number,
    minWidth?: number,
    minHeight?: number
  ) => ipcRenderer.invoke("setWindowSize", width, height, minWidth, minHeight),
  getHardwareInfo: () => ipcRenderer.invoke("getHardwareInfo"),

  /* LevelDB Generic CRUD */
  leveldb: {
    get: (
      key: string,
      sublevelName?: string | null,
      valueEncoding?: "json" | "utf8"
    ) => ipcRenderer.invoke("leveldbGet", key, sublevelName, valueEncoding),
    put: (
      key: string,
      value: unknown,
      sublevelName?: string | null,
      valueEncoding?: "json" | "utf8"
    ) =>
      ipcRenderer.invoke("leveldbPut", key, value, sublevelName, valueEncoding),
    del: (key: string, sublevelName?: string | null) =>
      ipcRenderer.invoke("leveldbDel", key, sublevelName),
    clear: (sublevelName: string) =>
      ipcRenderer.invoke("leveldbClear", sublevelName),
    values: (sublevelName: string) =>
      ipcRenderer.invoke("leveldbValues", sublevelName),
    iterator: (sublevelName: string) =>
      ipcRenderer.invoke("leveldbIterator", sublevelName),
  },

  //UPDATEDD
  pauseGameTransfer: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("pauseGameTransfer", shop, objectId),
  resumeGameTransfer: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("resumeGameTransfer", shop, objectId),
  cancelGameTransfer: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("cancelGameTransfer", shop, objectId),

  // Add these to the electron object in contextBridge.exposeInMainWorld
  on: (channel: string, listener: (...args: any[]) => void) => {
    ipcRenderer.on(channel, listener);
  },
  off: (channel: string, listener: (...args: any[]) => void) => {
    ipcRenderer.off(channel, listener);
  },
  getAvailableDrives: () => ipcRenderer.invoke("getAvailableDrives"),
  transferGameFiles: (shop: GameShop, objectId: string, destParent: string) =>
    ipcRenderer.invoke("transferGameFiles", shop, objectId, destParent),

  // Installer
  installerGetDefaults: () => ipcRenderer.invoke("installer:getDefaults"),
  installerBrowseDirectory: (defaultPath: string) =>
    ipcRenderer.invoke("installer:browseDirectory", defaultPath),
  installerRunSetup: (mode: "install" | "portable", destDir?: string) =>
    ipcRenderer.invoke("installer:runSetup", mode, destDir),
  installerRelaunch: (destDir: string) =>
    ipcRenderer.invoke("installer:relaunch", destDir),
  installerOpenFolder: (destDir: string) =>
    ipcRenderer.invoke("installer:openFolder", destDir),
  installerCloseAndLaunch: () => ipcRenderer.invoke("installer:closeAndLaunch"),
  onInstallerProgress: (
    cb: (pct: number, file: string) => void
  ): (() => void) => {
    const listener = (_: unknown, pct: number, file: string) => cb(pct, file);
    ipcRenderer.on("installer:progress", listener);
    return () => ipcRenderer.off("installer:progress", listener);
  },

  /* Main window controls (Linux) */
  minimizeMainWindow: () => ipcRenderer.invoke("minimizeMainWindow"),
  toggleMaximizeMainWindow: () =>
    ipcRenderer.invoke("toggleMaximizeMainWindow"),
  closeMainWindow: () => ipcRenderer.invoke("closeMainWindow"),
  /* Auth window controls (Linux) */
  minimizeAuthWindow: () => ipcRenderer.invoke("minimizeAuthWindow"),
  closeAuthWindow: () => ipcRenderer.invoke("closeAuthWindow"),
  isMainWindowMaximized: (): Promise<boolean> =>
    ipcRenderer.invoke("isMainWindowMaximized"),
  onWindowMaximizeChange: (
    cb: (isMaximized: boolean) => void
  ): (() => void) => {
    const listener = (_: unknown, isMaximized: boolean) => cb(isMaximized);
    ipcRenderer.on("on-window-maximize-change", listener);
    return () =>
      ipcRenderer.removeListener("on-window-maximize-change", listener);
  },
  isWayland:
    process.env.XDG_SESSION_TYPE === "wayland" ||
    process.env.WAYLAND_DISPLAY !== undefined,

  /* Friends window */
  openFriendsWindow: () => ipcRenderer.invoke("openFriendsWindow"),
  minimizeFriendsWindow: () => ipcRenderer.invoke("minimizeFriendsWindow"),
  closeFriendsWindow: () => ipcRenderer.invoke("closeFriendsWindow"),
  openFriendProfileInMainWindow: (userId: string) =>
    ipcRenderer.invoke("openFriendProfileInMainWindow", userId),
  openAddFriendModalInMainWindow: () =>
    ipcRenderer.invoke("openAddFriendModalInMainWindow"),
  onOpenAddFriendModal: (cb: () => void): (() => void) => {
    const listener = () => cb();
    ipcRenderer.on("on-open-add-friend-modal", listener);
    return () =>
      ipcRenderer.removeListener("on-open-add-friend-modal", listener);
  },
  onFriendsUpdated: (cb: () => void): (() => void) => {
    const listener = () => cb();
    ipcRenderer.on("on-friends-updated", listener);
    return () => ipcRenderer.removeListener("on-friends-updated", listener);
  },
  onFriendPresence: (
    cb: (presence: FriendPresenceSync) => void
  ): (() => void) => {
    const listener = (_: unknown, presence: FriendPresenceSync) => cb(presence);
    ipcRenderer.on("on-friend-presence", listener);
    return () => ipcRenderer.removeListener("on-friend-presence", listener);
  },
  onProfileUpdated: (cb: () => void): (() => void) => {
    const listener = () => cb();
    ipcRenderer.on("on-profile-updated", listener);
    return () => ipcRenderer.removeListener("on-profile-updated", listener);
  },
  onNavigate: (cb: (path: string) => void): (() => void) => {
    const listener = (_: unknown, path: string) => cb(path);
    ipcRenderer.on("on-navigate", listener);
    return () => ipcRenderer.removeListener("on-navigate", listener);
  },
  getProcessedFriendImage: (
    imageUrl: string | null,
    options: { width: number; height: number; preserveAnimation?: boolean }
  ): Promise<string | null> =>
    ipcRenderer.invoke("getProcessedFriendImage", imageUrl, options),

  getMinervaDownloadOptions: (system: EmulatorSystem, title: string) =>
    ipcRenderer.invoke("getMinervaDownloadOptions", system, title),

  buildMinervaCatalogue: (system?: EmulatorSystem) =>
    ipcRenderer.invoke("buildMinervaCatalogue", system),

  searchMinervaCatalogue: (title: string, system?: EmulatorSystem) =>
    ipcRenderer.invoke("searchMinervaCatalogue", title, system),
  getConsoleHowLongToBeat: (title: string) =>
    ipcRenderer.invoke("getConsoleHowLongToBeat", title),
  searchMinervaGames: (query: string, limit?: number) =>
    ipcRenderer.invoke("searchMinervaGames", query, limit),
  searchClassicsCatalogue: (query: string, limit?: number) =>
    ipcRenderer.invoke("searchClassicsCatalogue", query, limit),

  // Cloud debugger
  runCloudDebugger: () => ipcRenderer.invoke("runCloudDebugger"),

  // Debug console window
  openConsoleWindow: () => ipcRenderer.invoke("openConsoleWindow"),
  onConsoleLog: (
    cb: (entry: {
      ts: number;
      level: string;
      scope: string;
      text: string;
    }) => void
  ): (() => void) => {
    const listener = (
      _: unknown,
      entry: { ts: number; level: string; scope: string; text: string }
    ) => cb(entry);
    ipcRenderer.on("console:log", listener);
    return () => ipcRenderer.off("console:log", listener);
  },
});

const reportNetworkStatus = (online: boolean, switched = false) => {
  ipcRenderer.invoke("updateNetworkStatus", { online, switched }).catch(() => {
    return undefined;
  });
};

if (globalThis.window !== undefined) {
  globalThis.addEventListener("online", () => reportNetworkStatus(true, true));
  globalThis.addEventListener("offline", () => reportNetworkStatus(false));

  const connection = (
    navigator as Navigator & {
      connection?: {
        addEventListener?: (type: string, listener: () => void) => void;
      };
    }
  ).connection;

  connection?.addEventListener?.("change", () =>
    reportNetworkStatus(navigator.onLine, true)
  );
}
