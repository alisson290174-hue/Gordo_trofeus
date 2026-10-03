import {
  AchievementCustomNotificationPosition,
  AchievementNotificationInfo,
} from "@types";
import cn from "classnames";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { getAchievementTier } from "@shared";
import "./achievement-notification.scss";

interface AchievementNotificationProps {
  position: AchievementCustomNotificationPosition;
  achievement: AchievementNotificationInfo;
  isClosing: boolean;
  isPaused?: boolean;
}

// Sparkle specks around the medal for gold/platinum (px offsets inside the card).
const SPARKS = [
  { x: 24, y: 10, size: 3, opacity: 0.9 },
  { x: 96, y: 14, size: 2, opacity: 0.7 },
  { x: 14, y: 86, size: 2, opacity: 0.6 },
  { x: 102, y: 92, size: 3, opacity: 0.8 },
  { x: 290, y: 12, size: 2, opacity: 0.5 },
  { x: 60, y: 4, size: 2, opacity: 0.6 },
];

function TrophyCupGlyph() {
  return (
    <svg
      className="achievement-notification__cup"
      viewBox="0 0 24 24"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 4h10v4.5a5 5 0 0 1-10 0V4z" />
      <path d="M7 5.5H4.5V7a3 3 0 0 0 3 3" fill="none" />
      <path d="M17 5.5h2.5V7a3 3 0 0 1-3 3" fill="none" />
      <path d="M12 13.5v3" fill="none" />
      <path d="M9.5 16.5h5v3h-5z" />
      <path d="M8 20h8" fill="none" />
    </svg>
  );
}

/**
 * In-game trophy toast (design "Opus — Notificação de troféu"): a metallic tier medal is the
 * hero, the achievement art is a small thumbnail next to its name, and a thin bar drains while
 * the toast is on screen.
 */
export function AchievementNotificationItem({
  position,
  achievement,
  isClosing,
  isPaused = false,
}: Readonly<AchievementNotificationProps>) {
  const { t, i18n } = useTranslation("dashboard");
  const [artFailed, setArtFailed] = useState(false);

  const tier = getAchievementTier({
    isPlatinum: achievement.isPlatinum,
    globalUnlockPercent: achievement.globalUnlockPercent,
  });

  const isShowpiece = tier === "gold" || tier === "platinum";
  const tierLabel = t(`notification_tier_${tier}`);
  const eyebrow = achievement.isHidden
    ? `${t("notification_hidden")} · ${t(`tier_${tier}`)}`
    : tierLabel;

  const percent =
    achievement.globalUnlockPercent == null
      ? null
      : `${new Intl.NumberFormat(i18n.language, {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        }).format(achievement.globalUnlockPercent)}%`;

  return (
    <div
      className={cn("achievement-notification", {
        [`achievement-notification--${position}`]: true,
        "achievement-notification--bottom": position.startsWith("bottom"),
        "achievement-notification--closing": isClosing,
        "achievement-notification--paused": isPaused,
        [`achievement-notification--${tier}`]: true,
      })}
    >
      <div className="achievement-notification__card">
        <div className="achievement-notification__halo" />

        {isShowpiece &&
          SPARKS.map((spark, index) => (
            <span
              key={index}
              className="achievement-notification__spark"
              style={{
                left: spark.x,
                top: spark.y,
                width: spark.size,
                height: spark.size,
                opacity: spark.opacity,
              }}
            />
          ))}

        <div className="achievement-notification__medal-wrap">
          {isShowpiece && <div className="achievement-notification__rays" />}
          <div className="achievement-notification__medal">
            <span className="achievement-notification__medal-ring" />
            <span className="achievement-notification__medal-shine" />
            <TrophyCupGlyph />
          </div>
        </div>

        <div className="achievement-notification__text">
          <div className="achievement-notification__eyebrow-row">
            {achievement.isHidden && (
              <svg
                className="achievement-notification__hidden-icon"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
            <span className="achievement-notification__eyebrow">{eyebrow}</span>
            {percent && (
              <span className="achievement-notification__percent">
                {percent}
              </span>
            )}
          </div>

          <div className="achievement-notification__title-row">
            {achievement.iconUrl && !artFailed ? (
              <img
                className="achievement-notification__art"
                src={achievement.iconUrl}
                alt=""
                onError={() => setArtFailed(true)}
              />
            ) : (
              <span className="achievement-notification__art achievement-notification__art--empty" />
            )}
            <p className="achievement-notification__title">
              {achievement.title}
            </p>
          </div>

          {achievement.description && (
            <p className="achievement-notification__description">
              {achievement.description}
            </p>
          )}
        </div>

        <div className="achievement-notification__timer">
          <span className="achievement-notification__timer-fill" />
        </div>
      </div>
    </div>
  );
}
