import { levelKeys, db } from "./level";
import { openDatabase } from "./level/level";
import { type UserPreferences } from "../types";
import {
  SystemPath,
  CommonRedistManager,
  HydraApi,
  uploadGamesBatch,
  startMainLoop,
  Ludusavi,
  Lock,
  DeckyPlugin,
  SSEClient,
  Wine,
  WindowManager,
  logger,
  migrateCloudSaveAutomaticSyncDefaults,
  groupedSouvenirWorker,
} from "@main/services";
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
    // ROMs copied into the linked console folders are imported on their own too.
    void import("./services/emulators/new-roms-watcher").then(
      ({ scheduleNewRomsWatcher }) => scheduleNewRomsWatcher()
    );
    // PC games installed by hand in the watched folders join the library on their own.
    void import("./services/folder-game-finder").then(
      ({ scheduleFolderGameFinder }) => scheduleFolderGameFinder()
    );
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
    if (HydraApi.isLoggedIn()) {
      SSEClient.connect();
      void groupedSouvenirWorker.trigger();
      void startSteamSyncOnStartup();
    }
  });

  startMainLoop();

  if (process.platform === "win32") {
    CommonRedistManager.downloadCommonRedist();
  }

  SystemPath.checkIfPathsAreAvailable();
};
