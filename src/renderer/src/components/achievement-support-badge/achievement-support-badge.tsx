import { useTranslation } from "react-i18next";
import type { AchievementSupport } from "@types";
import { Icon } from "../icon/icon";
import "./achievement-support-badge.scss";

interface AchievementSupportBadgeProps {
  support: AchievementSupport | undefined;
  /** `chip` (default) shows icon + label; `dot` shows only the coloured icon (for dense cards). */
  variant?: "chip" | "dot";
  size?: number;
}

// Only "unknown" (not installed / not scanned yet) carries no signal, so it's the one state that
// renders nothing — every installed game shows a clear platinum-readiness badge.
const VISIBLE: Record<
  AchievementSupport,
  { tone: string; icon: string; labelKey: string } | null
> = {
  working: { tone: "working", icon: "trophy", labelKey: "achievement_support_working" },
  supported: {
    tone: "ready",
    icon: "trophy",
    labelKey: "achievement_support_supported",
  },
  not_writing: {
    tone: "warning",
    icon: "alert-fill",
    labelKey: "achievement_support_not_writing",
  },
  unsupported: {
    tone: "muted",
    icon: "no-entry",
    labelKey: "achievement_support_unsupported",
  },
  unknown: null,
};

export function AchievementSupportBadge({
  support,
  variant = "chip",
  size = 12,
}: Readonly<AchievementSupportBadgeProps>) {
  const { t } = useTranslation("library");

  const config = support ? VISIBLE[support] : null;
  if (!config) return null;

  const label = t(config.labelKey);

  return (
    <div
      className={`achievement-support-badge achievement-support-badge--${config.tone} achievement-support-badge--${variant}`}
      title={label}
    >
      <Icon name={config.icon} size={size} />
      {variant === "chip" && (
        <span className="achievement-support-badge__label">{label}</span>
      )}
    </div>
  );
}
