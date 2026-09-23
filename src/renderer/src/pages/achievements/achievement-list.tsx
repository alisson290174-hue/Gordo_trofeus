import { useDate } from "@renderer/hooks";
import { Icon } from "@renderer/components/icon/icon";
import type { UserAchievement } from "@types";
import { useTranslation } from "react-i18next";
import { getAchievementTier } from "@shared";
import TierBadgePlatinum from "@renderer/assets/achievements/tier-badge-platinum.png";
import TierBadgeGold from "@renderer/assets/achievements/tier-badge-gold.png";
import TierBadgeSilver from "@renderer/assets/achievements/tier-badge-silver.png";
import TierBadgeBronze from "@renderer/assets/achievements/tier-badge-bronze.png";
import "./achievements.scss";

import { useState } from "react";
import { FullscreenMediaModal } from "@renderer/components";

const TIER_BADGES = {
  platinum: TierBadgePlatinum,
  gold: TierBadgeGold,
  silver: TierBadgeSilver,
  bronze: TierBadgeBronze,
};

interface AchievementListProps {
  achievements: UserAchievement[];
}

export function AchievementList({
  achievements,
}: Readonly<AchievementListProps>) {
  const { t } = useTranslation("achievement");
  const { formatDateTime } = useDate();

  const [souvenir, setSouvenir] = useState<{
    src: string;
    alt: string;
  } | null>(null);

  return (
    <ul className="achievements__list">
      {achievements.map((achievement) => {
        const tier = achievement.unlocked
          ? getAchievementTier({
              isPlatinum: false,
              globalUnlockPercent: achievement.globalUnlockPercent,
            })
          : null;

        return (
          <li
            key={achievement.name}
            className={`achievements__item ${tier ? `achievements__item--${tier}` : ""}`}
          >
            <div className="achievements__item-icon-wrapper">
              <img
                className={`achievements__item-image ${!achievement.unlocked ? "achievements__item-image--locked" : ""}`}
                src={achievement.icon}
                alt={achievement.displayName}
                loading="lazy"
              />

              {tier && (
                <img
                  className="achievements__item-tier-badge"
                  src={TIER_BADGES[tier]}
                  alt=""
                />
              )}
            </div>

            <div className="achievements__item-content">
              <h4 className="achievements__item-title">
                {achievement.hidden && (
                  <span
                    className="achievements__item-hidden-icon"
                    title={t("hidden_achievement_tooltip")}
                  >
                    <Icon name="eye-closed" size={12} />
                  </span>
                )}
                {achievement.displayName}
                {achievement.hardcoreUnlockTime != null && (
                  <span
                    className="achievements__item-hardcore-badge"
                    title={t("hardcore_unlocked_at", {
                      date: formatDateTime(achievement.hardcoreUnlockTime),
                    })}
                  >
                    {t("hardcore")}
                  </span>
                )}
              </h4>
              <p>{achievement.description}</p>
            </div>

            <div className="achievements__item-meta">
              {achievement.unlocked && achievement.imageUrl && (
                <button
                  type="button"
                  className="achievements__item-souvenir"
                  onClick={() =>
                    setSouvenir({
                      src: achievement.imageUrl!,
                      alt: t("souvenir_alt", {
                        achievement: achievement.displayName,
                      }),
                    })
                  }
                  title={t("view_souvenir")}
                >
                  <img
                    className="achievements__item-souvenir-image"
                    src={achievement.imageUrl}
                    alt={t("souvenir_alt", {
                      achievement: achievement.displayName,
                    })}
                    loading="lazy"
                  />

                  <span className="achievements__item-souvenir-overlay">
                    <Icon name="search" size={20} />
                  </span>
                </button>
              )}

              <div className="achievements__item-meta-details">
                {achievement.unlockTime != null && (
                  <div
                    className="achievements__item-unlock-time"
                    title={t("unlocked_at", {
                      date: formatDateTime(achievement.unlockTime),
                    })}
                  >
                    <small>{formatDateTime(achievement.unlockTime)}</small>
                  </div>
                )}
              </div>
            </div>
          </li>
        );
      })}

      <FullscreenMediaModal
        visible={souvenir !== null}
        src={souvenir?.src}
        alt={souvenir?.alt}
        upscale
        onClose={() => setSouvenir(null)}
      />
    </ul>
  );
}
