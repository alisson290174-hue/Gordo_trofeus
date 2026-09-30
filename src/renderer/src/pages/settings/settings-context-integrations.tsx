import { useTranslation } from "react-i18next";
import { SettingsDebrid } from "./settings-debrid";
import { SettingsRetroAchievements } from "./settings-retroachievements";
import { SettingsSteamOwned } from "./settings-steam-owned";
import "./settings-epic.scss";
import { SettingsEpic } from "./settings-epic";

export function SettingsContextIntegrations() {
  const { t } = useTranslation("settings");

  return (
    <div className="settings-context-panel">
      <div className="settings-context-panel__group">
        <SettingsSteamOwned />
        <SettingsRetroAchievements />
        <SettingsEpic />
      </div>

      <hr className="settings-context-panel__divider" />

      <div className="settings-context-panel__group">
        <h3>{t("debrid_services")}</h3>
        <SettingsDebrid />
      </div>
    </div>
  );
}
