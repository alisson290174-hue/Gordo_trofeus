import { useId } from "react";
import { Icon } from "@renderer/components/icon/icon";
import { createPortal } from "react-dom";

import { useTranslation } from "react-i18next";
import { Tooltip } from "react-tooltip";
import cn from "classnames";
import "./installed-filter.scss";

interface AchievementsFilterProps {
  showAchievementsOnly: boolean;
  onShowAchievementsOnlyChange: (showAchievementsOnly: boolean) => void;
}

/** Toggle that narrows the library to games whose crack is confirmed to record achievements
 * (achievementSupport === "working"). Sits next to the "installed only" toggle. */
export function AchievementsFilter({
  showAchievementsOnly,
  onShowAchievementsOnlyChange,
}: Readonly<AchievementsFilterProps>) {
  const { t } = useTranslation("library");

  const tooltipId = useId();
  const label = t("achievement_filter_working");

  return (
    <>
      <button
        type="button"
        className={cn("library-installed-filter__button", {
          "library-installed-filter__button--active": showAchievementsOnly,
        })}
        onClick={() => onShowAchievementsOnlyChange(!showAchievementsOnly)}
        aria-label={label}
        aria-pressed={showAchievementsOnly}
        data-tooltip-id={tooltipId}
        data-tooltip-content={label}
        data-tooltip-place="bottom"
      >
        <Icon name="trophy" size={16} />
      </button>

      {createPortal(
        <Tooltip id={tooltipId} place="bottom" style={{ zIndex: 1 }} />,
        document.body
      )}
    </>
  );
}
