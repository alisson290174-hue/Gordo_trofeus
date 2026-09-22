
import { useTranslation } from "react-i18next";
import { Icon } from "@renderer/components/icon/icon";
import "./locked-profile.scss";

interface LockedProfileProps {
  title?: string;
}

export function LockedProfile({ title }: Readonly<LockedProfileProps> = {}) {
  const { t } = useTranslation("user_profile");

  return (
    <div className="locked-profile__container">
      <div className="locked-profile__lock-icon">
        <Icon name="lock" size={24} />
      </div>

      <h2>{title ?? t("locked_profile")}</h2>
    </div>
  );
}
