import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import cn from "classnames";
import type { ComparedAchievements, GameShop } from "@types";
import { Icon } from "@renderer/components/icon/icon";
import { useTrophySummary, useUserDetails } from "@renderer/hooks";
import { getCoverArt, toUnlockDate } from "@renderer/helpers/ps5-game";
import { TIER_BADGE_IMAGES } from "../ps5/profile-ps5";
import "./compare-game.scss";

type Filter = "all" | "only_you" | "both" | "only_them" | "none";

/** One game, trophy by trophy: "Você" vs the friend (design "Perfil de troféus"). */
export default function CompareGame() {
  const { userId, shop, objectId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation("dashboard");
  const { userDetails } = useUserDetails();

  const [data, setData] = useState<ComparedAchievements | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");

  const { summary: mySummary } = useTrophySummary(userDetails?.id);
  const { summary: theirSummary } = useTrophySummary(userId);

  useEffect(() => {
    if (!userId || !shop || !objectId) return;
    setIsLoading(true);
    window.electron
      .getComparedUnlockedAchievements(objectId, shop as GameShop, userId)
      .then((result) => setData(result))
      .catch(() => setData(null))
      .finally(() => setIsLoading(false));
  }, [userId, shop, objectId]);

  const game = useMemo(
    () =>
      [...(mySummary?.games ?? []), ...(theirSummary?.games ?? [])].find(
        (item) => item.shop === shop && item.objectId === objectId
      ) ?? null,
    [mySummary, theirSummary, shop, objectId]
  );

  const title = game?.title ?? searchParams.get("title") ?? "";
  const theirName = data?.target.displayName ?? "";
  const cover = game ? getCoverArt(game) : null;

  const owner = data?.owner;
  const target = data?.target;
  const pct = (unlocked?: number, total?: number) =>
    total ? Math.round(((unlocked ?? 0) / total) * 100) : 0;
  const minePct = pct(
    owner?.unlockedAchievementCount,
    owner?.totalAchievementCount
  );
  const theirPct = pct(
    target?.unlockedAchievementCount,
    target?.totalAchievementCount
  );

  const achievements = data?.achievements ?? [];
  const has = (stat?: { unlocked: boolean }) => Boolean(stat?.unlocked);

  const filters: {
    key: Filter;
    label: string;
    test: (a: (typeof achievements)[number]) => boolean;
  }[] = [
    { key: "all", label: t("filter_all"), test: () => true },
    {
      key: "only_you",
      label: t("only_you"),
      test: (a) => has(a.ownerStat) && !has(a.targetStat),
    },
    {
      key: "both",
      label: t("both"),
      test: (a) => has(a.ownerStat) && has(a.targetStat),
    },
    {
      key: "only_them",
      label: t("only_them", { name: theirName }),
      test: (a) => !has(a.ownerStat) && has(a.targetStat),
    },
    {
      key: "none",
      label: t("nobody"),
      test: (a) => !has(a.ownerStat) && !has(a.targetStat),
    },
  ];
  const active = filters.find((item) => item.key === filter) ?? filters[0];
  const visible = achievements.filter(active.test);

  const formatDate = (time?: number) => {
    const date = toUnlockDate(time);
    return date
      ? new Intl.DateTimeFormat(i18n.language, {
          day: "numeric",
          month: "short",
          year: "numeric",
        }).format(date)
      : "";
  };

  const status = (stat?: { unlocked: boolean; unlockTime: number }) =>
    stat?.unlocked ? (
      <span className="cg-status">
        <span className="cg-status__dot cg-status__dot--on">
          <Icon name="check" size={16} />
        </span>
        <span className="cg-status__date">{formatDate(stat.unlockTime)}</span>
      </span>
    ) : (
      <span className="cg-status">
        <span className="cg-status__dot">
          <Icon name="lock" size={14} />
        </span>
        <span className="cg-status__date">{t("locked")}</span>
      </span>
    );

  return (
    <div className="cg">
      <div className="cg__backdrop">{cover && <img src={cover} alt="" />}</div>

      <div className="cg__content">
        <button type="button" className="cg__back" onClick={() => navigate(-1)}>
          <Icon name="arrow-left" size={16} />
          {t("compare_trophies")}
        </button>

        <div className="cg__head">
          <span className="cg__cover">
            {cover && <img src={cover} alt="" />}
          </span>
          <div className="cg__title-block">
            <span className="cg__eyebrow">
              {t("you_vs", { name: theirName })} ·{" "}
              {t("trophies_n", { count: achievements.length })}
            </span>
            <h1 className="cg__title">{title}</h1>
          </div>
          <div className="cg__scores">
            <div
              className={cn("cg-score", {
                "cg-score--platinum": minePct === 100,
              })}
            >
              <span className="cg-score__avatar">
                {userDetails?.profileImageUrl ? (
                  <img src={userDetails.profileImageUrl} alt="" />
                ) : (
                  (userDetails?.displayName ?? "V").charAt(0)
                )}
              </span>
              <span className="cg-score__text">
                <span className="cg-score__label">
                  {minePct === 100 ? t("you_platinum") : t("you")}
                </span>
                <span className="cg-score__value">{minePct}%</span>
              </span>
              {minePct === 100 && (
                <img
                  className="cg-score__badge"
                  src={TIER_BADGE_IMAGES.platinum}
                  alt=""
                />
              )}
            </div>
            <div
              className={cn("cg-score", {
                "cg-score--platinum": theirPct === 100,
              })}
            >
              <span className="cg-score__avatar">
                {target?.profileImageUrl ? (
                  <img src={target.profileImageUrl} alt="" />
                ) : (
                  theirName.charAt(0)
                )}
              </span>
              <span className="cg-score__text">
                <span className="cg-score__label">{theirName}</span>
                <span className="cg-score__value">{theirPct}%</span>
              </span>
              {theirPct === 100 && (
                <img
                  className="cg-score__badge"
                  src={TIER_BADGE_IMAGES.platinum}
                  alt=""
                />
              )}
            </div>
          </div>
        </div>

        <div className="cg__chips">
          {filters.map((item) => (
            <button
              key={item.key}
              type="button"
              className={cn("cg-chip", {
                "cg-chip--active": filter === item.key,
              })}
              onClick={() => setFilter(item.key)}
            >
              {item.label}
              <span className="cg-chip__count">
                {achievements.filter(item.test).length}
              </span>
            </button>
          ))}
        </div>

        <div className="cg-list">
          <div className="cg-list__head">
            <span>{t("trophy")}</span>
            <span className="cg-list__center">{t("you")}</span>
            <span className="cg-list__center">{theirName}</span>
          </div>

          {isLoading &&
            Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="cg-list__row cg-list__row--skeleton ps5-shimmer"
              />
            ))}

          {!isLoading && achievements.length === 0 && (
            <p className="cg__empty">{t("no_trophies_data")}</p>
          )}

          {visible.map((achievement) => (
            <div key={achievement.displayName} className="cg-list__row">
              <span className="cg-trophy">
                <span className="cg-trophy__icon">
                  {achievement.icon ? (
                    <img src={achievement.icon} alt="" loading="lazy" />
                  ) : (
                    <Icon name="trophy" size={22} />
                  )}
                </span>
                <span className="cg-trophy__text">
                  <span className="cg-trophy__name">
                    {achievement.displayName}
                  </span>
                  <span className="cg-trophy__desc">
                    {achievement.hidden && !has(achievement.ownerStat)
                      ? t("hidden_trophy")
                      : achievement.description}
                  </span>
                </span>
              </span>
              <span className="cg-list__center">
                {status(achievement.ownerStat)}
              </span>
              <span className="cg-list__center">
                {status(achievement.targetStat)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
