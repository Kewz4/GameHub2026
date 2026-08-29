import type { Cracker, DownloadSourceStatus, Downloader } from "@shared";
import type { SteamAppDetails } from "./steam.types";
import type { Download, Game, Subscription } from "./level.types";
import type {
  GameShop,
  SteamAchievement,
  UnlockedAchievement,
} from "./game.types";
import type { EmulatorSystem } from "./emulator.types";

export type FriendRequestAction = "ACCEPTED" | "REFUSED" | "CANCEL";
export * from "./download-contract";
export * from "./steam-emulator.types";
export * from "./library-installation.types";

export type HydraCloudFeature =
  | "achievements"
  | "backup"
  | "achievements-points";

export interface DiskUsage {
  free: number;
  total: number;
}

export interface GameRepack {
  id: string;
  title: string;
  fileSize: string | null;
  uris: string[];
  unavailableUris: string[];
  uploadDate: string | null;
  downloadSourceId: string;
  downloadSourceName: string;
  createdAt: string;
  installNotes?: string | null;
  contentType?: "game" | "update" | "dlc";
  /** Canonical region parsed from the source filename (USA/Europe/Japan/World),
   *  or null for region-free entries. Used to group/filter minerva variants. */
  region?: string | null;
  /** EmulatorSystem this repack belongs to (minerva/console games only). */
  emulatorSystem?: string | null;
  /** Exact source filename inside the (collection) torrent. Minerva magnets
   *  all point at one shared archive torrent, so the download must select
   *  exactly this file — otherwise the whole collection (or a wrong-region
   *  rom) gets downloaded. */
  fileName?: string | null;
}

export interface DownloadSource {
  id: string;
  name: string;
  url: string;
  status: DownloadSourceStatus;
  downloadCount: number;
  fingerprint?: string;
  isRemote?: true;
  createdAt: string;
}

export interface ProtonVersion {
  name: string;
  path: string;
  source?: "steam" | "compatibility_tools" | "unknown";
}

export interface ShopAssets {
  objectId: string;
  shop: GameShop;
  title: string;
  iconUrl: string | null;
  libraryHeroImageUrl: string | null;
  libraryImageUrl: string | null;
  logoImageUrl: string | null;
  logoPosition: string | null;
  coverImageUrl: string | null;
  downloadSources: string[];
  /**
   * Optional human explanation of why this game was recommended, e.g.
   * "Because you played Hades, God of War". Only set on "Recommended for you"
   * results; the home info button surfaces it.
   */
  recommendationReason?: string;
}

export type ShopDetails = SteamAppDetails & {
  objectId: string;
  platform?: string | null;
  skus?: string[];
};

export type ShopDetailsWithAssets = ShopDetails & {
  assets: ShopAssets | null;
  skus?: string[];
  platform?: string | null;
};

export interface TorrentFile {
  index: number;
  path: string;
  length: number;
}

export interface TorrentFilesResponse {
  infoHash: string;
  name: string;
  totalSize: number;
  files: TorrentFile[];
}

export type UserGame = {
  objectId: string;
  shop: GameShop;
  title: string;
  playTimeInSeconds: number;
  lastTimePlayed: Date | null;
  unlockedAchievementCount: number;
  achievementCount: number;
  achievementsPointsEarnedSum: number;
  hasManuallyUpdatedPlaytime: boolean;
  isFavorite: boolean;
  isPinned: boolean;
  pinnedDate?: Date | null;
} & ShopAssets;

export interface UserLibraryResponse {
  totalCount: number;
  library: UserGame[];
  pinnedGames: UserGame[];
}

export interface GameCollection {
  id: string;
  name: string;
  gamesCount: number;
}

export interface GameRunning {
  id: string;
  title: string;
  iconUrl: string | null;
  objectId: string;
  shop: GameShop;
  sessionDurationInMillis: number;
}

export interface Steam250Game {
  title: string;
  objectId: string;
}

export interface SteamGame {
  id: number;
  name: string;
  clientIcon: string | null;
}

export type AppUpdaterEvent =
  | { type: "update-available"; info: { version: string } }
  | { type: "update-downloaded" };

/* Events */
export interface StartGameDownloadPayload {
  objectId: string;
  title: string;
  shop: GameShop;
  uri: string;
  downloadPath: string;
  downloader: Downloader;
  automaticallyExtract: boolean;
  automaticallyDeleteArchiveFiles: boolean;
  fileSize?: string | null;
  fileIndices?: number[];
  selectedFilesSize?: number | null;
  /** Exact target file inside a collection torrent (Minerva). Used by TorBox to
   *  select the RIGHT game file by name instead of guessing by index/size. */
  targetFileName?: string | null;
  /** Other hoster mirrors for this repack that TorBox can also fetch. When
   *  downloading via TorBox we race these to pick the fastest one. */
  alternateUris?: string[];
  /** Set for minerva/console downloads so main routes them into
   *  "Emulator Games/<platform>" and binds them to the right emulator. */
  emulatorSystem?: string | null;
  /** Marks a user-supplied TorBox job created from Download Manager. */
  customDownload?: {
    sourceType: "link" | "magnet" | "torrent";
  };
  /** Overrides how the entry is stamped when created. Linked catalogue
   *  downloads omit "custom" so the game stays classified as a catalogue
   *  entry (metadata + assets already known). */
  libraryOrigin?: "sync" | "catalog" | "custom" | undefined;
}

export interface StartCustomDownloadPayload {
  title: string;
  /** A direct http(s) URL or magnet. Empty when localTorrentPath is used. */
  source: string;
  /** Path returned by Electron's trusted open-file dialog. */
  localTorrentPath?: string | null;
  downloadPath: string;
  automaticallyExtract: boolean;
  automaticallyDeleteArchiveFiles: boolean;
  /** When set, the download is linked to this catalogue game's entry instead
   *  of creating a generic custom entry (metadata + assets already known). */
  linkedShop?: GameShop;
  linkedObjectId?: string;
}

export interface StartCustomDownloadResult {
  ok: boolean;
  error?: string;
  objectId?: string;
  shop?: GameShop;
  queued?: boolean;
}

export interface UserFriend {
  id: string;
  displayName: string;
  profileImageUrl: string | null;
  backgroundImageUrl: string | null;
  isOnline: boolean;
  currentGame:
    | (ShopAssets & {
        sessionDurationInSeconds: number;
      })
    | null;
}

export interface UserFriends {
  totalFriends: number;
  friends: UserFriend[];
}

export interface ProfileFriends {
  totalFriends: number;
  onlineFriends: number;
  friends: UserFriend[];
}

export interface UserBlocks {
  totalBlocks: number;
  blocks: UserFriend[];
}

export interface FriendRequestSync {
  friendRequestCount: number;
}

export interface NotificationSync {
  notificationCount: number;
}

export interface FriendPresenceSync {
  friendId: string;
  isOnline: boolean;
}

export interface FriendRequest {
  id: string;
  displayName: string;
  profileImageUrl: string | null;
  type: "SENT" | "RECEIVED";
}

export interface UserRelation {
  AId: string;
  BId: string;
  status: "ACCEPTED" | "PENDING";
}

export type UserProfileCurrentGame = GameRunning &
  ShopAssets & {
    sessionDurationInSeconds: number;
  };

export type ProfileVisibility = "PUBLIC" | "PRIVATE" | "FRIENDS";

export interface Badge {
  name: string;
  title: string;
  description: string;
  badge: {
    url: string;
  };
}

export interface UserDetails {
  id: string;
  username: string;
  email: string | null;
  displayName: string;
  profileImageUrl: string | null;
  backgroundImageUrl: string | null;
  profileVisibility: ProfileVisibility;
  bio: string;
  workwondersJwt: string;
  subscription: Subscription | null;
  karma: number;
  quirks?: {
    backupsPerGameLimit: number;
  };
}

export interface UserProfile {
  id: string;
  displayName: string;
  profileImageUrl: string | null;
  email: string | null;
  backgroundImageUrl: string | null;
  profileVisibility: ProfileVisibility;
  libraryGames: UserGame[];
  recentGames: UserGame[];
  friends: UserFriend[];
  totalFriends: number;
  relation: UserRelation | null;
  currentGame: UserProfileCurrentGame | null;
  bio: string;
  hasActiveSubscription: boolean;
  karma: number;
  quirks: {
    backupsPerGameLimit: number;
  };
  badges: string[];
  hasCompletedWrapped2025: boolean;
}

export interface ProfileAchievementSouvenir {
  ownerId: string;
  shop: GameShop;
  objectId: string;
  achievementName: string;
  achievementDisplayName: string;
  achievementDescription?: string | null;
  achievementIconUrl?: string | null;
  gameTitle: string;
  gameIconUrl: string | null;
  imageUrl: string;
  unlockTime: number;
}

export interface AchievementSouvenirRecord {
  schemaVersion: 1;
  ownerId: string;
  shop: GameShop;
  objectId: string;
  achievementName: string;
  achievementDisplayName: string;
  /** Optional for schema-v1 records created before souvenir presentation metadata was added. */
  achievementDescription?: string | null;
  /** Optional for schema-v1 records created before souvenir presentation metadata was added. */
  achievementIconUrl?: string | null;
  gameTitle: string;
  gameIconUrl: string | null;
  unlockTime: number;
  localPath: string | null;
  r2Key: string | null;
  status: "local" | "synced" | "pending-delete";
  updatedAt: number;
}

export interface DeleteAchievementSouvenirRequest {
  shop: GameShop;
  objectId: string;
  achievementName: string;
}

export interface UpdateProfileRequest {
  displayName?: string;
  profileVisibility?: ProfileVisibility;
  profileImageUrl?: string | null;
  backgroundImageUrl?: string | null;
  bio?: string;
  language?: string;
}

export interface DownloadSourceDownload {
  title: string;
  uris: string[];
  uploadDate: string;
  fileSize: string;
}

export interface GameStats {
  downloadCount: number;
  playerCount: number;
  averageScore: number | null;
  reviewCount: number;
}

export interface GameReviewAnswer {
  id: string;
  answerHtml: string;
  createdAt: string;
  updatedAt: string;
  upvotes: number;
  downvotes: number;
  isBlocked: boolean;
  hasUpvoted: boolean;
  hasDownvoted: boolean;
  user: {
    id: string;
    displayName: string;
    profileImageUrl: string | null;
  };
  translations: {
    [key: string]: string;
  };
  detectedLanguage: string | null;
}

export interface GameReview {
  id: string;
  reviewHtml: string;
  score: number;
  createdAt: string;
  updatedAt: string;
  upvotes: number;
  downvotes: number;
  answerCount: number;
  answers: GameReviewAnswer[];
  isBlocked: boolean;
  hasUpvoted: boolean;
  hasDownvoted: boolean;
  playTimeInSeconds?: number;
  user: {
    id: string;
    displayName: string;
    profileImageUrl: string | null;
  };
  translations: {
    [key: string]: string;
  };
  detectedLanguage: string | null;
}

export interface TrendingGame extends ShopAssets {
  description: string | null;
  uri: string;
}

/**
 * Extra IGDB-sourced metadata for a console/emulated ("launchbox") game that
 * isn't carried by the Steam-shaped `ShopDetails`: review scores, local player
 * count, languages, the game's series, and box/additional art. Fetched by title
 * and cached; every field is best-effort and may be null/empty.
 */
export interface ConsoleGameMetadata {
  /** Aggregated critic score, 0–100. */
  criticScore: number | null;
  /** IGDB member score, 0–100. */
  userScore: number | null;
  /** Number of member ratings behind `userScore`. */
  ratingCount: number | null;
  /** e.g. "Single player", "Co-operative", "Multiplayer". */
  gameModes: string[];
  /** Max players in local/offline play, when IGDB reports it. */
  maxLocalPlayers: number | null;
  /** Distinct supported language names. */
  languages: string[];
  /** The game's series/collection and its other titles. */
  series: { name: string; titles: string[] } | null;
  /** Box-art / additional-artwork image URLs. */
  boxArtUrls: string[];
  /** HowLongToBeat playtimes in hours (from the hosted dataset), when known:
   *  main story / main + extras / completionist. */
  hltb?: {
    main: number | null;
    mainExtra: number | null;
    completionist: number | null;
  } | null;
  /** Content/age rating from the hosted dataset (IGN/LaunchBox), e.g.
   *  { name: "M", system: "ESRB" }. */
  ageRating?: { name: string; system: string | null } | null;
  /** LaunchBox 3-D box render (from the hosted dataset). The authentic box art
   *  for the game, featured in the details "Box art" panel ahead of any generic
   *  IGDB artwork. */
  boxImageUrl?: string | null;
}

export interface UserStatsPercentile {
  value: number;
  topPercentile: number;
}

export interface UserStats {
  libraryCount: number;
  friendsCount: number;
  totalPlayTimeInSeconds: UserStatsPercentile;
  achievementsPointsEarnedSum?: UserStatsPercentile;
  unlockedAchievementSum?: number;
}

export interface UpdatedUnlockedAchievements {
  objectId: string;
  shop: GameShop;
  achievements: UnlockedAchievement[];
}

export interface AchievementFile {
  type: Cracker;
  filePath: string;
}

export type GameAchievementFiles = {
  [id: string]: AchievementFile[];
};

export interface AchievementNotificationInfo {
  title: string;
  description?: string;
  iconUrl: string;
  isHidden: boolean;
  isRare: boolean;
  isPlatinum: boolean;
  points?: number;
}

export interface GameArtifact {
  id: string;
  artifactLengthInBytes: number;
  downloadOptionTitle: string | null;
  createdAt: string;
  updatedAt: string;
  hostname: string;
  downloadCount: number;
  label?: string;
  isFrozen: boolean;
  gameName?: string;
}

export interface GameArtifactWithGame extends GameArtifact {
  shop: import("./game.types").GameShop;
  objectId: string;
  gameTitle: string;
  gameIconUrl: string | null;
}

export type NotificationType =
  | "FRIEND_REQUEST_RECEIVED"
  | "FRIEND_REQUEST_ACCEPTED"
  | "BADGE_RECEIVED"
  | "REVIEW_UPVOTE";

export type LocalNotificationType =
  | "EXTRACTION_COMPLETE"
  | "DOWNLOAD_COMPLETE"
  | "DOWNLOAD_HALTED"
  | "UPDATE_AVAILABLE"
  | "ACHIEVEMENT_UNLOCKED"
  | "SCAN_GAMES_COMPLETE"
  | "ACHIEVEMENTS_SYNC_COMPLETE";

export interface Notification {
  id: string;
  type: NotificationType;
  variables: Record<string, string>;
  pictureUrl: string | null;
  url: string | null;
  isRead: boolean;
  priority: number;
  createdAt: string;
}

export interface LocalNotification {
  id: string;
  type: LocalNotificationType;
  title: string;
  description: string;
  pictureUrl: string | null;
  url: string | null;
  isRead: boolean;
  createdAt: string;
}

export type MergedNotification =
  | (Notification & { source: "api" })
  | (LocalNotification & { source: "local" });

export interface NotificationsResponse {
  notifications: Notification[];
  pagination: {
    total: number;
    take: number;
    skip: number;
    hasMore: boolean;
  };
}

export interface NotificationCountResponse {
  count: number;
}

export interface NotificationsChangedDetail {
  apiUnreadDelta?: number;
  resetApiUnread?: boolean;
}

/**
 * A single cached Exophase game → its achievement definitions. Definitions are
 * NOT user-specific, so this cache is shared across friends via R2 (one blob).
 * Keyed in LevelDB by `${shop}:${normalizedTitle}`.
 */
export interface ExophaseCacheEntry {
  shop: GameShop;
  /** Hydra catalogue objectId, set when this Exophase game matched a catalogue
   *  entry. Absent for "custom" games that exist only on Exophase — those are
   *  keyed by title so a later-added custom game lights up from this cache. */
  objectId?: string | null;
  normalizedTitle: string;
  title: string;
  masterId: number | null;
  awardsUrl: string | null;
  definitions: SteamAchievement[];
  /** Earned state harvested from the owner's Exophase account. Shared via R2 so
   *  a friend (or a freshly-added custom game) inherits the unlocks. */
  unlocked?: UnlockedAchievement[];
  updatedAt: number;
}

/** One line in the "Achievements Sync finished" report modal. */
export interface ExophaseSyncReportGame {
  shop: GameShop;
  objectId: string;
  title: string;
  iconUrl: string | null;
  newlyUnlocked: number;
  totalUnlocked: number;
  totalAchievements: number;
  /** A PSN entry with earned trophies exists for this PC game. */
  psnDetected?: boolean;
  /** Post-match verification: results of the 3 integrity checks run after the
   *  game's achievements were written. True only when all 3 passed. */
  verified?: boolean;
  verificationChecks?: {
    /** 1. The achievements entry persisted with a non-empty definition list. */
    persisted: boolean;
    /** 2. The game record's unlocked count matches the stored unlocked list. */
    unlockCountConsistent: boolean;
    /** 3. Every unlocked apiName exists in the definition set (no orphans). */
    noOrphanUnlocks: boolean;
  };
  /** In-depth match trace, surfaced in the sync report's per-game debug view so
   *  the user can see exactly how a title was resolved and matched. */
  debug?: ExophaseSyncReportDebug;
}

export interface ExophaseSyncReportDebug {
  /** The raw title enumerated from the Exophase account profile. */
  accountTitle: string;
  /** Exophase platform slug the title came from (steam/psn/xbox/…). */
  platformSlug: string;
  /** The awards page URL we scraped for earned state (with #playerId hash). */
  awardsUrl: string | null;
  /** How many achievement definitions Exophase returned. */
  exophaseDefs: number;
  /** How many of those Exophase marked as earned by the user. */
  exophaseUnlocked: number;
  /** Whether a Hydra catalogue entry matched (and what it was). */
  catalogueMatched: boolean;
  catalogueTitle?: string;
  /** Definition source applied to the library record. */
  defSource: "hydraapi" | "exophase" | "none";
  /** Whether the matched game existed in the user's library. */
  inLibrary: boolean;
  /** Outcome of pushing the matched unlocks up to the user's HydraAPI cloud
   *  profile (only attempted for games with HydraAPI/Steam definitions):
   *   - "synced"      — unlocks were uploaded to HydraAPI
   *   - "no-match"    — no Exophase unlock matched a HydraAPI achievement key
   *   - "not-eligible"— no HydraAPI definitions (e.g. EA/PSN-only) → local only
   *   - "logged-out"  — user isn't logged into Hydra
   *   - "no-remote-id"— game isn't in the user's remote library
   *   - "failed"      — upload attempted but errored (subscription/network) */
  hydraApiSync?:
    | "synced"
    | "no-match"
    | "not-eligible"
    | "logged-out"
    | "no-remote-id"
    | "failed";
  /** How many unlocks were matched onto HydraAPI keys and uploaded. */
  hydraApiSyncedCount?: number;
  /** Free-text note when the title was skipped or only partially resolved. */
  note?: string;
}

export interface ExophaseSyncReport {
  startedAt: string;
  finishedAt: string;
  gamesProcessed: number;
  gamesUpdated: number;
  totalNewlyUnlocked: number;
  games: ExophaseSyncReportGame[];
  psnDetected: ExophaseSyncReportGame[];
}

export interface ComparedAchievements {
  achievementsPointsTotal: number;
  owner: {
    totalAchievementCount: number;
    unlockedAchievementCount: number;
    achievementsPointsEarnedSum?: number;
  };
  target: {
    displayName: string;
    profileImageUrl: string;
    totalAchievementCount: number;
    unlockedAchievementCount: number;
    achievementsPointsEarnedSum: number;
  };
  achievements: {
    hidden: boolean;
    icon: string;
    displayName: string;
    description: string;
    ownerStat?: {
      unlocked: boolean;
      unlockTime: number;
    };
    targetStat: {
      unlocked: boolean;
      unlockTime: number;
    };
  }[];
}

export interface CatalogueSearchPayload {
  title: string;
  sortBy:
    | "popularity"
    | "reviewScore"
    | "alphabetical"
    | "hydraScore"
    | "releaseDate";
  sortOrder: "asc" | "desc";
  downloadSourceFingerprints: string[];
  tags: number[];
  publishers: string[];
  genres: string[];
  developers: string[];
  protondbSupportBadges: (
    | "borked"
    | "bronze"
    | "silver"
    | "gold"
    | "platinum"
  )[];
  deckCompatibility: ("verified" | "playable" | "unsupported" | "unknown")[];
  releaseYear?: { gte?: number; lte?: number };
  /** "pc" = PC games only (Hydra API), "console" = emulated only (local
   *  GameHub Vault), undefined = both (current behaviour). */
  platform?: "pc" | "console";
  /** When platform === "console", filter to a specific system. */
  consoleSystem?: EmulatorSystem;
}

export interface ProtonDBData {
  tier: string | null;
  confidence: string | null;
  score: number | null;
  total: number | null;
  trendingTier: string | null;
  resolvedCategory: number | null;
  deckCompatibility: "verified" | "playable" | "unsupported" | "unknown" | null;
}

export type CatalogueSearchResult = {
  id: string;
  objectId: string;
  title: string;
  shop: GameShop;
  genres: string[];
  releaseYear: number | null;
  tier?: string | null;
  bestReportedTier?: string | null;
  protondbSupportBadge?: string | null;
  protondbSupportBadges?: string[];
  deckCompatibility?: string | null;
  deckCompatibilities?: string[];
} & Pick<ShopAssets, "libraryImageUrl" | "downloadSources">;

/** Unified catalogue suggestion for the custom-download linker dropdown:
 *  merges the hosted PC catalogue and the local console/emulated catalogue. */
export type CatalogueSearchSuggestion = CatalogueSearchResult & {
  source: "catalogue" | "classics";
};

export type LibraryGame = Game &
  Partial<ShopAssets> & {
    id: string;
    download: Download | null;
    unlockedAchievementCount?: number;
    achievementsPointsEarnedSum?: number;
    achievementCount?: number;
  };

export type UserGameDetails = ShopAssets & {
  id: string;
  playTimeInSeconds: number;
  unlockedAchievementCount: number;
  achievementsPointsEarnedSum: number;
  lastTimePlayed: Date | null;
  isDeleted: boolean;
  isFavorite: boolean;
  friendsWhoPlayed: {
    id: string;
    displayName: string;
    profileImageUrl: string | null;
    lastTimePlayed: Date | null;
    playTimeInSeconds: number;
  }[];
};

// Cloud debugger types (shared between the main-process debugger and the
// renderer modal that displays its report). Kept here in @types so the renderer
// never has to import from @main, which isn't on the renderer's tsconfig paths.
export interface DebugIssue {
  kind:
    | "missing-from-cloud"
    | "missing-from-local"
    | "achievement-count-mismatch"
    | "playtime-mismatch";
  gameTitle: string;
  shop: string;
  objectId: string;
  detail: string;
  fixed: boolean;
  fixError?: string;
}

export interface CloudDebugReport {
  checkedAt: string;
  localCount: number;
  cloudCount: number;
  issues: DebugIssue[];
  fixedCount: number;
  unfixedCount: number;
  notLoggedIn?: boolean;
  mode?: "audit" | "repair";
  error?: string;
}

/** One game's achievement progress for the profile breakdown. Sourced from the
 *  local achievements store, so it includes games that have achievements but are
 *  NOT in the local library (e.g. Exophase/PSN catalogue games). */
export interface AchievementGameStat {
  objectId: string;
  shop: GameShop;
  title: string;
  iconUrl: string | null;
  achievementCount: number;
  unlockedAchievementCount: number;
  inLibrary: boolean;
}

export * from "./game.types";
export * from "./steam.types";
export * from "./download.types";
export * from "./ludusavi.types";
export * from "./how-long-to-beat.types";
export * from "./level.types";
export * from "./cloud-save.types";
export * from "./theme.types";
export * from "./emulator.types";
export * from "./mods.types";
export * from "./overlay.types";
export * from "./game-recorder.types";
export * from "./game-process-control.types";
export * from "./music-player.types";
export * from "./spotify.types";
