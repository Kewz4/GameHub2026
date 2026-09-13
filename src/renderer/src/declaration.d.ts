import type { AuthPage } from "@shared";
import type {
  AppUpdaterEvent,
  GameShop,
  Steam250Game,
  DownloadProgress,
  SeedingStatus,
  UserPreferences,
  StartGameDownloadPayload,
  StartCustomDownloadPayload,
  StartCustomDownloadResult,
  RealDebridUser,
  PremiumizeUser,
  AllDebridUser,
  UserProfile,
  FriendRequestAction,
  UpdateProfileRequest,
  GameStats,
  UserDetails,
  FriendRequestSync,
  NotificationSync,
  UserAchievement,
  ComparedAchievements,
  LibraryGame,
  GameRunning,
  TorBoxUser,
  Theme,
  Auth,
  ShortcutLocation,
  ShopAssets,
  ShopDetailsWithAssets,
  AchievementCustomNotificationPosition,
  AchievementNotificationInfo,
  Game,
  DiskUsage,
  DownloadSource,
  LocalNotification,
  ProtonVersion,
  CreateSteamShortcutOptions,
  TorrentFilesResponse,
  DownloadLayoutState,
  ExcludedGame,
  EmulatorSystem,
  CemuGraphicPack,
  ModManagerStatus,
  ModInstallPrep,
  GameBananaMod,
  GameBananaModDetail,
  EmulatorConfig,
  EmulatorConfigMap,
  ControllerProfile,
  EmulatorBinary,
  EmulatedControllerType,
  ClassicsDiscUpdate,
  DetectedRom,
  Ps2MemcardScanInput,
  Ps2MemcardScanProgress,
  Ps2MemoryCardSaveRecord,
  Ps2ExportResult,
  EmulationBackupProgress,
  SteamEmulatorDetection,
  SteamEmulatorResult,
  EmulatorBinary,
  EmulatorInstallProgress,
  EmulatorInstallResult,
  ResolvedInstallOption,
  EmulationCloudSave,
  EmulationSavePlatform,
  MemcardFormatState,
  MemcardRestoreResult,
  MemcardRestoreTarget,
  CloudSaveAutomaticSyncModeChangedEvent,
  CloudSaveAutomaticSyncEvent,
  CloudSaveConflictResolution,
  CloudSaveOverview,
  CloudSaveV2FileDetails,
  CloudSaveV2LibraryEntry,
  CloudSaveSyncProgressPayload,
  SyncCloudSaveOnGamePageResult,
  SyncGameCloudSaveResult,
  SelectCloudSaveCustomPathResult,
  CloudSaveCustomPathApproval,
  CloudSaveModalSyncResult,
  SelectCloudSaveCustomPathApprovalResult,
  ConfirmCloudSaveCustomPathApprovalResult,
  ConfirmCloudSaveCustomPathRebindApprovalResult,
  LudusaviBackupScanEntry,
  LudusaviImportResult,
  DeleteAchievementSouvenirRequest,
  ProfileAchievementSouvenir,
} from "@types";

export interface DriveInfo {
  root: string;
  label: string;
  free: number;
  total: number;
}

declare global {
  declare module "*.svg" {
    const content: React.FunctionComponent<React.SVGAttributes<SVGElement>>;
    export default content;
  }

  type UpdateCheckerEvent =
    | { type: "checking"; currentVersion: string }
    | { type: "not-available"; currentVersion: string }
    | { type: "available"; version: string }
    | {
        type: "downloading";
        percent: number;
        bytesPerSecond: number;
        transferred: number;
        total: number;
      }
    | { type: "downloaded"; version: string }
    | { type: "applying" }
    | { type: "error"; message: string };

  interface FileExplorerEntry {
    name: string;
    path: string;
    isDirectory: boolean;
    isFile: boolean;
    extension: string;
    size: number;
  }

  interface FileExplorerPathInfo {
    exists: boolean;
    isDirectory: boolean;
    isFile: boolean;
  }

  interface Electron {
    onCloudSaveAutomaticSyncModeChanged: (
      callback: (event: CloudSaveAutomaticSyncModeChangedEvent) => void
    ) => () => void;
    onCloudSaveAutomaticSync: (
      callback: (event: CloudSaveAutomaticSyncEvent) => void
    ) => () => void;
    getCloudSaveOverview: (
      objectId: string,
      shop: GameShop
    ) => Promise<CloudSaveOverview>;
    getCloudSaveV2FileDetails: (
      objectId: string,
      shop: GameShop
    ) => Promise<CloudSaveV2FileDetails>;
    getCloudSaveV2Library: () => Promise<CloudSaveV2LibraryEntry[]>;
    deleteGameCloudSaveData: (
      objectId: string,
      shop: GameShop
    ) => Promise<void>;
    selectCloudSaveCustomPath: (
      objectId: string,
      shop: GameShop,
      selectedPath?: string
    ) => Promise<SelectCloudSaveCustomPathResult>;
    createCloudSaveCustomPathRebindApproval: (
      objectId: string,
      shop: GameShop,
      rawPath: string
    ) => Promise<CloudSaveCustomPathApproval>;
    confirmCloudSaveCustomPathRebindApproval: (
      approvalId: string,
      objectId: string,
      shop: GameShop
    ) => Promise<ConfirmCloudSaveCustomPathRebindApprovalResult>;
    getPendingCloudSaveCustomPathApproval: (
      objectId: string,
      shop: GameShop
    ) => Promise<CloudSaveCustomPathApproval | null>;
    selectCloudSaveCustomPathApproval: (
      approvalId: string,
      selectedPath?: string
    ) => Promise<SelectCloudSaveCustomPathApprovalResult>;
    confirmCloudSaveCustomPathApproval: (
      approvalId: string
    ) => Promise<ConfirmCloudSaveCustomPathApprovalResult>;
    dismissCloudSaveCustomPathApproval: (approvalId: string) => Promise<void>;
    removeCloudSaveCustomPath: (
      objectId: string,
      shop: GameShop,
      rawPath: string,
      onProgress?: (progress: CloudSaveSyncProgressPayload) => void
    ) => Promise<SyncGameCloudSaveResult>;
    setCloudSaveAutomaticSyncEnabled: (
      objectId: string,
      shop: GameShop,
      enabled: boolean
    ) => Promise<boolean>;
    syncCloudSaveOnGamePage: (
      objectId: string,
      shop: GameShop
    ) => Promise<SyncCloudSaveOnGamePageResult>;
    syncGameCloudSave: (
      objectId: string,
      shop: GameShop,
      onProgress?: (progress: CloudSaveSyncProgressPayload) => void
    ) => Promise<SyncGameCloudSaveResult>;
    syncGameCloudSaveFromModal: (
      objectId: string,
      shop: GameShop,
      approvalId: string | null,
      onProgress?: (progress: CloudSaveSyncProgressPayload) => void
    ) => Promise<CloudSaveModalSyncResult>;
    syncCloudSaveAfterCustomPathRebind: (
      objectId: string,
      shop: GameShop,
      rawPath: string,
      onProgress?: (progress: CloudSaveSyncProgressPayload) => void
    ) => Promise<SyncGameCloudSaveResult>;
    resolveCloudSaveConflict: (
      objectId: string,
      shop: GameShop,
      resolution: CloudSaveConflictResolution,
      onProgress?: (progress: CloudSaveSyncProgressPayload) => void
    ) => Promise<SyncGameCloudSaveResult>;
    /* Torrenting */
    startGameDownload: (
      payload: StartGameDownloadPayload
    ) => Promise<{ ok: boolean; error?: string }>;
    startCustomDownload: (
      payload: StartCustomDownloadPayload
    ) => Promise<StartCustomDownloadResult>;
    addGameToQueue: (
      payload: StartGameDownloadPayload
    ) => Promise<{ ok: boolean; error?: string }>;
    cancelGameDownload: (shop: GameShop, objectId: string) => Promise<void>;
    pauseGameDownload: (shop: GameShop, objectId: string) => Promise<void>;
    resumeGameDownload: (
      shop: GameShop,
      objectId: string,
      strategy?: "interruptActive" | "queueIfActive"
    ) => Promise<void>;
    pauseGameSeed: (shop: GameShop, objectId: string) => Promise<void>;
    resumeGameSeed: (shop: GameShop, objectId: string) => Promise<void>;
    updateDownloadQueuePosition: (
      shop: GameShop,
      objectId: string,
      direction: "up" | "down"
    ) => Promise<boolean>;
    setDownloadQueuePosition: (
      shop: GameShop,
      objectId: string,
      targetIndex: number
    ) => Promise<boolean>;
    setPausedDownloadPosition: (
      shop: GameShop,
      objectId: string,
      targetIndex: number
    ) => Promise<boolean>;
    moveDownloadPlacement: (
      shop: GameShop,
      objectId: string,
      targetArea: "hero" | "queue" | "paused",
      targetIndex?: number
    ) => Promise<boolean>;
    getDownloadLayoutState: () => Promise<DownloadLayoutState>;
    onDownloadProgress: (
      cb: (value: DownloadProgress | null) => void
    ) => () => Electron.IpcRenderer;
    onDownloadHalted: (
      cb: (gameTitle: string) => void
    ) => () => Electron.IpcRenderer;
    onSeedingStatus: (
      cb: (value: SeedingStatus[]) => void
    ) => () => Electron.IpcRenderer;
    onHardDelete: (cb: () => void) => () => Electron.IpcRenderer;
    checkDebridAvailability: (
      magnets: string[]
    ) => Promise<Record<string, boolean>>;
    getTorrentFiles: (
      magnet: string
    ) => Promise<
      { ok: true; data: TorrentFilesResponse } | { ok: false; error: string }
    >;

    /* Catalogue */
    getGameShopDetails: (
      objectId: string,
      shop: GameShop,
      language: string
    ) => Promise<ShopDetailsWithAssets | null>;
    getGamesMaturity: (
      games: { shop: GameShop; objectId: string; title: string }[],
      resolve: boolean
    ) => Promise<string[]>;
    getRandomGame: () => Promise<Steam250Game>;
    getGameStats: (objectId: string, shop: GameShop) => Promise<GameStats>;
    getGameAssets: (
      objectId: string,
      shop: GameShop,
      titleOrOptions?: string | { forceFresh?: boolean }
    ) => Promise<ShopAssets | null>;
    onUpdateAchievements: (
      objectId: string,
      shop: GameShop,
      cb: (achievements: UserAchievement[]) => void
    ) => () => Electron.IpcRenderer;

    /* Library */
    toggleAutomaticCloudSync: (
      shop: GameShop,
      objectId: string,
      automaticCloudSync: boolean
    ) => Promise<void>;
    toggleGameMangohud: (
      shop: GameShop,
      objectId: string,
      autoRunMangohud: boolean
    ) => Promise<void>;
    toggleGameGamemode: (
      shop: GameShop,
      objectId: string,
      autoRunGamemode: boolean
    ) => Promise<void>;
    isGamemodeAvailable: () => Promise<boolean>;
    isMangohudAvailable: () => Promise<boolean>;
    isWinetricksAvailable: () => Promise<boolean>;
    addGameToLibrary: (
      shop: GameShop,
      objectId: string,
      title: string,
      platform?: string | null
    ) => Promise<void>;
    getSteamPlayerSummary: (
      steamId: string,
      apiKey?: string
    ) => Promise<{
      steamid: string;
      personaname: string;
      avatarfull: string;
    } | null>;
    syncSteamLibrary: (
      steamId: string,
      apiKey?: string
    ) => Promise<{ total: number; added: number; error?: string }>;
    getLegendaryStatus: () => Promise<{
      binaryFound: boolean;
      binaryPath: string | null;
      account: string | null;
      authenticated: boolean;
    }>;
    installLegendary: () => Promise<{ path: string }>;
    openLegendaryAuthWindow: () => Promise<{
      success: boolean;
      account?: string;
    }>;
    completeEpicAuth: (
      code: string
    ) => Promise<{ success: boolean; account?: string }>;
    epicDirectLogin: (
      email: string,
      password: string
    ) => Promise<
      | { success: true; account: string }
      | {
          success: false;
          mfaRequired: true;
          mfaToken: string;
          challengeType: string;
        }
      | { success: false; error: string }
    >;
    epicDirectLoginMfa: (
      otp: string,
      mfaToken: string,
      challengeType: string
    ) => Promise<
      { success: true; account: string } | { success: false; error: string }
    >;
    openEpicSocialAuthWindow: (
      provider: "google" | "facebook" | "apple"
    ) => Promise<{ success: boolean; account?: string }>;
    epicSignOut: () => Promise<{
      binaryFound: boolean;
      binaryPath: string | null;
      account: string | null;
      authenticated: boolean;
    }>;
    completeGogAuth: (
      code: string
    ) => Promise<{ refresh_token: string; username: string } | null>;
    gogDirectLogin: (
      email: string,
      password: string
    ) => Promise<
      | { success: true; username: string; refresh_token: string }
      | { success: false; error: string }
    >;
    syncEpicLibrary: () => Promise<{
      total: number;
      added: number;
      addedGames: Array<{
        title: string;
        coverUrl: string | null;
        what: string;
      }>;
    }>;
    installBattleNet: () => Promise<{ path: string }>;
    onLegendaryInstallProgress: (cb: (pct: number) => void) => () => void;
    onBattleNetInstallProgress: (cb: (pct: number) => void) => () => void;
    openGogAuthWindow: () => Promise<{
      refresh_token: string;
      username: string;
    } | null>;
    completeGogAuth: (code: string) => Promise<{
      refresh_token: string;
      username: string;
    } | null>;
    syncGogLibrary: () => Promise<{
      total: number;
      added: number;
      addedGames: Array<{
        title: string;
        coverUrl: string | null;
        what: string;
      }>;
    }>;
    getGogUserInfo: () => Promise<{ userId: string; username: string } | null>;
    getBattleNetGames: () => Promise<{
      installed: boolean;
      detected: Array<{
        productCode: string;
        title: string;
        iconUrl: string;
        launchUri: string;
      }>;
      all: Array<{
        productCode: string;
        title: string;
        iconUrl: string;
        launchUri: string;
      }>;
    }>;
    addBattleNetGamesToLibrary: (
      productCodes: string[]
    ) => Promise<{ added: number }>;
    getRiotGames: () => Promise<{
      installed: boolean;
      detected: Array<{
        productId: string;
        patchline: string;
        title: string;
      }>;
      all: Array<{
        productId: string;
        patchline: string;
        title: string;
      }>;
    }>;
    addRiotGamesToLibrary: (productIds: string[]) => Promise<{ added: number }>;
    getUbisoftGames: () => Promise<{
      installed: boolean;
      detected: Array<{
        installId: string;
        title: string;
        installDir: string;
        launchUri: string;
      }>;
    }>;
    addUbisoftGamesToLibrary: (
      installIds: string[]
    ) => Promise<{ added: number }>;
    getEaGames: () => Promise<{
      installed: boolean;
      detected: Array<{
        offerId: string | null;
        title: string;
        installDir: string | null;
      }>;
    }>;
    addEaGamesToLibrary: (titles: string[]) => Promise<{ added: number }>;
    openUbisoftAuthWindow: () => Promise<{
      ticket: string;
      userId: string;
      profileId: string;
      username: string;
    } | null>;
    syncUbisoftLibrary: () => Promise<{
      total: number;
      added: number;
      error?: string;
    }>;
    openEaAuthWindow: () => Promise<{
      accessToken: string;
      username: string;
      pid: string;
    } | null>;
    syncEaLibrary: () => Promise<{
      total: number;
      added: number;
      error?: string;
    }>;
    importPlatformAchievements: (
      platform: "steam" | "epic" | "gog" | "xbox"
    ) => Promise<{
      gamesProcessed: number;
      gamesWithAchievements: number;
      totalUnlocked: number;
    }>;
    openExophaseAuthWindow: () => Promise<{
      authenticated: boolean;
      username: string | null;
      verification: "verified" | "cached" | "signed-out";
    }>;
    getExophaseAuthState: (revalidate?: boolean) => Promise<{
      authenticated: boolean;
      username: string | null;
      verification: "verified" | "cached" | "signed-out";
    }>;
    validateExophaseProfile: (input: string) => Promise<{
      ok: boolean;
      username?: string;
      gameCount?: number;
      error?: string;
    }>;
    clearExophaseSession: () => Promise<{ ok: boolean }>;
    syncExophaseAchievements: () => Promise<{
      gamesProcessed: number;
      gamesWithAchievements: number;
      totalUnlocked: number;
      error?: string;
    }>;
    importPlaystationAchievements: () => Promise<{
      gamesProcessed: number;
      gamesMatched: number;
      totalUnlocked: number;
      error?: string;
    }>;
    getExophaseSyncReport: () => Promise<
      import("@types").ExophaseSyncReport | null
    >;
    getHydraCloudAchievements: () => Promise<
      Array<{
        shop: string;
        objectId: string;
        title: string;
        iconUrl: string | null;
        totalAchievements: number;
        unlockedAchievements: number;
      }>
    >;
    getExophaseSyncState: () => Promise<{
      active: boolean;
      progress: {
        current: number;
        total: number;
        title: string;
        phase?: string;
      } | null;
    }>;
    runExophaseBackgroundSync: () => Promise<{ ok: boolean }>;
    onExophaseSyncProgress: (
      cb: (progress: {
        current: number;
        total: number;
        title: string;
        phase?: string;
      }) => void
    ) => () => void;
    onExophaseSyncActive: (cb: (active: boolean) => void) => () => void;
    lookupGameAchievements: (
      shop: string,
      objectId: string
    ) => Promise<{
      found: boolean;
      achievementCount: number;
      unlockedCount: number;
      awardsUrl?: string;
      error?: string;
    }>;
    onExophaseLookupProgress: (
      cb: (info: { status: string; message: string }) => void
    ) => () => void;
    syncGamePassLibrary: () => Promise<{ added: number; total: number }>;
    openXboxAuthWindow: () => Promise<{
      success: boolean;
      gamertag?: string;
      hasGamePass?: boolean;
    }>;
    addCustomGameToLibrary: (
      title: string,
      executablePath: string,
      iconUrl?: string,
      logoImageUrl?: string,
      libraryHeroImageUrl?: string,
      coverImageUrl?: string,
      libraryImageUrl?: string,
      matchedSteamObjectId?: string | null
    ) => Promise<Game>;
    updateCustomGame: (params: {
      shop: GameShop;
      objectId: string;
      title: string;
      iconUrl?: string;
      logoImageUrl?: string;
      libraryHeroImageUrl?: string;
      coverImageUrl?: string;
      libraryImageUrl?: string;
      originalIconPath?: string;
      originalLogoPath?: string;
      originalHeroPath?: string;
      matchedSteamObjectId?: string | null;
    }) => Promise<Game>;
    copyCustomGameAsset: (
      sourcePath: string,
      assetType: "icon" | "logo" | "hero"
    ) => Promise<string>;
    cleanupUnusedAssets: () => Promise<{
      deletedCount: number;
      errors: string[];
    }>;
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
    }) => Promise<Game>;
    searchGameArtwork: (params: {
      shop: GameShop;
      objectId: string;
      title: string;
      assetType: "cover" | "hero" | "logo" | "icon";
      source: "steamgriddb" | "igdb";
    }) => Promise<
      Array<{
        url: string;
        thumbnailUrl: string;
        width: number | null;
        height: number | null;
      }>
    >;
    applyGameArtwork: (params: {
      shop: GameShop;
      objectId: string;
      assetType: "cover" | "hero" | "logo" | "icon";
      url: string;
    }) => Promise<Game>;
    createGameShortcut: (
      shop: GameShop,
      objectId: string,
      location: ShortcutLocation
    ) => Promise<boolean>;
    updateExecutablePath: (
      shop: GameShop,
      objectId: string,
      executablePath: string | null
    ) => Promise<void>;
    updateTrackingExecutablePaths: (
      shop: GameShop,
      objectId: string,
      trackingExecutablePaths: string[]
    ) => Promise<void>;
    addGameToFavorites: (shop: GameShop, objectId: string) => Promise<void>;
    removeGameFromFavorites: (
      shop: GameShop,
      objectId: string
    ) => Promise<void>;
    assignGameToCollection: (
      shop: GameShop,
      objectId: string,
      collectionIds: string[]
    ) => Promise<void>;
    clearNewDownloadOptions: (
      shop: GameShop,
      objectId: string
    ) => Promise<void>;
    toggleGamePin: (
      shop: GameShop,
      objectId: string,
      pinned: boolean
    ) => Promise<void>;
    updateLaunchOptions: (
      shop: GameShop,
      objectId: string,
      launchOptions: string | null
    ) => Promise<void>;
    selectGameWinePrefix: (
      shop: GameShop,
      objectId: string,
      winePrefixPath: string | null
    ) => Promise<void>;
    selectGameProtonPath: (
      shop: GameShop,
      objectId: string,
      protonPath: string | null
    ) => Promise<void>;
    getInstalledProtonVersions: () => Promise<ProtonVersion[]>;
    getGameLaunchProtonVersion: (
      shop: GameShop,
      objectId: string
    ) => Promise<string | null>;
    verifyExecutablePathInUse: (executablePath: string) => Promise<Game>;
    getLibrary: () => Promise<LibraryGame[]>;
    getAchievementGames: () => Promise<import("@types").AchievementGameStat[]>;
    refreshLibraryAssets: () => Promise<void>;
    generateMissingMetadata: () => Promise<{
      updated: number;
      skipped: number;
      failed: number;
      results: Array<{
        title: string;
        coverUrl: string | null;
        what: string;
        status: "updated" | "failed";
      }>;
    }>;
    mergeDuplicateGames: () => Promise<{
      merged: number;
      mergedTitles: string[];
    }>;
    runCloudDebugger: (options?: {
      repair?: boolean;
    }) => Promise<
      import("@main/events/library/run-cloud-debugger").CloudDebugReport
    >;
    clearLibrary: () => Promise<{ cleared: number }>;
    deleteCloudLibrary: () => Promise<{
      deleted: number;
      total?: number;
      error?: string;
    }>;
    findLibraryGameByTitle: (
      title: string
    ) => Promise<import("@types").Game | null>;
    getGogdlStatus: () => Promise<{
      binaryFound: boolean;
      binaryPath: string | null;
    }>;
    openGameInstaller: (shop: GameShop, objectId: string) => Promise<boolean>;
    getGameInstallerActionType: (
      shop: GameShop,
      objectId: string
    ) => Promise<"install" | "open-folder">;
    openGameInstallerPath: (shop: GameShop, objectId: string) => Promise<void>;
    openGameWinetricks: (shop: GameShop, objectId: string) => Promise<boolean>;
    openGameExecutablePath: (shop: GameShop, objectId: string) => Promise<void>;
    getGameSaveFolder: (
      shop: GameShop,
      objectId: string
    ) => Promise<string | null>;
    openGameSaveFolder: (
      shop: GameShop,
      objectId: string,
      saveFolderPath: string
    ) => Promise<boolean>;
    openGame: (
      shop: GameShop,
      objectId: string,
      executablePath: string,
      launchOptions?: string | null
    ) => Promise<void>;
    closeGame: (shop: GameShop, objectId: string) => Promise<boolean>;
    getSteamEmulatorStatus: (
      shop: GameShop,
      objectId: string
    ) => Promise<SteamEmulatorDetection | null>;
    applySteamEmulator: (
      shop: GameShop,
      objectId: string
    ) => Promise<SteamEmulatorResult>;
    checkSteamEmulatorToolAvailability: () => Promise<boolean>;
    removeGameFromLibrary: (shop: GameShop, objectId: string) => Promise<void>;
    removeGame: (shop: GameShop, objectId: string) => Promise<void>;
    deleteGameFolder: (shop: GameShop, objectId: string) => Promise<unknown>;
    getGameByObjectId: (
      shop: GameShop,
      objectId: string
    ) => Promise<LibraryGame | null>;
    onGamesRunning: (
      cb: (
        gamesRunning: Pick<GameRunning, "id" | "sessionDurationInMillis">[]
      ) => void
    ) => () => Electron.IpcRenderer;
    onLibraryBatchComplete: (cb: () => void) => () => Electron.IpcRenderer;
    onDownloadsUpdated: (cb: () => void) => () => Electron.IpcRenderer;
    resetGameAchievements: (shop: GameShop, objectId: string) => Promise<void>;
    changeGamePlayTime: (
      shop: GameShop,
      objectId: string,
      playtimeInSeconds: number
    ) => Promise<void>;
    /* User preferences */
    authenticateRealDebrid: (apiToken: string) => Promise<RealDebridUser>;
    authenticatePremiumize: (apiToken: string) => Promise<PremiumizeUser>;
    authenticateAllDebrid: (apiToken: string) => Promise<AllDebridUser>;
    authenticateTorBox: (apiToken: string) => Promise<TorBoxUser>;
    getUserPreferences: () => Promise<UserPreferences | null>;
    updateUserPreferences: (
      preferences: Partial<UserPreferences>
    ) => Promise<void>;
    backupSettingsToCloud: () => Promise<{ ok: boolean }>;
    restoreSettingsFromCloud: () => Promise<{
      restored: boolean;
      updatedAt?: string;
    }>;
    onUserPreferencesUpdated: (
      cb: (preferences: UserPreferences | null) => void
    ) => () => Electron.IpcRenderer;
    autoLaunch: (autoLaunchProps: {
      enabled: boolean;
      minimized: boolean;
    }) => Promise<void>;
    extractGameDownload: (shop: GameShop, objectId: string) => Promise<boolean>;
    scanInstalledGames: (dryRun?: boolean) => Promise<{
      foundGames: {
        title: string;
        executablePath: string;
        key: string;
        isNew?: boolean;
        emulatorSystem?: EmulatorSystem;
      }[];
      total: number;
    }>;
    checkLibraryInstallation: (
      writeThrough?: boolean
    ) => Promise<import("@types").LibraryInstallationReport>;
    selectiveScanInstalledGames: (
      scanPaths: string[],
      dryRun?: boolean
    ) => Promise<{
      foundGames: {
        title: string;
        executablePath: string;
        key: string;
        isNew?: boolean;
        emulatorSystem?: EmulatorSystem;
      }[];
      total: number;
    }>;
    confirmScanGames: (
      approvedGames: Array<{
        key: string;
        executablePath: string;
        title?: string;
        isNew?: boolean;
        emulatorSystem?: EmulatorSystem;
      }>
    ) => Promise<void>;
    onScanProgress: (
      cb: (progress: {
        scanned: number;
        total: number;
        foundCount: number;
        currentTitle: string;
      }) => void
    ) => () => void;
    importPlaynitePlaytime: (
      dbPath?: string,
      options?: { syncCloud?: boolean }
    ) => Promise<{
      matched: number;
      total: number;
      cloudSynced: number;
      cloudSyncPending: number;
      games: Array<{
        title: string;
        previousHours: number;
        playniteHours: number;
        changeHours: number;
      }>;
      preserved: Array<{
        title: string;
        existingHours: number;
        playniteHours: number;
      }>;
      unmatched: Array<{ name: string; gameId: string; playtimeHours: number }>;
      cached: Array<{
        title: string;
        playtimeHours: number;
        catalogueMatched: boolean;
      }>;
      detectedPath: string | null;
    }>;
    getExclusionList: () => Promise<ExcludedGame[]>;
    addGameToExclusionList: (
      shop: GameShop,
      objectId: string,
      title: string
    ) => Promise<ExcludedGame[]>;
    removeGameFromExclusionList: (
      shop: GameShop,
      objectId: string
    ) => Promise<ExcludedGame[]>;
    onExtractionComplete: (
      cb: (shop: GameShop, objectId: string) => void
    ) => () => Electron.IpcRenderer;
    onExtractionProgress: (
      cb: (shop: GameShop, objectId: string, progress: number) => void
    ) => () => Electron.IpcRenderer;
    onExtractionFailed: (
      cb: (shop: GameShop, objectId: string) => void
    ) => () => Electron.IpcRenderer;
    onArchiveDeletionPrompt: (
      cb: (archivePaths: string[]) => void
    ) => () => Electron.IpcRenderer;
    deleteArchive: (filePath: string) => Promise<boolean>;
    enableExperimentalAchievements: (
      shop: GameShop,
      objectId: string
    ) => Promise<{ success: boolean }>;
    onAchievementSupportMissing: (
      callback: (data: {
        objectId: string;
        shop: GameShop;
        title: string;
      }) => void
    ) => () => void;
    getDefaultWinePrefixSelectionPath: () => Promise<string | null>;
    createSteamShortcut: (
      shop: GameShop,
      objectId: string,
      options?: CreateSteamShortcutOptions
    ) => Promise<void>;
    deleteSteamShortcut: (shop: GameShop, objectId: string) => Promise<void>;
    checkSteamShortcut: (shop: GameShop, objectId: string) => Promise<boolean>;

    /* Download sources */
    addDownloadSource: (url: string) => Promise<DownloadSource>;
    removeDownloadSource: (
      removeAll = false,
      downloadSourceId?: string
    ) => Promise<void>;
    getDownloadSources: () => Promise<DownloadSource[]>;
    syncDownloadSources: () => Promise<void>;
    getDownloadSourcesCheckBaseline: () => Promise<string | null>;
    getDownloadSourcesSinceValue: () => Promise<string | null>;

    /* Hardware */
    getDiskFreeSpace: (path: string) => Promise<DiskUsage | null>;
    checkFolderWritePermission: (path: string) => Promise<boolean>;

    /* Cloud save */
    scanLudusaviBackupFolder: (
      folderPath: string
    ) => Promise<LudusaviBackupScanEntry[]>;
    importLudusaviBackup: (
      backupFolderPath: string,
      objectId: string,
      shop: GameShop,
      options?: {
        dryRun?: boolean;
        replaceExisting?: boolean;
        expectedSnapshotId?: string;
      }
    ) => Promise<LudusaviImportResult>;

    /* Clipboard */
    clipboard: {
      writeText: (text: string) => Promise<void>;
    };

    /* Misc */
    openExternal: (src: string) => Promise<void>;
    openCheckout: () => Promise<void>;
    getVersion: () => Promise<string>;
    isStaging: () => Promise<boolean>;
    ping: () => string;
    getDefaultDownloadsPath: () => Promise<string>;
    isPortableVersion: () => Promise<boolean>;
    getExeName: (exePath: string) => Promise<string | null>;
    resolveCustomGameInfo: (exePath: string) => Promise<{
      title: string;
      objectId: string | null;
      shop: import("@types").GameShop | null;
      iconUrl: string | null;
      coverImageUrl: string | null;
      libraryHeroImageUrl: string | null;
      logoImageUrl: string | null;
      libraryImageUrl: string | null;
    }>;
    /* Emulators / Classics */
    getEmulatorConfigs: () => Promise<EmulatorConfigMap>;
    detectEmulator: (system: EmulatorSystem) => Promise<EmulatorConfig>;
    detectEmulators: () => Promise<EmulatorConfigMap>;
    previewEmulatorExecutable: (
      system: EmulatorSystem,
      executablePath?: string
    ) => Promise<{
      executablePath: string;
      detectedVersion: string | null;
    } | null>;
    setEmulatorExecutablePath: (
      system: EmulatorSystem,
      executablePath: string | null
    ) => Promise<EmulatorConfig>;
    removeEmulator: (system: EmulatorSystem) => Promise<EmulatorConfig>;
    checkEmulatorExecutable: (
      system: EmulatorSystem
    ) => Promise<{ exists: boolean }>;
    getEmulatorRomExtensions: (system: EmulatorSystem) => Promise<string[]>;
    getEmulatorRomFilters: (systemOrPlatform: string) => Promise<{
      extensions: string[];
      folderBased: boolean;
    }>;
    addRomFolder: (
      system: EmulatorSystem,
      folderPath: string,
      scanSubfolders: boolean
    ) => Promise<EmulatorConfig>;
    removeRomFolder: (
      system: EmulatorSystem,
      folderId: string
    ) => Promise<EmulatorConfig>;
    toggleRomFolderSubfolders: (
      system: EmulatorSystem,
      folderId: string,
      scanSubfolders: boolean
    ) => Promise<EmulatorConfig>;
    rescanEmulator: (system: EmulatorSystem) => Promise<EmulatorConfig>;
    listEmulatorRoms: (system: EmulatorSystem) => Promise<DetectedRom[]>;
    openClassicsGame: (
      shop: GameShop,
      objectId: string,
      discPath?: string,
      force?: boolean
    ) => Promise<void>;
    updateClassicsDisc: (
      shop: GameShop,
      objectId: string,
      disc: ClassicsDiscUpdate
    ) => Promise<Game | null>;
    getClassicsImportStatus: () => Promise<boolean>;
    getActiveClassicsImport: () => Promise<{
      requestId: string;
      system: EmulatorSystem;
      phase: "scanning" | "matching" | "done";
      processed: number;
      total: number;
      percent: number;
      currentFile: string | null;
      status: "matched" | "wrong_platform" | "unmatched" | null;
      discovered: number;
      matched: number;
      sizeBytes: number;
    } | null>;
    onClassicsImportProgress: (
      cb: (
        payload:
          | {
              type: "progress";
              requestId: string;
              system: EmulatorSystem;
              phase: "scanning" | "matching";
              processed: number;
              total: number;
              percent: number;
              currentFile: string | null;
              status: "matched" | "wrong_platform" | "unmatched" | null;
              discovered: number;
              matched: number;
              sizeBytes: number;
            }
          | {
              type: "done" | "cancelled";
              requestId: string;
              system: EmulatorSystem;
              fileCount: number;
              sizeBytes: number;
              matched: number;
              unmatched: number;
              unmatchedFiles: {
                name: string;
                reason: "wrong_platform" | "unmatched";
              }[];
            }
          | {
              type: "error";
              requestId: string;
              system: EmulatorSystem;
              message: string;
            }
      ) => void
    ) => () => Electron.IpcRenderer;
    checkEmulatorBios: (
      system: EmulatorSystem,
      executablePath: string | null
    ) => Promise<{ installed: boolean }>;
    downloadEmulatorBios: (
      system: EmulatorSystem
    ) => Promise<{ ok: boolean; error?: string }>;
    onBiosDownloadProgress: (
      cb: (payload: {
        system: EmulatorSystem;
        stage: "downloading" | "extracting" | "installing";
        progress: number;
      }) => void
    ) => () => void;
    checkPs3Firmware: (
      executablePath: string | null
    ) => Promise<{ installed: boolean }>;
    getEmulatorInstallOptions: (
      binary: EmulatorBinary
    ) => Promise<ResolvedInstallOption[]>;
    installEmulator: (
      binary: EmulatorBinary,
      optionId: string
    ) => Promise<EmulatorInstallResult>;
    isEmulatorReady: (shop: GameShop, objectId: string) => Promise<boolean>;
    getEmulatorSettings: (system: EmulatorSystem) => Promise<{
      defs: {
        key: string;
        label: string;
        type: "enum" | "toggle";
        options?: { value: string; label: string }[];
        group: string;
        hint?: string;
      }[];
      values: { key: string; value: string }[];
    }>;
    setEmulatorSettings: (
      system: EmulatorSystem,
      values: { key: string; value: string }[]
    ) => Promise<boolean>;
    listCemuGraphicPacks: (
      shop?: string | null,
      objectId?: string | null,
      showAll?: boolean
    ) => Promise<{
      hasLibrary: boolean;
      packs: CemuGraphicPack[];
      titleId: string | null;
      scoped: boolean;
    }>;
    downloadCemuGraphicPacks: () => Promise<{
      ok: boolean;
      count: number;
      reason?: string;
    }>;
    setCemuGraphicPackEnabled: (
      id: string,
      enabled: boolean
    ) => Promise<boolean>;
    setCemuGraphicPackPreset: (
      id: string,
      category: string,
      preset: string
    ) => Promise<boolean>;
    getModStatus: (shop: string, objectId: string) => Promise<ModManagerStatus>;
    installUkmm: () => Promise<{ ok: boolean; reason?: string }>;
    setModsEnabled: (
      shop: string,
      objectId: string,
      enabled: boolean
    ) => Promise<{ ok: boolean }>;
    browseGameBananaMods: (opts: {
      page?: number;
      sort?: "newest" | "updated" | "likes" | "downloads";
      categoryId?: number | null;
      search?: string;
    }) => Promise<GameBananaMod[]>;
    listModCategories: () => Promise<{ id: number; name: string }[]>;
    getGameBananaMod: (modId: number) => Promise<GameBananaModDetail | null>;
    installMod: (
      shop: string,
      objectId: string,
      modId: number,
      fileId?: number
    ) => Promise<ModInstallPrep>;
    finalizeModInstall: (
      shop: string,
      objectId: string,
      stagingId: string,
      selectedFolders: string[]
    ) => Promise<{ ok: boolean; reason?: string }>;
    cancelModInstall: (stagingId: string) => Promise<void>;
    installModFromBcmlUri: (
      shop: string,
      objectId: string,
      uri: string
    ) => Promise<ModInstallPrep>;
    uninstallMod: (
      shop: string,
      objectId: string,
      index: number
    ) => Promise<{ ok: boolean; reason?: string }>;
    resetMods: (
      shop: string,
      objectId: string
    ) => Promise<{ ok: boolean; reason?: string }>;
    onModInstallProgress: (cb: (phase: string) => void) => () => void;
    exportModpack: (
      shop: string,
      objectId: string
    ) => Promise<{ ok: boolean; reason?: string; canceled?: boolean }>;
    importModpack: (
      shop: string,
      objectId: string
    ) => Promise<{ ok: boolean; reason?: string; canceled?: boolean }>;
    getControllerProfile: (binary?: EmulatorBinary) => Promise<{
      profile: ControllerProfile;
      isCustom: boolean;
      type: EmulatedControllerType | null;
    }>;
    saveControllerProfile: (
      profile: ControllerProfile,
      binary?: EmulatorBinary,
      type?: EmulatedControllerType
    ) => Promise<{ applied: { binary: string; ok: boolean }[] }>;
    onEmulatorInstallProgress: (
      cb: (payload: EmulatorInstallProgress) => void
    ) => () => void;
    startRomScan: (
      system: EmulatorSystem,
      folderPath: string,
      scanSubfolders: boolean
    ) => Promise<{ requestId: string }>;
    cancelRomScan: (requestId: string) => Promise<void>;
    getEmulatorRomPaths: (system: EmulatorSystem) => Promise<string[]>;
    addEmulatorRomPath: (
      system: EmulatorSystem,
      folderPath: string
    ) => Promise<boolean>;
    getRpcs3DefaultSources: () => Promise<{
      gamesDir: string | null;
      gamesYmlPath: string | null;
      gamesYmlEntries: { titleId: string; path: string }[];
    }>;
    onRomScanProgress: (
      requestId: string,
      cb: (
        payload:
          | {
              type: "progress";
              processed: number;
              total: number;
              currentFile: string | null;
            }
          | { type: "done"; fileCount: number; sizeBytes: number }
          | { type: "cancelled"; fileCount: number; sizeBytes: number }
          | { type: "error"; message: string }
      ) => void
    ) => () => Electron.IpcRenderer;
    importLaunchboxRoms: (
      system: EmulatorSystem,
      folders: { path: string; scanSubfolders: boolean }[],
      language: string
    ) => Promise<{ requestId: string }>;
    cancelLaunchboxImport: (requestId: string) => Promise<void>;
    scanPs2Memcards: (
      input: Ps2MemcardScanInput
    ) => Promise<{ requestId: string }>;
    cancelPs2MemcardScan: (requestId: string) => Promise<void>;
    onPs2MemcardScanProgress: (
      requestId: string,
      cb: (payload: Ps2MemcardScanProgress) => void
    ) => () => Electron.IpcRenderer;
    listPs2MemcardSaves: () => Promise<Ps2MemoryCardSaveRecord[]>;
    forgetPs2MemcardSave: (
      cardFilePath: string,
      folderName: string
    ) => Promise<void>;
    forgetPs2MemcardCard: (cardFilePath: string) => Promise<void>;
    exportPs2Save: (
      cardFilePath: string,
      folderName: string,
      suggestedName: string
    ) => Promise<Ps2ExportResult>;
    scanPs1Memcards: (
      input: Ps2MemcardScanInput
    ) => Promise<{ requestId: string }>;
    cancelPs1MemcardScan: (requestId: string) => Promise<void>;
    onPs1MemcardScanProgress: (
      requestId: string,
      cb: (payload: Ps2MemcardScanProgress) => void
    ) => () => Electron.IpcRenderer;
    listPs1MemcardSaves: () => Promise<Ps2MemoryCardSaveRecord[]>;
    forgetPs1MemcardSave: (
      cardFilePath: string,
      identifier: string
    ) => Promise<void>;
    forgetPs1MemcardCard: (cardFilePath: string) => Promise<void>;
    exportPs1Save: (
      cardFilePath: string,
      identifier: string,
      suggestedName: string
    ) => Promise<Ps2ExportResult>;
    uploadEmulationSave: (
      platform: EmulationSavePlatform,
      cardFilePath: string,
      folderName: string
    ) => Promise<EmulationCloudSave>;
    uploadEmulationSavesForCard: (
      platform: EmulationSavePlatform,
      cardFilePath: string
    ) => Promise<{ uploaded: number; total: number }>;
    onEmulationBackupProgress: (
      cb: (payload: EmulationBackupProgress) => void
    ) => () => Electron.IpcRenderer;
    getActiveEmulationBackups: () => Promise<EmulationBackupProgress[]>;
    listEmulationSaves: (
      platform: EmulationSavePlatform,
      objectId?: string | null
    ) => Promise<EmulationCloudSave[]>;
    getMemcardRestoreTargets: (
      platform: EmulationSavePlatform
    ) => Promise<MemcardRestoreTarget[]>;
    inspectMemcard: (
      platform: EmulationSavePlatform,
      cardFilePath: string
    ) => Promise<MemcardFormatState>;
    restoreEmulationSave: (
      platform: EmulationSavePlatform,
      saveId: string,
      targetCardFilePath: string
    ) => Promise<MemcardRestoreResult>;
    deleteEmulationSave: (saveId: string) => Promise<void>;
    updateEmulationSaveLabel: (
      saveId: string,
      label: string
    ) => Promise<EmulationCloudSave>;
    getMinervaDownloadOptions: (
      system: EmulatorSystem,
      title: string
    ) => Promise<import("@types").GameRepack[]>;
    buildMinervaCatalogue: (
      system?: EmulatorSystem
    ) => Promise<Partial<Record<EmulatorSystem, number>> | number>;
    searchMinervaCatalogue: (
      title: string,
      system?: EmulatorSystem
    ) => Promise<import("@types").GameRepack[]>;
    getConsoleHowLongToBeat: (
      title: string,
      system?: import("@types").EmulatorSystem | ""
    ) => Promise<import("@types").HowLongToBeatCategory[] | null>;
    getConsoleGameMetadata: (
      title: string,
      objectId: string
    ) => Promise<import("@types").ConsoleGameMetadata | null>;
    getOverlayContext: () => Promise<
      import("@types").HydraOverlayContext | null
    >;
    overlayRendererReady: () => Promise<void>;
    closeHydraOverlay: () => Promise<void>;
    setOverlayPerformancePinned: (pinned: boolean) => Promise<void>;
    getOverlayNote: () => Promise<string>;
    saveOverlayNote: (note: string) => Promise<void>;
    onOverlayPerformance: (
      cb: (value: import("@types").HydraOverlayPerformance) => void
    ) => () => void;
    onOverlayMode: (cb: (mode: string) => void) => () => void;
    onOverlayShown: (cb: () => void) => () => void;
    onOverlayPerformancePin: (cb: (pinned: boolean) => void) => () => void;
    onOverlayGamepadAction: (
      cb: (action: import("@types").HydraOverlayGamepadAction) => void
    ) => () => void;
    getActiveGameProcessState: () => Promise<
      import("@types").GameProcessControlState
    >;
    pauseActiveGame: () => Promise<import("@types").GameProcessControlState>;
    resumeActiveGame: () => Promise<import("@types").GameProcessControlState>;
    closeActiveGame: () => Promise<import("@types").GameProcessControlState>;
    onGameProcessControlState: (
      cb: (state: import("@types").GameProcessControlState) => void
    ) => () => void;
    gameRecorderGetPreferences: () => Promise<
      import("@types").GameRecorderState
    >;
    gameRecorderGetState: () => Promise<import("@types").GameRecorderState>;
    gameRecorderStart: () => Promise<import("@types").GameRecorderState>;
    gameRecorderStop: () => Promise<import("@types").GameRecorderSaveResult>;
    gameRecorderSaveReplay: () => Promise<
      import("@types").GameRecorderSaveResult
    >;
    gameRecorderOpenOutputDirectory: () => Promise<void>;
    onGameRecorderState: (
      cb: (state: import("@types").GameRecorderState) => void
    ) => () => void;
    onGameRecorderCaptureCommand: (
      cb: (command: import("@types").GameRecorderCaptureCommand) => void
    ) => () => void;
    gameRecorderCommitSegment: (
      metadata: import("@types").GameRecorderSegmentMetadata,
      payload: ArrayBuffer
    ) => Promise<void>;
    gameRecorderCommitPcmChunk: (
      metadata: import("@types").GameRecorderPcmChunkMetadata,
      payload: ArrayBuffer
    ) => Promise<void>;
    gameRecorderCaptureError: (message: string) => Promise<void>;
    gameRecorderCaptureReady: () => Promise<void>;
    spotifyGetStatus: () => Promise<import("@types").SpotifyStatus>;
    spotifyLogin: () => Promise<import("@types").SpotifyStatus>;
    spotifyLogout: () => Promise<import("@types").SpotifyStatus>;
    spotifyGetNowPlaying: () => Promise<
      import("@types").SpotifyNowPlaying | null
    >;
    spotifyGetPlayback: () => Promise<
      import("@types").SpotifyResult<
        import("@types").SpotifyPlaybackState | null
      >
    >;
    spotifyGetDevices: () => Promise<
      import("@types").SpotifyResult<import("@types").SpotifyDevice[]>
    >;
    spotifyGetQueue: () => Promise<
      import("@types").SpotifyResult<import("@types").SpotifyQueue>
    >;
    spotifyGetHome: () => Promise<
      import("@types").SpotifyResult<import("@types").SpotifyHome>
    >;
    spotifySearch: (
      query: string
    ) => Promise<
      import("@types").SpotifyResult<import("@types").SpotifySearchResults>
    >;
    spotifyGetPlaylistItems: (
      playlistId: string,
      offset?: number
    ) => Promise<
      import("@types").SpotifyResult<
        import("@types").SpotifyPage<import("@types").SpotifyContentItem>
      >
    >;
    spotifyPlaybackCommand: (
      command: import("@types").SpotifyPlaybackCommand
    ) => Promise<import("@types").SpotifyResult<true>>;
    spotifySetSaved: (
      uri: string,
      saved: boolean
    ) => Promise<import("@types").SpotifyResult<true>>;
    spotifyLibraryContains: (
      uris: string[]
    ) => Promise<import("@types").SpotifyResult<Record<string, boolean>>>;
    spotifyOpenSettings: () => Promise<void>;
    spotifyControl: (
      action: import("@types").SpotifyControlAction
    ) => Promise<boolean>;
    getPinnedApps: () => Promise<import("@types").PinnedApp[]>;
    pickPinnedApp: () => Promise<import("@types").PinnedApp[]>;
    removePinnedApp: (appPath: string) => Promise<import("@types").PinnedApp[]>;
    launchPinnedApp: (appPath: string) => Promise<string>;
    getAudioSessions: () => Promise<import("@types").AudioSession[]>;
    setAudioSessionVolume: (pid: number, volume: number) => Promise<boolean>;
    setAudioSessionMute: (pid: number, muted: boolean) => Promise<boolean>;
    downloadSwitchKeys: () => Promise<{
      keys: boolean;
      firmware: boolean;
      error?: string;
    }>;
    searchMinervaGames: (
      query: string,
      limit?: number
    ) => Promise<
      Array<{
        title: string;
        system: EmulatorSystem;
        objectId: string;
        iconUrl: string | null;
      }>
    >;
    searchClassicsCatalogue: (
      query: string,
      limit?: number,
      system?: import("@types").EmulatorSystem
    ) => Promise<import("@types").CatalogueSearchResult[]>;
    searchCatalogueGames: (
      query: string,
      limit?: number
    ) => Promise<import("@types").CatalogueSearchSuggestion[]>;
    getRandomClassics: (
      limit?: number
    ) => Promise<import("@types").CatalogueSearchResult[]>;
    showOpenDialog: (
      options: Electron.OpenDialogOptions
    ) => Promise<Electron.OpenDialogReturnValue>;
    readDirectory: (path: string) => Promise<FileExplorerEntry[]>;
    getPathInfo: (path: string) => Promise<FileExplorerPathInfo>;
    listDrives: () => Promise<string[]>;
    showItemInFolder: (path: string) => Promise<void>;
    getImageDataUrl: (imageUrl: string) => Promise<string | null>;
    hydraApi: {
      get: <T = unknown>(
        url: string,
        options?: {
          params?: unknown;
          needsAuth?: boolean;
          needsSubscription?: boolean;
          ifModifiedSince?: Date;
        }
      ) => Promise<T>;
      post: <T = unknown>(
        url: string,
        options?: {
          data?: unknown;
          needsAuth?: boolean;
          needsSubscription?: boolean;
        }
      ) => Promise<T>;
      put: <T = unknown>(
        url: string,
        options?: {
          data?: unknown;
          needsAuth?: boolean;
          needsSubscription?: boolean;
        }
      ) => Promise<T>;
      patch: <T = unknown>(
        url: string,
        options?: {
          data?: unknown;
          needsAuth?: boolean;
          needsSubscription?: boolean;
        }
      ) => Promise<T>;
      delete: <T = unknown>(
        url: string,
        options?: {
          needsAuth?: boolean;
          needsSubscription?: boolean;
        }
      ) => Promise<T>;
    };
    canInstallCommonRedist: () => Promise<boolean>;
    installCommonRedist: () => Promise<void>;
    installHydraDeckyPlugin: () => Promise<{
      success: boolean;
      path: string;
      currentVersion: string | null;
      expectedVersion: string;
      error?: string;
    }>;
    getHydraDeckyPluginInfo: () => Promise<{
      installed: boolean;
      version: string | null;
      path: string;
      outdated: boolean;
      expectedVersion: string | null;
    }>;
    checkHomebrewFolderExists: () => Promise<boolean>;
    onCommonRedistProgress: (
      cb: (value: { log: string; complete: boolean }) => void
    ) => () => Electron.IpcRenderer;
    onPreflightProgress: (
      cb: (value: { status: string; detail: string | null }) => void
    ) => () => Electron.IpcRenderer;
    onLegendaryProcessLog: (
      cb: (value: { objectId: string; line: string; isError: boolean }) => void
    ) => () => Electron.IpcRenderer;
    onGogdlProcessLog: (
      cb: (value: { objectId: string; line: string; isError: boolean }) => void
    ) => () => Electron.IpcRenderer;
    onMetadataProgress: (
      cb: (value: {
        current: number;
        total: number;
        title: string | null;
        done?: boolean;
      }) => void
    ) => () => Electron.IpcRenderer;
    onDedupProgress: (
      cb: (value: {
        current: number;
        total: number;
        title: string | null;
        done?: boolean;
      }) => void
    ) => () => Electron.IpcRenderer;
    resetCommonRedistPreflight: () => Promise<void>;
    saveTempFile: (fileName: string, fileData: Uint8Array) => Promise<string>;
    deleteTempFile: (filePath: string) => Promise<void>;
    platform: NodeJS.Platform;

    /* Auto update */
    onAutoUpdaterEvent: (
      cb: (event: AppUpdaterEvent) => void
    ) => () => Electron.IpcRenderer;
    checkForUpdates: () => Promise<boolean>;
    restartAndInstallUpdate: () => Promise<void>;
    updateCheckerProceed: () => Promise<void>;
    updateCheckerReady: () => Promise<void>;
    updateCheckerApply: () => Promise<void>;
    toggleConsoleWindow: () => Promise<void>;
    onUpdateCheckerEvent: (
      cb: (event: UpdateCheckerEvent) => void
    ) => () => void;

    /* Auth */
    getAuth: () => Promise<Auth | null>;
    signOut: () => Promise<void>;
    openAuthWindow: (page: AuthPage) => Promise<void>;
    getSessionHash: () => Promise<string | null>;
    onSignIn: (cb: () => void) => () => Electron.IpcRenderer;
    onAccountUpdated: (cb: () => void) => () => Electron.IpcRenderer;
    onSignOut: (cb: () => void) => () => Electron.IpcRenderer;

    /* User */
    getComparedUnlockedAchievements: (
      objectId: string,
      shop: GameShop,
      userId: string
    ) => Promise<ComparedAchievements>;
    getUnlockedAchievements: (
      objectId: string,
      shop: GameShop
    ) => Promise<UserAchievement[]>;
    loadRetroAchievementsList: (
      shop: GameShop,
      objectId: string,
      system: EmulatorSystem,
      title: string
    ) => Promise<UserAchievement[]>;
    loginRetroAchievements: (
      username: string,
      password: string
    ) => Promise<{ success: boolean; token?: string; error?: string }>;
    syncRalibretroLogin: () => Promise<boolean>;
    getAchievementSouvenirs: (
      ownerId: string
    ) => Promise<ProfileAchievementSouvenir[]>;
    deleteAchievementSouvenir: (
      request: DeleteAchievementSouvenirRequest
    ) => Promise<void>;
    openAchievementSouvenirsFolder: () => Promise<void>;

    /* Profile */
    getMe: () => Promise<UserDetails | null>;
    getProfileImages: (userId: string) => Promise<{
      profileImageUrl: string | null;
      backgroundImageUrl: string | null;
    }>;
    updateProfile: (
      updateProfile: UpdateProfileRequest
    ) => Promise<UserProfile>;
    updateProfile: (updateProfile: UpdateProfileProps) => Promise<UserProfile>;
    getProfileImageMetadata: (
      path: string
    ) => Promise<{ mimeType: string | null; isAnimated: boolean }>;
    processProfileImage: (
      path: string
    ) => Promise<{ imagePath: string; mimeType: string }>;
    cropProfileImage: (
      path: string,
      params: {
        left: number;
        top: number;
        width: number;
        height: number;
        outputWidth: number;
        outputHeight: number;
        rotation?: number;
      }
    ) => Promise<{ imagePath: string }>;
    onSyncFriendRequests: (
      cb: (friendRequests: FriendRequestSync) => void
    ) => () => Electron.IpcRenderer;
    onSyncNotificationCount: (
      cb: (notification: NotificationSync) => void
    ) => () => Electron.IpcRenderer;
    updateFriendRequest: (
      userId: string,
      action: FriendRequestAction
    ) => Promise<void>;

    /* Notifications */
    publishNewRepacksNotification: (newRepacksCount: number) => Promise<void>;
    getLocalNotifications: () => Promise<LocalNotification[]>;
    getLocalNotificationsCount: () => Promise<number>;
    markLocalNotificationRead: (id: string) => Promise<void>;
    markAllLocalNotificationsRead: () => Promise<void>;
    deleteLocalNotification: (id: string) => Promise<void>;
    clearAllLocalNotifications: () => Promise<void>;
    onLocalNotificationCreated: (
      cb: (notification: LocalNotification) => void
    ) => () => Electron.IpcRenderer;
    onAchievementUnlocked: (
      cb: (
        position?: AchievementCustomNotificationPosition,
        achievements?: AchievementNotificationInfo[]
      ) => void
    ) => () => Electron.IpcRenderer;
    onInAppAchievementUnlocked: (
      cb: (
        position: AchievementCustomNotificationPosition,
        achievements: AchievementNotificationInfo[]
      ) => void
    ) => () => Electron.IpcRenderer;
    onCombinedAchievementsUnlocked: (
      cb: (
        gameCount: number,
        achievementCount: number,
        position: AchievementCustomNotificationPosition
      ) => void
    ) => () => Electron.IpcRenderer;
    achievementNotificationRendererReady: () => void;
    updateAchievementCustomNotificationWindow: () => Promise<void>;
    hideAchievementCustomNotificationWindow: () => Promise<void>;
    showAchievementTestNotification: () => Promise<void>;

    /* Themes */
    addCustomTheme: (theme: Theme) => Promise<void>;
    getAllCustomThemes: () => Promise<Theme[]>;
    deleteAllCustomThemes: () => Promise<void>;
    deleteCustomTheme: (themeId: string) => Promise<void>;
    updateCustomTheme: (themeId: string, code: string) => Promise<void>;
    getCustomThemeById: (themeId: string) => Promise<Theme | null>;
    getActiveCustomTheme: () => Promise<Theme | null>;
    toggleCustomTheme: (themeId: string, isActive: boolean) => Promise<void>;
    copyThemeAchievementSound: (
      themeId: string,
      sourcePath: string
    ) => Promise<void>;
    removeThemeAchievementSound: (themeId: string) => Promise<void>;
    getThemeSoundPath: (themeId: string) => Promise<string | null>;
    getThemeSoundDataUrl: (themeId: string) => Promise<string | null>;
    importThemeSoundFromStore: (
      themeId: string,
      themeName: string,
      storeUrl: string
    ) => Promise<void>;

    /* Editor */
    openEditorWindow: (themeId: string) => Promise<void>;
    onCustomThemeUpdated: (cb: () => void) => () => Electron.IpcRenderer;
    closeEditorWindow: (themeId?: string) => Promise<void>;

    /* Game Launcher Window */
    showGameLauncherWindow: () => Promise<void>;
    closeGameLauncherWindow: () => Promise<void>;
    openMainWindow: () => Promise<void>;
    isMainWindowOpen: () => Promise<boolean>;
    setWindowSize: (
      width: number,
      height: number,
      minWidth?: number,
      minHeight?: number
    ) => Promise<void>;
    getHardwareInfo: () => Promise<{
      cpu: string;
      gpu: string;
      ramMB: number;
      diskFreeGB: number;
    }>;

    /* Big Picture Window */
    openBigPictureWindow: () => Promise<void>;

    /* Download Options */
    onNewDownloadOptions: (
      cb: (gamesWithNewOptions: { gameId: string; count: number }[]) => void
    ) => () => Electron.IpcRenderer;

    /* LevelDB Generic CRUD */
    leveldb: {
      get: (
        key: string,
        sublevelName?: string | null,
        valueEncoding?: "json" | "utf8"
      ) => Promise<unknown>;
      put: (
        key: string,
        value: unknown,
        sublevelName?: string | null,
        valueEncoding?: "json" | "utf8"
      ) => Promise<void>;
      del: (key: string, sublevelName?: string | null) => Promise<void>;
      clear: (sublevelName: string) => Promise<void>;
      values: (sublevelName: string) => Promise<unknown[]>;
      iterator: (sublevelName: string) => Promise<[string, unknown][]>;
    };

    /* Transfer Game */
    getAvailableDrives: () => Promise<DriveInfo[]>;
    transferGameFiles: (
      shop: GameShop,
      objectId: string,
      destParent: string
    ) => Promise<{
      ok: boolean;
      error?: string;
      needed?: number;
      available?: number;
      newExePath?: string;
    }>;

    // Cancel for game transfers
    cancelGameTransfer: (shop: GameShop, objectId: string) => Promise<void>;

    startSteamOpenIdLogin: () => Promise<string>;
    openSteamLoginWindow: () => Promise<{ steamId: string } | null>;
    downloadViaLegendary: (
      objectId: string,
      downloadPath?: string
    ) => Promise<{ ok: boolean }>;
    cancelLegendaryDownload: (objectId: string) => Promise<{ ok: boolean }>;
    downloadViaGogdl: (
      objectId: string,
      downloadPath?: string
    ) => Promise<{ ok: boolean }>;
    cancelGogdlDownload: (objectId: string) => Promise<{ ok: boolean }>;
    installGogdl: () => Promise<{ path: string }>;
    onGogdlInstallProgress: (cb: (pct: number) => void) => () => void;

    /* Event listeners for transfer progress */
    on: (channel: string, listener: (...args: any[]) => void) => void;
    off: (channel: string, listener: (...args: any[]) => void) => void;

    /* Installer */
    installerGetDefaults: () => Promise<{
      defaultInstallDir: string;
      exeDir: string;
    }>;
    installerBrowseDirectory: (defaultPath: string) => Promise<string | null>;
    installerRunSetup: (
      mode: "install" | "portable",
      destDir?: string
    ) => Promise<void>;
    installerRelaunch: (destDir: string) => Promise<void>;
    installerOpenFolder: (destDir: string) => Promise<void>;
    installerCloseAndLaunch: () => Promise<void>;
    onInstallerProgress: (
      cb: (pct: number, file: string) => void
    ) => () => void;
    openConsoleWindow: () => Promise<void>;
    getConsoleLogSnapshot: (
      afterId?: number
    ) => Promise<import("@shared").ConsoleLogSnapshot>;
    clearConsoleLogs: () => Promise<import("@shared").ConsoleLogSnapshot>;
    exportConsoleLogs: () => Promise<{
      canceled: boolean;
      path: string | null;
    }>;
    onConsoleLogs: (
      cb: (entries: import("@shared").ConsoleLogEntry[]) => void
    ) => () => void;
    /* Main window controls (Linux) */
    minimizeMainWindow: () => Promise<void>;
    toggleMaximizeMainWindow: () => Promise<void>;
    closeMainWindow: () => Promise<void>;
    minimizeAuthWindow: () => Promise<void>;
    closeAuthWindow: () => Promise<void>;
    isMainWindowMaximized: () => Promise<boolean>;
    onWindowMaximizeChange: (cb: (isMaximized: boolean) => void) => () => void;
    isWayland: boolean;

    /* Friends window */
    openFriendsWindow: () => Promise<void>;
    minimizeFriendsWindow: () => Promise<void>;
    closeFriendsWindow: () => Promise<void>;
    openFriendProfileInMainWindow: (userId: string) => Promise<void>;
    openAddFriendModalInMainWindow: () => Promise<void>;
    onOpenAddFriendModal: (cb: () => void) => () => void;
    onFriendsUpdated: (cb: () => void) => () => void;
    onFriendPresence: (
      cb: (presence: import("@types").FriendPresenceSync) => void
    ) => () => void;
    onProfileUpdated: (cb: () => void) => () => void;
    onNavigate: (cb: (path: string) => void) => () => void;
    getProcessedFriendImage: (
      imageUrl: string | null,
      options: { width: number; height: number; preserveAnimation?: boolean }
    ) => Promise<string | null>;

    /* Shared music player (launcher + overlay, Deezer + yt-dlp) */
    musicSearch: (query: string) => Promise<import("@types").MusicTrack[]>;
    musicGetState: () => Promise<import("@types").MusicPlayerState>;
    onMusicState: (
      cb: (state: import("@types").MusicPlayerState) => void
    ) => () => void;
    musicSetQueue: (
      tracks: import("@types").MusicTrack[],
      startIndex?: number
    ) => Promise<void>;
    musicAddToQueue: (track: import("@types").MusicTrack) => Promise<void>;
    musicRemoveFromQueue: (index: number) => Promise<void>;
    musicClearQueue: () => Promise<void>;
    musicPlay: (index?: number) => Promise<import("@types").MusicTrack | null>;
    musicPause: () => Promise<void>;
    musicResume: () => Promise<import("@types").MusicTrack | null>;
    musicRefreshCurrent: () => Promise<import("@types").MusicTrack | null>;
    musicStop: () => Promise<void>;
    musicNext: () => Promise<import("@types").MusicTrack | null>;
    musicPrevious: () => Promise<import("@types").MusicTrack | null>;
    musicSetShuffle: (enabled: boolean) => Promise<void>;
    musicSetRepeat: (mode: import("@types").RepeatMode) => Promise<void>;
    musicSetVolume: (volume: number, muted?: boolean) => Promise<void>;
    musicSeek: (progressMs: number) => Promise<void>;
    musicReportPlaybackProgress: (
      progressMs: number,
      durationMs: number
    ) => Promise<void>;
    musicGetPlaylists: () => Promise<import("@types").MusicPlaylist[]>;
    musicCreatePlaylist: (
      name: string
    ) => Promise<import("@types").MusicPlaylist>;
    musicDeletePlaylist: (id: string) => Promise<void>;
    musicRenamePlaylist: (id: string, name: string) => Promise<void>;
    musicAddToPlaylist: (
      playlistId: string,
      track: import("@types").MusicTrack
    ) => Promise<void>;
    musicRemoveFromPlaylist: (
      playlistId: string,
      trackIndex: number
    ) => Promise<void>;
    musicPlayPlaylist: (
      playlistId: string,
      startIndex?: number
    ) => Promise<import("@types").MusicTrack | null>;
  }

  interface Window {
    electron: Electron;
  }
}
