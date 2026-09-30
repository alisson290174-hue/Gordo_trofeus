import { useCallback, useContext } from "react";
import { Icon } from "@renderer/components/icon/icon";
import { userProfileContext } from "@renderer/context";
import { useTranslation } from "react-i18next";
import { useFormat, useUserDetails } from "@renderer/hooks";
import { MAX_MINUTES_TO_SHOW_IN_PLAYTIME } from "@renderer/constants";
import { useSubscription } from "@renderer/hooks/use-subscription";

import KarmaLevelRingBg from "@renderer/assets/profile/karma-level-ring-bg.png";
import TierBadgePlatinum from "@renderer/assets/achievements/tier-badge-platinum.png";
import "./user-stats-box.scss";

const KARMA_PER_LEVEL = 100;
const RING_RADIUS = 17;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const getKarmaLevel = (karma: number) => ({
  level: Math.floor(karma / KARMA_PER_LEVEL),
  progress: (karma % KARMA_PER_LEVEL) / KARMA_PER_LEVEL,
});

function KarmaLevelRing({ karma }: Readonly<{ karma: number }>) {
  const { level, progress } = getKarmaLevel(karma);

  return (
    <span className="user-stats__karma-ring">
      <img src={KarmaLevelRingBg} alt="" className="user-stats__karma-ring__bg" />
      <svg viewBox="0 0 40 40" className="user-stats__karma-ring__progress">
        <circle
          cx="20"
          cy="20"
          r={RING_RADIUS}
          fill="none"
          stroke="#0070f3"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={`${progress * RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`}
          transform="rotate(-90 20 20)"
        />
      </svg>
      <span className="user-stats__karma-ring__level">{level}</span>
    </span>
  );
}

export function UserStatsBox() {
  const { showHydraCloudModal } = useSubscription();
  const { userStats, isMe, userProfile } = useContext(userProfileContext);
  const { userDetails } = useUserDetails();
  const { t } = useTranslation("user_profile");
  const { numberFormatter } = useFormat();

  const formatPlayTime = useCallback(
    (playTimeInSeconds: number) => {
      const seconds = playTimeInSeconds;
      const minutes = seconds / 60;

      if (minutes < MAX_MINUTES_TO_SHOW_IN_PLAYTIME) {
        return t("amount_minutes", {
          amount: minutes.toFixed(0),
        });
      }

      const hours = minutes / 60;
      return t("amount_hours", { amount: numberFormatter.format(hours) });
    },
    [numberFormatter, t]
  );

  if (!userStats) return null;

  const karma = isMe ? userDetails?.karma : userProfile?.karma;
  const hasKarma = karma !== undefined && karma !== null;

  return (
    <div className="user-stats__box">
      <ul className="user-stats__list">
        {(isMe || userStats.unlockedAchievementSum !== undefined) && (
          <li className="user-stats__list-item">
            <h3 className="user-stats__list-title">
              {t("achievements_unlocked")}
            </h3>
            {userStats.unlockedAchievementSum !== undefined ? (
              <div className="user-stats__stats-row">
                <p className="user-stats__list-description">
                  <Icon name="trophy"  /> {userStats.unlockedAchievementSum}{" "}
                  {t("achievements")}
                </p>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => showHydraCloudModal("achievements")}
                className="user-stats__link"
              >
                <small className="user-stats__link--warning">
                  {t("show_achievements_on_profile")}
                </small>
              </button>
            )}
          </li>
        )}

        {userStats.platinumCount !== undefined && userStats.platinumCount > 0 && (
          <li className="user-stats__list-item">
            <h3 className="user-stats__list-title">{t("platinums_earned")}</h3>
            <div className="user-stats__stats-row">
              <p className="user-stats__list-description">
                <img
                  src={TierBadgePlatinum}
                  alt=""
                  className="user-stats__platinum-icon"
                />{" "}
                {userStats.platinumCount} {t("platinums")}
              </p>
            </div>
          </li>
        )}

        <li className="user-stats__list-item">
          <h3 className="user-stats__list-title">{t("total_play_time")}</h3>
          <div className="user-stats__stats-row">
            <p className="user-stats__list-description">
              <Icon name="hourglass"  />
              {formatPlayTime(userStats.totalPlayTimeInSeconds.value)}
            </p>
            <p title={t("ranking_updated_weekly")}>
              {t("top_percentile", {
                percentile: userStats.totalPlayTimeInSeconds.topPercentile,
              })}
            </p>
          </div>
        </li>

        {hasKarma && karma !== undefined && karma !== null && (
          <li className="user-stats__list-item user-stats__list-item--karma">
            <h3 className="user-stats__list-title">{t("karma")}</h3>
            <div className="user-stats__stats-row">
              <p className="user-stats__list-description">
                <KarmaLevelRing karma={karma} />
                {numberFormatter.format(karma)} {t("karma_count")}
              </p>
            </div>
          </li>
        )}
      </ul>
    </div>
  );
}
