import type { Downloader } from "@shared";
import type {
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
  updatedAt: number | undefined;
  language: string | undefined;
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
  eaTokenExpiry?: string | null;
  eaUsername?: string | null;
  eaPid?: string | null;
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
