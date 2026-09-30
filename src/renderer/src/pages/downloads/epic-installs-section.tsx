import { useTranslation } from "react-i18next";
import { formatBytes } from "@shared";
import { Icon } from "@renderer/components/icon/icon";
import { useLibrary } from "@renderer/hooks";
import { getCoverArt } from "@renderer/helpers/ps5-game";
import type { EpicInstallState } from "@types";
import "./epic-installs-section.scss";

/** Epic installs run by Legendary (separate from the torrent download manager). */
export function EpicInstallsSection({
  installs,
}: Readonly<{ installs: EpicInstallState[] }>) {
  const { t } = useTranslation("dashboard");
  const { library } = useLibrary();

  if (installs.length === 0) return null;

  return (
    <div className="epic-installs">
      <span className="epic-installs__eyebrow">{t("epic_installs_title")}</span>
      {installs.map((install) => {
        const game = library.find(
          (item) => item.shop === "epic" && item.objectId === install.appName
        );
        const cover = game ? getCoverArt(game) : null;
        const percent = Math.round(install.percent);

        return (
          <div key={install.appName} className="epic-installs__row">
            <span className="epic-installs__cover">
              {cover && <img src={cover} alt="" />}
            </span>
            <div className="epic-installs__body">
              <span className="epic-installs__title">{install.title}</span>
              <div className="epic-installs__track">
                <span style={{ width: `${percent}%` }} />
              </div>
              <span className="epic-installs__meta">
                {install.status === "error"
                  ? t("epic_install_failed")
                  : install.status === "downloading"
                    ? [
                        `${percent}%`,
                        install.totalBytes ? formatBytes(install.totalBytes) : null,
                        install.speedBytes ? `${formatBytes(install.speedBytes)}/s` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : t("epic_preparing")}
              </span>
            </div>
            {install.status !== "error" && (
              <button
                type="button"
                className="epic-installs__cancel"
                onClick={() => window.electron.cancelEpicInstall(install.appName)}
                title={t("epic_cancel_install")}
              >
                <Icon name="x" size={16} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
