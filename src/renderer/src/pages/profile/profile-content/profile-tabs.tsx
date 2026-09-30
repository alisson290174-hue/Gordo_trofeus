import { useTranslation } from "react-i18next";
import cn from "classnames";
import "./profile-content.scss";

export type ProfileTabType = "overview" | "souvenirs" | "reviews" | "activity";

interface ProfileTabsProps {
  activeTab: ProfileTabType;
  reviewsTotalCount: number;
  souvenirsCount: number;
  onTabChange: (tab: ProfileTabType) => void;
}

export function ProfileTabs({
  activeTab,
  reviewsTotalCount,
  souvenirsCount,
  onTabChange,
}: Readonly<ProfileTabsProps>) {
  const { t } = useTranslation(["user_profile", "dashboard"]);

  const tabs: { key: ProfileTabType; label: string; count?: number }[] = [
    { key: "overview", label: t("dashboard:overview") },
    { key: "souvenirs", label: t("souvenirs"), count: souvenirsCount },
    { key: "reviews", label: t("user_reviews"), count: reviewsTotalCount },
    { key: "activity", label: t("dashboard:activity") },
  ];

  return (
    <div className="profile-content__tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.key}
          className={cn("profile-content__tab", {
            "profile-content__tab--active": activeTab === tab.key,
          })}
          onClick={() => onTabChange(tab.key)}
        >
          {tab.label}
          {tab.count ? (
            <span className="profile-content__tab-badge">{tab.count}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
