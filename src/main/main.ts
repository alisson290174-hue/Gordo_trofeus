import { downloadsSublevel } from "./level/sublevels/downloads";
import { orderBy } from "lodash-es";
import { Downloader } from "@shared";
import { levelKeys, db } from "./level";
import { openDatabase } from "./level/level";
import { refreshGlobalTrackersUrlCache } from "@main/helpers";
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
  SSEClient,
  Wine,
  WindowManager,
  logger,
  migrateCloudSaveAutomaticSyncDefaults,
  groupedSouvenirWorker,
} from "@main/services";
import { migrateDownloadSources } from "./helpers/migrate-download-sources";
import { getDirSize } from "./services/download/helpers";
import { GofileApi } from "./services/hosters";
import { clearLegacyAchievementPersistence } from "./level/clear-legacy-achievements";
import { startSteamSyncOnStartup } from "./services/steam-integration/steam-startup-sync";
import { backfillMissingGameMetadata } from "./helpers/backfill-game-metadata";
import { backfillPs2Covers } from "./helpers/backfill-ps2-covers";
import { backfillPs2Metadata } from "./helpers/backfill-ps2-metadata";
import { getEpicStatus } from "./services/epic/epic-account";
import { syncEpicLibrary } from "./services/epic/epic-library";
import { sealEpicSessionAtRest } from "./services/epic/legendary";
import { findInstalledDownloadedGames } from "./services/installed-game-finder";
import {
  refreshSteamOwnedAchievements,
  syncSteamOwnedLibrary,
} from "./services/steam-owned/steam-owned-library";

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
  await openDatabase();
  await Lock.acquireLock();
  await clearLegacyAchievementPersistence();
  await migrateCloudSaveAutomaticSyncDefaults();

  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    {
      valueEncoding: "json",
    }
  );

  Wine.syncUserPreferences(userPreferences);

  await import("./events");
  // Emulators Opus manages follow their latest official release (checked daily).
  void import("./services/emulators/emulator-updater").then(
    ({ scheduleEmulatorUpdates }) => scheduleEmulatorUpdates()
  );

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

  if (
    userPreferences?.appendGlobalTrackersUrl &&
    userPreferences?.globalTrackersUrl
  ) {
    refreshGlobalTrackersUrlCache().catch((err) =>
      logger.warn("Failed to refresh global tracker URL cache on startup", err)
    );
  }

  Ludusavi.copyConfigFileToUserData();
  Ludusavi.copyBinaryToUserData();

  if (process.platform === "linux") {
    DeckyPlugin.checkAndUpdateIfOutdated();
  }

  await HydraApi.setupApi().then(async () => {
    // The user's setup on our server: restored on a fresh install, kept current afterwards.
    void import("./services/settings-sync").then(({ SettingsSync }) =>
      SettingsSync.start()
    );
    uploadGamesBatch();
    void migrateDownloadSources();

    // Repair library games saved without a title back when the catalogue was sparse (shows as
    // "undefined" in the library/profile and in achievement notifications). Runs in the
    // background so it never delays startup.
    void backfillMissingGameMetadata();
    // Steam games whose store page has no standard cover get one found automatically.
    setTimeout(
      () =>
        void import("./services/repair-missing-covers").then(
          ({ repairMissingSteamCovers }) =>
            repairMissingSteamCovers().catch(() => {})
        ),
      120_000
    );
    // Games installed by the Xbox app (Game Pass / Store) join the library on their own.
    setTimeout(
      () =>
        void import("./services/xbox-games").then(({ importXboxGames }) =>
          importXboxGames().catch((error) =>
            logger.error("[Xbox] Import failed", error)
          )
        ),
      40_000
    );
    // An emulator moved/swapped for a fork is found again; PS4 games extracted by hand into the
    // linked folder join the library; PC ports (<emulators>\Ports) get their own "PORT" tab.
    setTimeout(
      () =>
        void (async () => {
          const { repairMissingEmulatorPaths, ps4FoldersWithNewGames } =
            await import("./services/emulators/repair-emulators");
          await repairMissingEmulatorPaths().catch((error) =>
            logger.error("[emulators] path repair failed", error)
          );
          const folders = await ps4FoldersWithNewGames().catch(() => []);
          if (folders.length) {
            const { runLaunchboxImport } =
              await import("./events/emulators/import-launchbox-roms");
            logger.info(
              `[emulators] ps4: new games in ${folders.length} folder(s)`
            );
            await runLaunchboxImport(
              "ps4",
              folders.map((f) => ({
                path: f.path,
                scanSubfolders: f.scanSubfolders,
              })),
              "pt",
              { cancelled: false }
            ).catch((error) =>
              logger.error("[emulators] ps4 import failed", error)
            );
          }
          const { backfillPs4Covers } =
            await import("./services/emulators/repair-emulators");
          const covers = await backfillPs4Covers().catch(() => 0);
          if (covers)
            WindowManager.sendToAppWindows("on-library-batch-complete");
          const { importPcPorts } = await import("./services/pc-ports");
          await importPcPorts().catch((error) =>
            logger.error("[ports] Import failed", error)
          );
        })(),
      30_000
    );
    // Fill PS2 box art for games imported before covers existed (no rescan needed).
    // Then real titles, fanart and logos from the server's PS2 index (after covers so it can
    // replace the box art that stands in as background).
    void backfillPs2Covers().then(() => backfillPs2Metadata());
    // An Epic session left in plaintext (app closed while Legendary ran) is encrypted again.
    sealEpicSessionAtRest();
    // Epic account (if connected): refresh owned games and installed state. Local only.
    void getEpicStatus()
      .then((status) => (status.connected ? syncEpicLibrary() : 0))
      .catch((error) => logger.error("[epic] boot sync failed", error));
    // Steam account games (list from our server, installed state from Steam's files).
    void syncSteamOwnedLibrary().catch((error) =>
      logger.warn("[steam-owned] boot sync skipped", error?.message ?? error)
    );
    // Downloaded games installed while Opus was closed: learn their executable from Windows.
    void findInstalledDownloadedGames()
      .then(
        (found) =>
          found &&
          logger.info(
            `[installed-game-finder] ${found} game(s) found installed`
          )
      )
      .catch((error) =>
        logger.warn(
          "[installed-game-finder] boot check skipped",
          error?.message ?? error
        )
      );
    // Trophies from games played on Steam while the app is open.
    setInterval(
      () =>
        void refreshSteamOwnedAchievements().catch((error) =>
          logger.warn(
            "[steam-achievements] refresh skipped",
            error?.message ?? error
          )
        ),
      30 * 60 * 1000
    );

    const { syncDownloadSourcesFromApi } = await import("./services/user");
    void syncDownloadSourcesFromApi();

    // Check for new download options on startup (if enabled)
    (async () => {
      await DownloadSourcesChecker.checkForChanges();
    })();

    if (HydraApi.isLoggedIn()) {
      SSEClient.connect();
      void groupedSouvenirWorker.trigger();
      void startSteamSyncOnStartup();
    }
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

  // Torrents use the native service; HTTP downloads use the JS downloader.
  // A torrent start-up failure (e.g. the native addon missing) must never keep the main loop —
  // process, download and achievement watchers — from starting: up to v1.0.14 it did, so live
  // achievement notifications and playtime tracking silently never ran in installed builds.
  const isTorrent = downloadToResume?.downloader === Downloader.Torrent;
  try {
    if (downloadToResume && !isTorrent) {
      // Initialize torrent seeding, then resume the HTTP download with JS.
      await DownloadManager.initializeTorrentService(
        undefined,
        downloadsToSeed
      );
      await DownloadManager.startDownload(downloadToResume).catch((err) => {
        // If resume fails, just log it - user can manually retry
        logger.error("Failed to auto-resume download:", err);
      });
    } else {
      await DownloadManager.initializeTorrentService(
        downloadToResume ?? undefined,
        downloadsToSeed
      );
    }
  } catch (error) {
    logger.error(
      "[Startup] Torrent service failed to start; continuing without it",
      error
    );
  }

  WindowManager.sendDownloadsUpdated();

  startMainLoop();

  if (process.platform === "win32") {
    CommonRedistManager.downloadCommonRedist();
  }

  SystemPath.checkIfPathsAreAvailable();
};
