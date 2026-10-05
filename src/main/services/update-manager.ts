import updater, { UpdateInfo } from "electron-updater";
import { logger, WindowManager } from "@main/services";
import { AppUpdaterEvent, UserPreferences } from "@types";
import { app } from "electron";
import { publishNotificationUpdateReadyToInstall } from "@main/services/notifications";
import { db, levelKeys } from "@main/level";
import { HydraApi } from "./hydra-api";

const { autoUpdater } = updater;
const sendEventsForDebug = false;

export class UpdateManager {
  private static hasNotified = false;
  private static newVersion = "";
  /** Version already downloaded and waiting to be installed (Big Picture asks for it). */
  private static downloadedVersion: string | null = null;

  public static getDownloadedVersion() {
    return this.downloadedVersion;
  }

  private static mockValuesForDebug() {
    this.sendEvent({ type: "update-available", info: { version: "3.3.1" } });
    this.sendEvent({ type: "update-downloaded" });
  }

  private static sendEvent(event: AppUpdaterEvent) {
    // Every app window (main and Big Picture) shows the update.
    WindowManager.sendToAppWindows("autoUpdaterEvent", event);
  }

  private static async isAutoInstallEnabled() {
    if (process.platform === "darwin") return false;
    if (process.platform === "win32") {
      return process.env.PORTABLE_EXECUTABLE_FILE == null;
    }

    if (process.platform === "linux") {
      const userPreferences = await db.get<string, UserPreferences | null>(
        levelKeys.userPreferences,
        {
          valueEncoding: "json",
        }
      );

      return userPreferences?.enableAutoInstall === true;
    }

    return false;
  }

  public static async checkForUpdates() {
    autoUpdater
      .removeAllListeners()
      .on("update-available", (info: UpdateInfo) => {
        this.sendEvent({ type: "update-available", info });
        this.newVersion = info.version;
      })
      .on("update-downloaded", () => {
        this.downloadedVersion = this.newVersion || this.downloadedVersion;
        this.sendEvent({ type: "update-downloaded" });

        if (!this.hasNotified) {
          this.hasNotified = true;
          publishNotificationUpdateReadyToInstall(this.newVersion);
        }
      });

    const isAutoInstallAvailable = await this.isAutoInstallEnabled();

    if (app.isPackaged) {
      // Our update feed is for signed-in users only; without a session there is nothing to check.
      const token = await HydraApi.getFreshAccessToken();
      if (!token) return isAutoInstallAvailable;

      autoUpdater.requestHeaders = { Authorization: `Bearer ${token}` };
      autoUpdater.autoDownload = isAutoInstallAvailable;
      autoUpdater
        .checkForUpdates()
        .then((result) => {
          logger.log(
            `Check for updates: latest ${result?.updateInfo?.version ?? "unknown"}`
          );
        })
        .catch((error) => {
          // Used to fail silently (unhandled) — keep it visible in the log.
          logger.error(
            "Check for updates failed",
            error instanceof Error ? error.message : error
          );
        });
    } else if (sendEventsForDebug) {
      this.mockValuesForDebug();
    }

    return isAutoInstallAvailable;
  }
}
