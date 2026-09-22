import { useId } from "react";
import { Icon } from "@renderer/components/icon/icon";
import { createPortal } from "react-dom";

import { useTranslation } from "react-i18next";
import { Tooltip } from "react-tooltip";
import "./installed-filter.scss";

interface InstalledFilterProps {
  showInstalledOnly: boolean;
  onShowInstalledOnlyChange: (showInstalledOnly: boolean) => void;
}

export function InstalledFilter({
  showInstalledOnly,
  onShowInstalledOnlyChange,
}: Readonly<InstalledFilterProps>) {
  const { t } = useTranslation("library");

  const tooltipId = useId();

  return (
    <>
      <button
        type="button"
        className="library-installed-filter__button"
        onClick={() => onShowInstalledOnlyChange(!showInstalledOnly)}
        aria-label={t("show_installed_only")}
        aria-pressed={showInstalledOnly}
        data-tooltip-id={tooltipId}
        data-tooltip-content={t("show_installed_only")}
        data-tooltip-place="bottom"
      >
        {showInstalledOnly ? (
          <Icon name="check-circle-fill" size={16} />
        ) : (
          <Icon name="check-circle" size={16} />
        )}
      </button>

      {createPortal(
        <Tooltip id={tooltipId} place="bottom" style={{ zIndex: 1 }} />,
        document.body
      )}
    </>
  );
}
