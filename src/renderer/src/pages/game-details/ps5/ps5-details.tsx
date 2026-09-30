import { useContext, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  formatBytes,
  getAchievementTier,
  getDisplayedPlayTimeInMilliseconds,
} from "@shared";
import type { UserAchievement } from "@types";
import { gameDetailsContext } from "@renderer/context";
import { Icon } from "@renderer/components/icon/icon";
import {
  formatHours,
  formatLastPlayed,
  getRarityTone,
  getGenreNames,
} from "@renderer/helpers/ps5-game";
import TierBadgePlatinum from "@renderer/assets/achievements/tier-badge-platinum.png";
import TierBadgeGold from "@renderer/assets/achievements/tier-badge-gold.png";
import TierBadgeSilver from "@renderer/assets/achievements/tier-badge-silver.png";
import TierBadgeBronze from "@renderer/assets/achievements/tier-badge-bronze.png";
import TierRingPlatinum from "@renderer/assets/achievements/tier-ring-platinum.png";
import TierRingGold from "@renderer/assets/achievements/tier-ring-gold.png";
import TierRingSilver from "@renderer/assets/achievements/tier-ring-silver.png";
import TierRingBronze from "@renderer/assets/achievements/tier-ring-bronze.png";
import "./ps5-details.scss";

export type AchievementTier = "platinum" | "gold" | "silver" | "bronze";

export const TIER_BADGES: Record<AchievementTier, string> = {
  platinum: TierBadgePlatinum,
  gold: TierBadgeGold,
  silver: TierBadgeSilver,
  bronze: TierBadgeBronze,
};

export const TIER_RINGS: Record<AchievementTier, string> = {
  platinum: TierRingPlatinum,
  gold: TierRingGold,
  silver: TierRingSilver,
  bronze: TierRingBronze,
};

export const TIER_COLORS: Record<AchievementTier, string> = {
  platinum: "#cfe6ea",
  gold: "#f4b43a",
  silver: "#c0c5ce",
  bronze: "#c9854a",
};

export const tierOf = (achievement: UserAchievement): AchievementTier =>
  getAchievementTier({
    isPlatinum: false,
    globalUnlockPercent: achievement.globalUnlockPercent,
  });

export interface TierCounts {
  earned: Record<AchievementTier, number>;
  total: Record<AchievementTier, number>;
  unlocked: number;
  count: number;
  percent: number;
  isPlatinum: boolean;
}

export const countTiers = (achievements: UserAchievement[]): TierCounts => {
  const earned = { platinum: 0, gold: 0, silver: 0, bronze: 0 };
  const total = { platinum: 0, gold: 0, silver: 0, bronze: 0 };

  for (const achievement of achievements) {
    const tier = tierOf(achievement);
    total[tier] += 1;
    if (achievement.unlocked) earned[tier] += 1;
  }

  const count = achievements.length;
  const unlocked = earned.gold + earned.silver + earned.bronze;
  const isPlatinum = count > 0 && unlocked === count;

  total.platinum = count > 0 ? 1 : 0;
  earned.platinum = isPlatinum ? 1 : 0;

  return {
    earned,
    total,
    unlocked,
    count,
    percent: count > 0 ? Math.round((unlocked / count) * 100) : 0,
    isPlatinum,
  };
};

/** Round art with the tier ring when earned; greyed with a lock when not. */
export function TrophyArt({
  achievement,
  tier,
  size = 46,
}: Readonly<{
  achievement: UserAchievement;
  tier: AchievementTier;
  size?: number;
}>) {
  const [failed, setFailed] = useState(false);
  const src = achievement.unlocked
    ? achievement.imageUrl || achievement.icon
    : achievement.icongray || achievement.icon;

  return (
    <div
      className={`ps5-trophy-art ${achievement.unlocked ? "" : "ps5-trophy-art--locked"}`}
      style={{ width: size, height: size }}
    >
      {src && !failed ? (
        <img
          className="ps5-trophy-art__img"
          src={src}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : tier === "platinum" ? (
        <img className="ps5-trophy-art__badge" src={TierBadgePlatinum} alt="" />
      ) : (
        <Icon
          name="trophy"
          size={Math.round(size * 0.48)}
          style={{
            color: achievement.unlocked
              ? TIER_COLORS[tier]
              : "rgba(120,135,165,0.55)",
          }}
        />
      )}
      {achievement.unlocked && (
        <img className="ps5-trophy-art__ring" src={TIER_RINGS[tier]} alt="" />
      )}
      {!achievement.unlocked && (
        <span className="ps5-trophy-art__lock">
          <Icon name="lock" size={12} />
        </span>
      )}
    </div>
  );
}

export function RarityLabel({
  percent,
}: Readonly<{ percent: number | null | undefined }>) {
  const { t, i18n } = useTranslation("dashboard");
  const { tone, color } = getRarityTone(percent);

  return (
    <div className="ps5-rarity">
      <span className="ps5-rarity__pct">
        {percent == null
          ? "—"
          : `${new Intl.NumberFormat(i18n.language, {
              maximumFractionDigits: 1,
              minimumFractionDigits: 1,
            }).format(percent)}%`}
      </span>
      <span className="ps5-rarity__label" style={{ color }}>
        {t(`rarity_${tone}`)}
      </span>
    </div>
  );
}

export function TierCountsRow({
  counts,
  size = 20,
}: Readonly<{ counts: TierCounts; size?: number }>) {
  const tiers: AchievementTier[] = ["platinum", "gold", "silver", "bronze"];

  return (
    <div className="ps5-tier-counts">
      {tiers
        // A tier the game doesn't have ("Ouro 0/0") is just noise.
        .filter((tier) => tier === "platinum" || counts.total[tier] > 0)
        .map((tier) => (
          <div
            key={tier}
            className="ps5-tier-counts__item"
            style={{
              opacity: tier === "platinum" && !counts.isPlatinum ? 0.35 : 1,
            }}
          >
            <img
              src={TIER_BADGES[tier]}
              alt=""
              style={{ width: size, height: size }}
            />
            <span>
              {counts.earned[tier]}/{counts.total[tier]}
            </span>
          </div>
        ))}
    </div>
  );
}

/** Glass stat pills under the hero buttons (Tempo de jogo · Última sessão · Troféus · Progresso). */
export function Ps5HeroStats() {
  const { t, i18n } = useTranslation("dashboard");
  const { game, isGameRunning, achievements } = useContext(gameDetailsContext);

  const counts = useMemo(
    () => (achievements?.length ? countTiers(achievements) : null),
    [achievements]
  );

  if (!game) return null;

  const stats: { key: string; label: string; value: string }[] = [
    isGameRunning
      ? { key: "status", label: t("status"), value: t("playing_now") }
      : {
          key: "playtime",
          label: t("playtime"),
          value: formatHours(
            getDisplayedPlayTimeInMilliseconds(game),
            i18n.language
          ),
        },
    {
      key: "last",
      label: t("last_session"),
      value:
        formatLastPlayed(game.lastTimePlayed, i18n.language) ??
        t("never_played"),
    },
  ];

  if (counts) {
    stats.push(
      {
        key: "trophies",
        label: t("trophies_title"),
        value: `${counts.unlocked + counts.earned.platinum}/${counts.count + 1}`,
      },
      { key: "progress", label: t("progress"), value: `${counts.percent}%` }
    );
  }

  return (
    <div className="ps5-hero-stats">
      {stats.map((stat) => (
        <div key={stat.key} className="ps5-hero-stats__item">
          <span className="ps5-hero-stats__label">{stat.label}</span>
          <span className="ps5-hero-stats__value">{stat.value}</span>
        </div>
      ))}
    </div>
  );
}

/** "Troféus" card: big %, bar, tier counts, 5-trophy preview, "Ver todos os troféus". */
export function Ps5TrophiesCard() {
  const { t } = useTranslation("dashboard");
  const navigate = useNavigate();
  const { achievements, shop, objectId } = useContext(gameDetailsContext);

  const counts = useMemo(
    () => (achievements?.length ? countTiers(achievements) : null),
    [achievements]
  );

  const preview = useMemo(
    () =>
      [...(achievements ?? [])]
        .sort(
          (a, b) =>
            Number(b.unlocked) - Number(a.unlocked) ||
            (a.globalUnlockPercent ?? 100) - (b.globalUnlockPercent ?? 100)
        )
        .slice(0, 5),
    [achievements]
  );

  if (!counts || !objectId) return null;

  return (
    <div className="ps5-card-box ps5-trophies-card">
      <div className="ps5-trophies-card__top">
        <div className="ps5-trophies-card__pct-block">
          <span className="ps5-eyebrow">{t("trophies_title")}</span>
          <span className="ps5-trophies-card__pct">{counts.percent}%</span>
        </div>
        <div className="ps5-trophies-card__right">
          <div className="ps5-bar ps5-bar--4">
            <span style={{ width: `${counts.percent}%` }} />
          </div>
          <TierCountsRow counts={counts} />
        </div>
      </div>

      <div className="ps5-trophies-card__list">
        {preview.map((achievement) => {
          const tier = tierOf(achievement);
          return (
            <div
              key={achievement.name}
              className="ps5-trophies-card__row"
              style={{ opacity: achievement.unlocked ? 1 : 0.5 }}
            >
              <TrophyArt achievement={achievement} tier={tier} />
              <div className="ps5-trophies-card__text">
                <span className="ps5-trophies-card__name">
                  {achievement.displayName}
                </span>
                <span className="ps5-trophies-card__desc">
                  {achievement.description ?? ""}
                </span>
              </div>
              <RarityLabel percent={achievement.globalUnlockPercent} />
            </div>
          );
        })}
      </div>

      <button
        type="button"
        className="ps5-outline-pill"
        onClick={() =>
          navigate(
            `/trophies?${new URLSearchParams({ shop, objectId }).toString()}`
          )
        }
      >
        <span>{t("see_all_trophies")}</span>
        <Icon name="chevron-right" size={14} />
      </button>
    </div>
  );
}

/** "Informações" card: developer, release, genre, size, platform. */
export function Ps5InfoCard() {
  const { t } = useTranslation("dashboard");
  const { game, shopDetails, shop } = useContext(gameDetailsContext);

  const size = game?.installedSizeInBytes ?? game?.installerSizeInBytes ?? null;

  const rows = [
    { k: t("developer"), v: shopDetails?.developers?.join(", ") },
    {
      k: t("publisher"),
      v:
        shopDetails?.publishers?.[0] &&
        shopDetails.publishers[0] !== shopDetails.developers?.[0]
          ? shopDetails.publishers[0]
          : null,
    },
    { k: t("release"), v: shopDetails?.release_date?.date },
    {
      k: t("genre"),
      v: getGenreNames(shopDetails?.genres).slice(0, 3).join(", "),
    },
    { k: t("size"), v: size ? formatBytes(size) : null },
    {
      k: t("platform"),
      v:
        shop === "launchbox"
          ? (game?.platform ?? shopDetails?.platform ?? null)
          : shop === "steam"
            ? "PC · Steam"
            : "PC",
    },
  ].filter((row) => row.v);

  if (rows.length === 0) return null;

  return (
    <div className="ps5-card-box ps5-info-card">
      <span className="ps5-eyebrow ps5-eyebrow--strong">
        {t("information")}
      </span>
      {rows.map((row) => (
        <div key={row.k} className="ps5-info-card__row">
          <span className="ps5-info-card__key">{row.k}</span>
          <span className="ps5-info-card__value">{row.v}</span>
        </div>
      ))}
    </div>
  );
}
