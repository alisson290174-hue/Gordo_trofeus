import "./general.scss";

import { BehaviorSection } from "./behavior-section";
import { GameFoldersSection } from "./game-folders-section";
import { LanguageSection } from "./language-section";

interface SettingsSectionProps {
  className?: string;
}

export function GeneralSettingsSection({
  className,
}: Readonly<SettingsSectionProps>) {
  return (
    <div
      className={
        className
          ? `general-settings-section ${className}`
          : "general-settings-section"
      }
    >
      <GameFoldersSection />
      <LanguageSection />
      <BehaviorSection />
    </div>
  );
}
