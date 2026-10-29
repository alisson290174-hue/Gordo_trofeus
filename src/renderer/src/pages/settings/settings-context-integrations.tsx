import { SettingsRetroAchievements } from "./settings-retroachievements";
import { SettingsSteamOwned } from "./settings-steam-owned";
import "./settings-epic.scss";
import { SettingsEpic } from "./settings-epic";

export function SettingsContextIntegrations() {
  return (
    <div className="settings-context-panel">
      <div className="settings-context-panel__group">
        <SettingsSteamOwned />
        <SettingsRetroAchievements />
        <SettingsEpic />
      </div>
    </div>
  );
}
