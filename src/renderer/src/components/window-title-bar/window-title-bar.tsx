
import type { CSSProperties } from "react";
import { Icon } from "@renderer/components/icon/icon";
import { useTranslation } from "react-i18next";

import {
  CUSTOM_WINDOW_TITLE_BAR_HEIGHT,
  WINDOW_TITLE_BAR_CONTROL_WIDTH,
  WINDOW_TITLE_BAR_TRANSITION_DURATION_MS,
} from "@shared";
import AppIcon from "@renderer/assets/icons/app-icon-refresh.png";
import "./window-title-bar.scss";

const titleBarStyle = {
  "--window-title-bar-height": `${CUSTOM_WINDOW_TITLE_BAR_HEIGHT}px`,
  "--window-title-bar-control-width": `${WINDOW_TITLE_BAR_CONTROL_WIDTH}px`,
  "--window-title-bar-transition-duration": `${WINDOW_TITLE_BAR_TRANSITION_DURATION_MS}ms`,
} as CSSProperties;

interface WindowTitleBarProps {
  onMinimize: () => void;
  onClose: () => void;
}

export function WindowTitleBar({
  onMinimize,
  onClose,
}: Readonly<WindowTitleBarProps>) {
  const { t } = useTranslation("header");

  return (
    <header className="window-title-bar" style={titleBarStyle}>
      <img src={AppIcon} alt="" className="window-title-bar__icon" />
      <h4>Opus</h4>
      <div className="window-title-bar__controls">
        <button
          type="button"
          className="window-title-bar__control"
          onClick={onMinimize}
          title={t("minimize")}
          aria-label={t("minimize")}
        >
          <Icon name="dash" size={16} />
        </button>
        <button
          type="button"
          className="window-title-bar__control window-title-bar__control--close"
          onClick={onClose}
          title={t("close")}
          aria-label={t("close")}
        >
          <Icon name="x" size={16} />
        </button>
      </div>
    </header>
  );
}
