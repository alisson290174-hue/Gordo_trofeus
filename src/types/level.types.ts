import type { Downloader } from "@shared";
import type { GameShop } from "./game.types";
import type { DownloadStatus } from "./download.types";
import type { ClassicsDisc } from "./emulator.types";

export type SubscriptionStatus = "active" | "pending" | "cancelled";

/**
 * Result of scanning an installed game for a crack that records achievements:
 * - `working`     — an achievement file was found with unlocked achievements in it.
 * - `supported`   — an achievement file exists but is empty and the game hasn't been played yet
 *                   (the crack has the system; play once to confirm).
 * - `not_writing` — an achievement file exists but stays empty after real playtime (the crack has
 *                   the system but doesn't record this specific game — the Clair Obscur case).
 * - `unsupported` — the game has playtime but no achievement file ever appeared (DRM-free build).
 * - `unknown`     — not installed / not yet scanned / never played.
 */
export type AchievementSupport =
  "working" | "supported" | "not_writing" | "unsupported" | "unknown";

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
  /** Box art kept on the record itself (classics), so profile syncs that reset assets can't lose it. */
  coverImageUrl?: string | null;
  /** Photo of the game's case from the local art backup (LaunchBox "Box - Front"): the cover for
   * per-platform shelves, where every case of a console has the same shape. */
  boxArtImageUrl?: string | null;
  /** Square-friendly art for the Início strip (Switch icon, title screen) — classics only. */
  tileImageUrl?: string | null;
  customIconUrl?: string | null;
  customLogoImageUrl?: string | null;
  customHeroImageUrl?: string | null;
  customCoverImageUrl?: string | null;
  originalIconPath?: string | null;
  originalLogoPath?: string | null;
  originalHeroPath?: string | null;
  customOriginalIconPath?: string | null;
  customOriginalLogoPath?: string | null;
  customOriginalHeroPath?: string | null;
  customOriginalCoverPath?: string | null;
  playTimeInMilliseconds: number;
  steamPlayTimeInMilliseconds?: number;
  hasActiveSteamImport?: boolean;
  /** Owned on Steam and installed by the Steam client (appmanifest found); plays via steam://. */
  steamInstalled?: boolean;
  /** Steam's "last played" whose Steam achievements already reached the profile (skip until it changes). */
  steamAchievementsCheckedFor?: number;
  enableHydraPlaytimeTracking?: boolean;
  unsyncedDeltaPlayTimeInMilliseconds?: number;
  lastTimePlayed: Date | null;
  addedToLibraryAt?: Date | null;
  objectId: string;
  shop: GameShop;
  remoteId: string | null;
  source?: "hydra" | "steam";
  collectionIds?: string[];
  isDeleted: boolean;
  winePrefixPath?: string | null;
  protonPath?: string | null;
  executablePath?: string | null;
  executablePathUpdatedAt?: Date | null;
  trackingExecutablePaths?: string[] | null;
  trackingExecutablePathsUpdatedAt?: Date | null;
  launchOptions?: string | null;
  autoRunMangohud?: boolean | null;
  autoRunGamemode?: boolean | null;
  favorite?: boolean;
  isPinned?: boolean;
  achievementCount?: number;
  unlockedAchievementCount?: number;
  reportedUnlockedAchievementCount?: number;
  /** Whether this installed game's crack actually records achievements — classified by scanning
   * the game folder (see classify-achievement-support.ts). Lets the library flag which games will
   * give trophies before the user wastes time on one whose crack doesn't write them. */
  achievementSupport?: AchievementSupport;
  pinnedDate?: Date | null;
  automaticCloudSync?: boolean;
  hasManuallyUpdatedPlaytime?: boolean;
  newDownloadOptionsCount?: number;
  installedSizeInBytes?: number | null;
  installerSizeInBytes?: number | null;
  steamShortcutAppId?: number;
  platform?: string | null;
  discs?: ClassicsDisc[];
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
  customTrackers?: string[];
}

export interface DownloadLayoutState {
  version: 1;
  queueOrder: string[];
  pausedOrder: string[];
}

export type AchievementCustomNotificationPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export type BigPictureDiagnosticsPosition =
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
  defaultWinePrefixPath?: string | null;
  downloadDirectories?: DownloadDirectoryPreference[];
  optionalDownloadsPaths?: string[];
  ggDealsApiKey?: string | null;
  language?: string;
  realDebridApiToken?: string | null;
  premiumizeApiToken?: string | null;
  allDebridApiToken?: string | null;
  torBoxApiToken?: string | null;
  retroAchievementsWebApiKey?: string | null;
  retroAchievementsUsername?: string | null;
  preferQuitInsteadOfHiding?: boolean;
  runAtStartup?: boolean;
  startMinimized?: boolean;
  launchToLibraryPage?: boolean;
  bigPictureLaunchToLibraryPage?: boolean;
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
  enableAchievementSouvenirs?: boolean;
  achievementScreenshotsPath?: string;
  autoplayGameTrailers?: boolean;
  hideToTrayOnGameStart?: boolean;
  enableNewDownloadOptionsBadges?: boolean;
  createStartMenuShortcut?: boolean;
  bigPictureSoundsEnabled?: boolean;
  /** Opus logo + chime when Big Picture opens (default on). */
  bigPictureIntroEnabled?: boolean;
  /** Rest screen with game art after 5 idle minutes (default on). */
  bigPictureScreensaverEnabled?: boolean;
  bigPictureVirtualKeyboardEnabled?: boolean;
  bigPictureDiagnosticsEnabled?: boolean;
  bigPictureDiagnosticsPosition?: BigPictureDiagnosticsPosition;
  maxDownloadSpeedBytesPerSecond?: number | null;
  torrentNetworkInterface?: string | null;
  globalTrackers?: string[];
  appendGlobalTrackers?: boolean;
  globalTrackersUrl?: string;
  appendGlobalTrackersUrl?: boolean;
  defaultProtonPath?: string | null;
  autoRunMangohud?: boolean;
  autoRunGamemode?: boolean;
  hideClassicsBookmark?: boolean;
  classicsUseHeroLayout?: boolean;
  hideLibraryGameBadges?: boolean;
  hideLibraryReadySizeBadges?: boolean;
  hideLibraryClassicsBadges?: boolean;
  hideSteamLibraryBadges?: boolean;
  hideLibraryAchievementProgress?: boolean;
  autoplayAnimatedArtwork?: boolean;
  persistFiltersAndSorting?: boolean;
}

export interface NetworkInterface {
  name: string;
  addresses: string[];
}

export interface ScreenState {
  x?: number;
  y?: number;
  height: number;
  width: number;
  isMaximized: boolean;
}
