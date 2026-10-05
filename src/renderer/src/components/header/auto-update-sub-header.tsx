import { useTranslation } from "react-i18next";
import { Icon } from "@renderer/components/icon/icon";
import { useEffect, useState } from "react";

import { Link } from "../link/link";
import "./auto-update-header.scss";
import type { AppUpdaterEvent } from "@types";

export const releasesPageUrl =
  "https://github.com/alisson290174-hue/Gordo_trofeus/releases/latest";

export function AutoUpdateSubHeader() {
  const [isReadyToInstall, setIsReadyToInstall] = useState(false);
  const [newVersion, setNewVersion] = useState<string | null>(null);
  const [isAutoInstallAvailable, setIsAutoInstallAvailable] = useState(false);

  const { t } = useTranslation("header");

  const handleClickInstallUpdate = () => {
    window.electron.restartAndInstallUpdate();
  };

  useEffect(() => {
    const unsubscribe = window.electron.onAutoUpdaterEvent(
      (event: AppUpdaterEvent) => {
        if (event.type == "update-available") {
          setNewVersion(event.info.version);
        }

        if (event.type == "update-downloaded") {
          setIsReadyToInstall(true);
        }
      }
    );

    const check = () =>
      window.electron.checkForUpdates().then((isAutoInstallAvailable) => {
        setIsAutoInstallAvailable(isAutoInstallAvailable);
      });
    void check();
    // Opus often stays open for days: look for a new version every 3 hours, not only at start.
    const interval = window.setInterval(() => void check(), 3 * 60 * 60_000);

    return () => {
      unsubscribe();
      window.clearInterval(interval);
    };
  }, []);

  if (!newVersion) return null;

  if (!isAutoInstallAvailable) {
    return (
      <header className="auto-update-sub-header">
        <Link
          to={releasesPageUrl}
          className="auto-update-sub-header__new-version-link"
        >
          <Icon
            name="sync"
            className="auto-update-sub-header__new-version-icon"
            size={12}
          />
          {t("version_available_download", { version: newVersion })}
        </Link>
      </header>
    );
  }

  if (isReadyToInstall) {
    return (
      <header className="auto-update-sub-header">
        <button
          type="button"
          className="auto-update-sub-header__new-version-button"
          onClick={handleClickInstallUpdate}
        >
          <Icon
            name="sync"
            className="auto-update-sub-header__new-version-icon"
            size={12}
          />
          {t("version_available_install", { version: newVersion })}
        </button>
      </header>
    );
  }

  return null;
}
