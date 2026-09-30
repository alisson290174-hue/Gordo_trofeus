import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import cn from "classnames";
import type { ProfileSouvenir, UserFriend, UserGame } from "@types";
import { Icon } from "@renderer/components/icon/icon";
import { buildGameDetailsPath } from "@renderer/helpers";
import {
  computeTrophyLevel,
  formatHours,
  getCoverArt,
  toUnlockDate,
  type TrophySummary,
} from "@renderer/helpers/ps5-game";
import TierBadgePlatinum from "@renderer/assets/achievements/tier-badge-platinum.png";
import TierBadgeGold from "@renderer/assets/achievements/tier-badge-gold.png";
import TierBadgeSilver from "@renderer/assets/achievements/tier-badge-silver.png";
import TierBadgeBronze from "@renderer/assets/achievements/tier-badge-bronze.png";
import "./profile-ps5.scss";

export const TIER_BADGE_IMAGES = {
  platinum: TierBadgePlatinum,
  gold: TierBadgeGold,
  silver: TierBadgeSilver,
  bronze: TierBadgeBronze,
} as const;

const TIERS = ["platinum", "gold", "silver", "bronze"] as const;

const formatShortDate = (date: Date | null, language: string) =>
  date
    ? new Intl.DateTimeFormat(language, {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(date)
    : null;

/** Level emblem + total + the four tier counts (the profile's "identity card"). */
export function ProfileTrophyBand({
  summary,
}: Readonly<{ summary: TrophySummary | null }>) {
  const { t } = useTranslation("dashboard");
  const counts = summary?.counts;
  const { level, progress } = computeTrophyLevel(
    counts ?? { platinum: 0, gold: 0, silver: 0, bronze: 0 }
  );
  const emblem = level >= 300 ? "gold" : level >= 100 ? "silver" : "bronze";
  const percent = Math.round(progress * 100);

  return (
    <div className="pf-band">
      <div className="pf-band__level">
        <div className={cn("pf-band__emblem", `pf-band__emblem--${emblem}`)}>
          <span className="pf-band__emblem-ring" />
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 2.5l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.3l-5.8 3.1 1.1-6.5L2.6 9.3l6.5-.9z" />
          </svg>
          <span className="pf-band__emblem-number">{level}</span>
        </div>
        <div className="pf-band__level-text">
          <span className="pf-eyebrow">{t("trophy_level")}</span>
          <span className="pf-band__level-title">
            {t("level_n", { level })}
          </span>
          <div className="pf-band__bar">
            <span style={{ width: `${percent}%` }} />
          </div>
          <span className="pf-band__hint">
            {t("level_progress", { percent, level: level + 1 })}
          </span>
        </div>
      </div>

      <div className="pf-band__divider" />

      <div className="pf-band__total">
        <span className="pf-eyebrow">{t("total")}</span>
        <span className="pf-band__total-value">{counts?.total ?? "—"}</span>
      </div>

      <div className="pf-band__tiers">
        {TIERS.map((tier) => {
          const value =
            tier === "platinum" || summary?.hasTiers
              ? (counts?.[tier] ?? "—")
              : "—";
          return (
            <div
              key={tier}
              className={cn("pf-band__tier", {
                "pf-band__tier--platinum": tier === "platinum",
              })}
            >
              <img src={TIER_BADGE_IMAGES[tier]} alt="" />
              <div className="pf-band__tier-text">
                <span className={`pf-band__tier-label pf-tier-${tier}`}>
                  {t(`tier_${tier}`)}
                </span>
                <span className="pf-band__tier-value">{value}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export interface ActivityItem {
  key: string;
  kind: "platinum" | "trophies" | "played" | "souvenir";
  title: string;
  detail?: string;
  date: Date;
  path?: string;
}

/** Resolves a display title for a game (the server sends disc serials for classics). */
export type TitleResolver = (
  shop: string,
  objectId: string,
  fallback: string | null
) => string | null;

const identityTitle: TitleResolver = (_shop, _objectId, fallback) => fallback;

export const buildActivity = (
  summary: TrophySummary | null,
  recentGames: UserGame[],
  souvenirs: ProfileSouvenir[],
  resolveTitle: TitleResolver = identityTitle
): ActivityItem[] => {
  const items: ActivityItem[] = [];

  for (const game of summary?.games ?? []) {
    const path = buildGameDetailsPath(game);
    const platinumAt = toUnlockDate(game.platinumAt);
    if (platinumAt) {
      items.push({ key: `plat-${game.shop}-${game.objectId}`, kind: "platinum", title: resolveTitle(game.shop, game.objectId, game.title) ?? game.title, date: platinumAt, path });
    } else {
      const last = toUnlockDate(game.lastUnlockAt);
      if (last) {
        items.push({
          key: `tr-${game.shop}-${game.objectId}`,
          kind: "trophies",
          title: resolveTitle(game.shop, game.objectId, game.title) ?? game.title,
          detail: `${game.unlockedAchievementCount}/${game.achievementCount}`,
          date: last,
          path,
        });
      }
    }
  }

  for (const game of recentGames) {
    if (!game.lastTimePlayed) continue;
    items.push({
      key: `play-${game.shop}-${game.objectId}`,
      kind: "played",
      title: resolveTitle(game.shop, game.objectId, game.title) ?? game.title,
      date: new Date(game.lastTimePlayed),
      path: buildGameDetailsPath(game),
    });
  }

  for (const souvenir of souvenirs) {
    const title = resolveTitle(souvenir.shop, souvenir.objectId, souvenir.gameTitle);
    if (!souvenir.capturedAt || !title) continue;
    items.push({
      key: `sv-${souvenir.id}`,
      kind: "souvenir",
      title,
      date: toUnlockDate(souvenir.capturedAt) ?? new Date(souvenir.capturedAt),
    });
  }

  return items
    .filter((item) => !Number.isNaN(item.date.getTime()))
    .sort((a, b) => b.date.getTime() - a.date.getTime());
};

const ACTIVITY_ICON: Record<ActivityItem["kind"], string> = {
  platinum: "trophy",
  trophies: "trophy",
  played: "play",
  souvenir: "image",
};

export function ProfileActivityList({
  items,
}: Readonly<{ items: ActivityItem[] }>) {
  const { t, i18n } = useTranslation("dashboard");
  const navigate = useNavigate();

  if (items.length === 0) {
    return <p className="pf-empty">{t("profile_activity_empty")}</p>;
  }

  return (
    <div className="pf-card pf-activity">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          className="pf-activity__row"
          onClick={() => item.path && navigate(item.path)}
          disabled={!item.path}
        >
          <span className={`pf-activity__icon pf-activity__icon--${item.kind}`}>
            <Icon name={ACTIVITY_ICON[item.kind]} size={18} />
          </span>
          <span className="pf-activity__text">
            <span className="pf-activity__verb">
              {t(`profile_activity_${item.kind}`)}
            </span>{" "}
            <span className="pf-activity__title">{item.title}</span>
            {item.detail && (
              <span className="pf-activity__detail"> · {item.detail}</span>
            )}
          </span>
          <span className="pf-activity__date">
            {formatShortDate(item.date, i18n.language)}
          </span>
        </button>
      ))}
    </div>
  );
}

/** "Visão geral": platinum showcase, souvenirs preview and the latest activity. */
export function ProfileOverview({
  summary,
  souvenirs,
  souvenirsTotal,
  recentGames,
  isMe,
  onSeeSouvenirs,
  onOpenSouvenir,
  onSeeActivity,
  resolveTitle = identityTitle,
}: Readonly<{
  resolveTitle?: TitleResolver;
  summary: TrophySummary | null;
  souvenirs: ProfileSouvenir[];
  souvenirsTotal: number;
  recentGames: UserGame[];
  isMe: boolean;
  onSeeSouvenirs: () => void;
  onOpenSouvenir: (souvenir: ProfileSouvenir) => void;
  onSeeActivity: () => void;
}>) {
  const { t, i18n } = useTranslation("dashboard");
  const navigate = useNavigate();

  const platinums = useMemo(
    () =>
      (summary?.games ?? [])
        .filter((game) => game.isPlatinum)
        .sort((a, b) => (b.platinumAt ?? 0) - (a.platinumAt ?? 0)),
    [summary]
  );

  const [featured, ...others] = platinums;
  const secondary = others.slice(0, 2);
  const emptySlots = Math.max(0, 2 - secondary.length);

  const activity = useMemo(
    () => buildActivity(summary, recentGames, souvenirs, resolveTitle).slice(0, 5),
    [summary, recentGames, souvenirs, resolveTitle]
  );

  const shots = souvenirs.filter((souvenir) => souvenir.imageUrl).slice(0, 4);

  return (
    <div className="pf-overview">
      <div className="pf-section-head">
        <span className="pf-section-title">{t("platinum_showcase")}</span>
        {isMe && (
          <button
            type="button"
            className="pf-link"
            onClick={() => navigate("/trophies")}
          >
            {t("see_all_in_trophies")}
          </button>
        )}
      </div>

      <div className="pf-showcase">
        {featured ? (
          <button
            type="button"
            className="pf-showcase__featured"
            onClick={() => navigate(buildGameDetailsPath(featured))}
          >
            <img
              className="pf-showcase__cover"
              src={getCoverArt(featured) ?? ""}
              alt=""
            />
            <div className="pf-showcase__info">
              <img
                className="pf-showcase__badge"
                src={TierBadgePlatinum}
                alt=""
              />
              <span className="pf-eyebrow pf-tier-platinum">
                {t("tier_platinum")}
              </span>
              <span className="pf-showcase__title">{featured.title}</span>
              {featured.platinumAt && (
                <span className="pf-showcase__meta">
                  {t("platinum_on", {
                    date: formatShortDate(
                      toUnlockDate(featured.platinumAt),
                      i18n.language
                    ),
                  })}
                </span>
              )}
            </div>
          </button>
        ) : (
          <div className="pf-showcase__slot pf-showcase__slot--wide">
            <img src={TierBadgePlatinum} alt="" />
            <span>{t("showcase_next_platinum")}</span>
          </div>
        )}

        {secondary.map((game) => (
          <button
            key={`${game.shop}-${game.objectId}`}
            type="button"
            className="pf-showcase__mini"
            onClick={() => navigate(buildGameDetailsPath(game))}
          >
            <img
              className="pf-showcase__mini-cover"
              src={getCoverArt(game) ?? ""}
              alt=""
            />
            <img
              className="pf-showcase__mini-badge"
              src={TierBadgePlatinum}
              alt=""
            />
            <span className="pf-showcase__mini-title">{game.title}</span>
          </button>
        ))}

        {Array.from({ length: emptySlots }).map((_, index) => (
          <div key={index} className="pf-showcase__slot">
            <img src={TierBadgePlatinum} alt="" />
            <span>
              {index === 0 && featured
                ? t("showcase_next_platinum")
                : t("showcase_free_slot")}
            </span>
          </div>
        ))}
      </div>

      <div className="pf-section-head">
        <span className="pf-section-title">
          {t("souvenirs_title")}{" "}
          <span className="pf-section-count">{souvenirsTotal}</span>
        </span>
        {souvenirsTotal > 0 && (
          <button type="button" className="pf-link" onClick={onSeeSouvenirs}>
            {t("see_all")}
          </button>
        )}
      </div>

      {shots.length > 0 ? (
        <div className="pf-shots">
          {shots.map((souvenir) => (
            <button
              key={souvenir.id}
              type="button"
              className="pf-shots__item"
              onClick={() => onOpenSouvenir(souvenir)}
            >
              <span className="pf-shots__frame">
                <img src={souvenir.imageUrl ?? ""} alt="" loading="lazy" />
              </span>
              <span className="pf-shots__caption">
                {[
                  resolveTitle(souvenir.shop, souvenir.objectId, souvenir.gameTitle),
                  souvenir.capturedAt
                    ? formatShortDate(toUnlockDate(souvenir.capturedAt), i18n.language)
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="pf-empty">{t("souvenirs_empty")}</p>
      )}

      <div className="pf-section-head">
        <span className="pf-section-title">{t("activity")}</span>
        <button type="button" className="pf-link" onClick={onSeeActivity}>
          {t("see_all")}
        </button>
      </div>
      <ProfileActivityList items={activity} />
    </div>
  );
}

export function ProfileFriendsCard({
  friends,
  total,
  isMe,
  onAdd,
  canCompare,
}: Readonly<{
  friends: UserFriend[];
  total: number;
  isMe: boolean;
  onAdd?: () => void;
  canCompare: boolean;
}>) {
  const { t } = useTranslation("dashboard");
  const navigate = useNavigate();

  return (
    <div className="pf-card pf-side-card">
      <div className="pf-side-card__head">
        <span className="pf-eyebrow pf-eyebrow--strong">
          {t("friends_n", { count: total })}
        </span>
        {isMe && onAdd && (
          <button type="button" className="pf-link" onClick={onAdd}>
            {t("add")}
          </button>
        )}
      </div>

      {friends.length === 0 ? (
        <p className="pf-empty">{t("friends_empty")}</p>
      ) : (
        friends.slice(0, 6).map((friend) => (
          <div key={friend.id} className="pf-friend">
            <button
              type="button"
              className="pf-friend__who"
              onClick={() => navigate(`/profile/${friend.id}`)}
            >
              <span className="pf-friend__avatar">
                {friend.profileImageUrl ? (
                  <img src={friend.profileImageUrl} alt="" />
                ) : (
                  friend.displayName.charAt(0).toUpperCase()
                )}
                {friend.isOnline && <span className="pf-friend__online" />}
              </span>
              <span className="pf-friend__text">
                <span className="pf-friend__name">{friend.displayName}</span>
                <span
                  className={cn("pf-friend__status", {
                    "pf-friend__status--playing": Boolean(friend.currentGame),
                  })}
                >
                  {friend.currentGame
                    ? t("playing_game", { title: friend.currentGame.title })
                    : friend.isOnline
                      ? t("online")
                      : t("offline")}
                </span>
              </span>
            </button>
            {canCompare && (
              <button
                type="button"
                className="pf-compare-chip"
                onClick={() => navigate(`/profile/${friend.id}/compare`)}
              >
                <Icon name="trophy" size={13} />
                {t("compare")}
              </button>
            )}
          </div>
        ))
      )}
    </div>
  );
}

export function ProfileAboutCard({
  rows,
}: Readonly<{ rows: { label: string; value: string }[] }>) {
  const { t } = useTranslation("dashboard");

  return (
    <div className="pf-card pf-side-card">
      <span className="pf-eyebrow pf-eyebrow--strong">{t("about_card")}</span>
      {rows.map((row) => (
        <div key={row.label} className="pf-about__row">
          <span className="pf-about__label">{row.label}</span>
          <span className="pf-about__value">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

export const formatProfilePlaytime = (seconds: number, language: string) =>
  formatHours(seconds * 1000, language);
