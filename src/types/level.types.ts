import type { Downloader } from "@shared";
import type {
  AchievementProgress,
  GameShop,
  SteamAchievement,
  UnlockedAchievement,
} from "./game.types";
import type { DownloadStatus } from "./download.types";

export type SubscriptionStatus = "active" | "pending" | "cancelled";

export interface Subscription {
  id: string;
  status: SubscriptionStatus;
  plan: { id: string; name: string };
  expiresAt: string | null;
  paymentMethod: "pix" | "paypal";
}

export interface Auth {
  accessToken: string;
  refreshToken: string;
  tokenExpirationTimestamp: number;
  workwondersJwt: string;
}

export interface User {
  id: string;
  displayName: string;
  profileImageUrl: string | null;
  backgroundImageUrl: string | null;
  subscription: Subscription | null;
}

export interface Game {
  title: string;
  iconUrl: string | null;
  libraryHeroImageUrl: string | null;
  logoImageUrl: string | null;
  customIconUrl?: string | null;
  customLogoImageUrl?: string | null;
  customHeroImageUrl?: string | null;
  originalIconPath?: string | null;
  originalLogoPath?: string | null;
  originalHeroPath?: string | null;
  customOriginalIconPath?: string | null;
  customOriginalLogoPath?: string | null;
  customOriginalHeroPath?: string | null;
  playTimeInMilliseconds: number;
  unsyncedDeltaPlayTimeInMilliseconds?: number;
  lastTimePlayed: Date | null;
  addedToLibraryAt?: Date | null;
  objectId: string;
  shop: GameShop;
  remoteId: string | null;
  collectionIds?: string[];
  isDeleted: boolean;
  winePrefixPath?: string | null;
  protonPath?: string | null;
  executablePath?: string | null;
  /** True when the game is confirmed installed on this machine (Steam appmanifest
   * found, Epic/EA reported installed, or located by the disk scan). Drives the
   * "Play" vs "You own this game — install via …" button. A protocol-URI
   * executablePath alone (e.g. steam://run) does NOT imply installed, because
   * Steam/Xbox sync stamp it for every owned game regardless of install state. */
  isInstalledLocally?: boolean;
  nativeExecutablePath?: string | null;
  launchOptions?: string | null;
  autoRunMangohud?: boolean | null;
  autoRunGamemode?: boolean | null;
  favorite?: boolean;
  isPinned?: boolean;
  achievementCount?: number;
  unlockedAchievementCount?: number;
  pinnedDate?: Date | null;
  automaticCloudSync?: boolean;
  /** How the game entered the library: synced from a platform account,
   * added from the Hydra API catalog, or added manually as a custom game. */
  libraryOrigin?: "sync" | "catalog" | "custom";
  lastCloudSaveAt?: Date | null;
  hasManuallyUpdatedPlaytime?: boolean;
  newDownloadOptionsCount?: number;
  installedSizeInBytes?: number | null;
  installerSizeInBytes?: number | null;
  steamShortcutAppId?: number;
  alternativeShops?: Array<{
    shop: GameShop;
    objectId: string;
    executablePath: string | null;
  }>;
  xboxTitleId?: string | null;
  experimentalAchievementsEnabled?: boolean;
  achievementEmulatorChecked?: boolean;
  platform?: string | null;
  discs?: import("./emulator.types").ClassicsDisc[];
  selectedDiscPath?: string | null;
  dontAskDiscSelection?: boolean;
  romSizeBytes?: number | null;
}

export interface Download {
  shop: GameShop;
  objectId: string;
  uri: string;
  folderName: string | null;
  downloadPath: string;
  progress: number;
  downloader: Downloader;
  bytesDownloaded: number;
  fileSize: number | null;
  shouldSeed: boolean;
  status: DownloadStatus | null;
  queued: boolean;
  pinnedToHero?: boolean;
  timestamp: number;
  extracting: boolean;
  extractionProgress?: number;
  automaticallyExtract: boolean;
  automaticallyDeleteArchiveFiles: boolean;
  fileIndices?: number[];
  selectedFilesSize?: number | null;
}

export interface DownloadLayoutState {
  version: 1;
  queueOrder: string[];
  pausedOrder: string[];
}

export interface GameAchievement {
  achievements: SteamAchievement[];
  unlockedAchievements: UnlockedAchievement[];
  /** Fractional progress for locked, stat-gated achievements, parsed from the
   *  local achievement file. Local-only (not synced to the Hydra cloud). */
  achievementProgress?: AchievementProgress[];
  updatedAt: number | undefined;
  language: string | undefined;
  /** When "exophase", both the definitions and the unlocked list were imported
   *  from Exophase and share the same apiNames — so they must be used together
   *  (never mixed with Hydra/Steam definitions, whose names wouldn't match).
   *  When absent/undefined, definitions came from HydraAPI/Steam (with images). */
  source?: "exophase";
}

export type AchievementCustomNotificationPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export interface DownloadDirectoryPreference {
  path: string;
  createdAt: string;
  source: "manual" | "auto";
}

export interface UserPreferences {
  downloadsPath?: string | null;
  downloadDirectories?: DownloadDirectoryPreference[];
  optionalDownloadsPaths?: string[];
  ggDealsApiKey?: string | null;
  language?: string;
  /** Built-in colour scheme. Defaults to "dark" when unset. */
  themeMode?: "dark" | "light" | "system";
  realDebridApiToken?: string | null;
  premiumizeApiToken?: string | null;
  allDebridApiToken?: string | null;
  torBoxApiToken?: string | null;
  preferQuitInsteadOfHiding?: boolean;
  runAtStartup?: boolean;
  startMinimized?: boolean;
  launchToLibraryPage?: boolean;
  launchInBigPicture?: boolean;
  disableNsfwAlert?: boolean;
  enableAutoInstall?: boolean;
  seedAfterDownloadComplete?: boolean;
  showHiddenAchievementsDescription?: boolean;
  showDownloadSpeedInMegabits?: boolean;
  downloadNotificationsEnabled?: boolean;
  repackUpdatesNotificationsEnabled?: boolean;
  achievementNotificationsEnabled?: boolean;
  achievementCustomNotificationsEnabled?: boolean;
  achievementCustomNotificationPosition?: AchievementCustomNotificationPosition;
  achievementSoundVolume?: number;
  friendRequestNotificationsEnabled?: boolean;
  friendStartGameNotificationsEnabled?: boolean;
  showDownloadSpeedInMegabytes?: boolean;
  extractFilesByDefault?: boolean;
  deleteArchiveFilesAfterExtractionByDefault?: boolean;
  enableSteamAchievements?: boolean;
  autoplayGameTrailers?: boolean;
  hideToTrayOnGameStart?: boolean;
  enableNewDownloadOptionsBadges?: boolean;
  createStartMenuShortcut?: boolean;
  maxDownloadSpeedBytesPerSecond?: number | null;
  defaultProtonPath?: string | null;
  autoRunMangohud?: boolean;
  autoRunGamemode?: boolean;
  steamId?: string | null;
  steamApiKey?: string | null;
  // Cached profile info so the UI can render connected state instantly
  // without waiting for network lookups
  steamUsername?: string | null;
  steamAvatarUrl?: string | null;
  legendaryBinaryPath?: string | null;
  epicAccountName?: string | null;
  gogRefreshToken?: string | null;
  gogUsername?: string | null;
  xboxAccessToken?: string | null;
  xboxUserHash?: string | null;
  xboxXstsToken?: string | null;
  xboxTokenExpiry?: string | null;
  xboxGamertag?: string | null;
  xboxHasGamePass?: boolean | null;
  uploadcarePublicKey?: string | null;
  uploadcareSecretKey?: string | null;
  xboxXuid?: string | null;
  cloudSyncUserId?: string | null;
  onboardingComplete?: boolean;
  localProfileImageUrl?: string | null;
  localBackgroundImageUrl?: string | null;
  excludedGames?: ExcludedGame[];
  ubisoftTicket?: string | null;
  ubisoftUserId?: string | null;
  ubisoftProfileId?: string | null;
  ubisoftUsername?: string | null;
  eaAccessToken?: string | null;
  eaRefreshToken?: string | null;
  eaTokenExpiry?: string | null;
  eaUsername?: string | null;
  eaPid?: string | null;
  // Exophase — the unified achievement source. `exophaseUserId` holds the
  // logged-in username (the auth cookies live in the persist:exophase session).
  exophaseEnabled?: boolean;
  exophaseUserId?: string | null;
  exophaseManagedPlatforms?: GameShop[] | null;
  // Additional PUBLIC Exophase profiles to sync alongside the logged-in account.
  // These need no login — only a public profile URL/username — and are read the
  // same way as the primary account (e.g. ["Kewz4"]).
  exophaseExtraProfiles?: string[] | null;
}

export interface ExcludedGame {
  shop: string;
  objectId: string;
  title: string;
  excludedAt: string;
}

export interface ScreenState {
  x?: number;
  y?: number;
  height: number;
  width: number;
  isMaximized: boolean;
}
