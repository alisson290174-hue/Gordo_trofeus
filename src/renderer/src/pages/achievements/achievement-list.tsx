import { useDate } from "@renderer/hooks";
import { Icon } from "@renderer/components/icon/icon";
import type { UserAchievement } from "@types";
import { useTranslation } from "react-i18next";
import { getAchievementTier } from "@shared";
import "./achievements.scss";

import { useState } from "react";
import { FullscreenMediaModal, Img, TrophyCup } from "@renderer/components";
import { getTierFallbackIconUrl } from "@renderer/helpers/achievement-fallback-icon";
import { getAchievementRarity } from "@renderer/helpers/achievement-rarity";

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
    <ul className="ach-list">
      {achievements.map((achievement) => {
        const tier = getAchievementTier({
          isPlatinum: false,
          globalUnlockPercent: achievement.globalUnlockPercent,
        });
        const rarity = getAchievementRarity(achievement.globalUnlockPercent);
        const percent = achievement.globalUnlockPercent;
        // The rarity bar shows how many players own it — a rarer trophy reads as a shorter bar.
        const barWidth =
          percent == null ? 100 : Math.max(4, Math.min(100, percent));

        return (
          <li
            key={achievement.name}
            className={`ach ach--${tier}${achievement.unlocked ? "" : " ach--locked"}`}
          >
            <div className="ach__icon">
              <Img
                className="ach__art"
                src={achievement.icon}
                fallback={getTierFallbackIconUrl(
                  false,
                  achievement.globalUnlockPercent
                )}
                alt={achievement.displayName}
                loading="lazy"
              />
              {!achievement.unlocked && (
                <span className="ach__lock">
                  <Icon name="lock" size={20} />
                </span>
              )}
              <TrophyCup tier={tier} className="ach__cup" />
            </div>

            <div className="ach__body">
              <h4 className="ach__name">
                {achievement.hidden && (
                  <span
                    className="ach__hidden"
                    title={t("hidden_achievement_tooltip")}
                  >
                    <Icon name="eye-closed" size={12} />
                  </span>
                )}
                {achievement.displayName}
                {achievement.hardcoreUnlockTime != null && (
                  <span
                    className="ach__hardcore"
                    title={t("hardcore_unlocked_at", {
                      date: formatDateTime(achievement.hardcoreUnlockTime),
                    })}
                  >
                    {t("hardcore")}
                  </span>
                )}
              </h4>
              <p className="ach__desc">{achievement.description}</p>
              <div className="ach__rarity">
                <span className="ach__rbar">
                  <i style={{ width: `${barWidth}%` }} />
                </span>
                <span className="ach__rtag">
                  {t(`rarity_${rarity}`)}
                  {percent != null && ` · ${percent.toFixed(1)}%`}
                </span>
              </div>
            </div>

            <div className="ach__meta">
              {achievement.unlocked && achievement.imageUrl && (
                <button
                  type="button"
                  className="ach__souvenir"
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
                    src={achievement.imageUrl}
                    alt={t("souvenir_alt", {
                      achievement: achievement.displayName,
                    })}
                    loading="lazy"
                    onError={(event) => {
                      event.currentTarget.style.display = "none";
                    }}
                  />
                  <span className="ach__souvenir-overlay">
                    <Icon name="search" size={20} />
                  </span>
                </button>
              )}

              {achievement.unlocked && achievement.unlockTime != null ? (
                <span
                  className="ach__date"
                  title={t("unlocked_at", {
                    date: formatDateTime(achievement.unlockTime),
                  })}
                >
                  {formatDateTime(achievement.unlockTime)}
                </span>
              ) : (
                <span className="ach__status">
                  <Icon name="lock" size={12} />
                  {t("locked_label")}
                </span>
              )}
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
