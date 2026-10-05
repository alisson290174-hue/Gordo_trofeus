import { useTranslation } from "react-i18next";
import { Icon } from "@renderer/components/icon/icon";
import cn from "classnames";

import { useAppDispatch, useAppSelector } from "@renderer/hooks";
import { setMode } from "@renderer/features";
import { ClassicsIcon } from "@renderer/pages/library/category-filter";

import "./catalogue-mode-toggle.scss";

export function CatalogueModeToggle() {
  const { t } = useTranslation("catalogue");
  const dispatch = useAppDispatch();
  const mode = useAppSelector((state) => state.catalogueSearch.mode);

  return (
    <div className="catalogue-mode-toggle" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={mode === "modern"}
        className={cn("catalogue-mode-toggle__option", {
          "catalogue-mode-toggle__option--active": mode === "modern",
        })}
        onClick={() => dispatch(setMode("modern"))}
      >
        <Icon name="device-desktop" size={14} />
        <span>{t("mode_modern_games")}</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "classics"}
        className={cn("catalogue-mode-toggle__option", {
          "catalogue-mode-toggle__option--active": mode === "classics",
        })}
        onClick={() => dispatch(setMode("classics"))}
      >
        <ClassicsIcon size={16} />
        <span>{t("mode_classics")}</span>
      </button>
    </div>
  );
}
