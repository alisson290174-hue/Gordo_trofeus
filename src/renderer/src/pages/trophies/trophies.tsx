import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import cn from "classnames";
import { orderBy } from "lodash-es";
import type { LibraryGame, UserAchievement } from "@types";
import { useLibrary } from "@renderer/hooks";
import { buildGameDetailsPath } from "@renderer/helpers";
import {
  getCoverArt,
  getHeroArt,
  getTrophyProgress,
} from "@renderer/helpers/ps5-game";
import {
  countTiers,
  RarityLabel,
  TIER_BADGES,
  TIER_COLORS,
  TierCountsRow,
  tierOf,
  TrophyArt,
  type AchievementTier,
  type TierCounts,
} from "@renderer/pages/game-details/ps5/ps5-details";
import KarmaRing from "@renderer/assets/profile/karma-level-ring-bg.png";
import "@renderer/pages/game-details/ps5/ps5-details.scss";
import "./trophies.scss";

// PSN trophy point values; a level every 600 points keeps early levels moving.
const TIER_POINTS: Record<AchievementTier, number> = {
  platinum: 300,
  gold: 90,
  silver: 30,
  bronze: 15,
};
const POINTS_PER_LEVEL = 600;
const FETCH_CONCURRENCY = 3;

/** Achievement lists already fetched this session (the tab opens instantly the second time). */
const achievementCache = new Map<string, UserAchievement[]>();

type TrophyFilter = "all" | "earned" | "locked";

const keyOf = (game: { shop: string; objectId: string }) =>
  `${game.shop}:${game.objectId}`;

interface TrophyRow {
  key: string;
  tier: AchievementTier;
  achievement: UserAchievement;
  isPlatinumRow: boolean;
}

export default function Trophies() {
  const { t, i18n } = useTranslation("dashboard");
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { library } = useLibrary();

  const [achievementsByGame, setAchievementsByGame] = useState<
    Record<string, UserAchievement[]>
  >(() => Object.fromEntries(achievementCache));
  const [filter, setFilter] = useState<TrophyFilter>("all");

  const games = useMemo(
    () =>
      library.filter(
        (game) => !game.isDeleted && (game.achievementCount ?? 0) > 0
      ),
    [library]
  );

  const paramKey =
    searchParams.get("shop") && searchParams.get("objectId")
      ? `${searchParams.get("shop")}:${searchParams.get("objectId")}`
      : null;

  // Each list costs a server round-trip, so: the game on screen first, the rest a few at a time in
  // the background, results applied in batches (one re-render every ~300 ms, not one per game) and
  // kept for the whole session so coming back to the tab is instant.
  useEffect(() => {
    let cancelled = false;
    const pending = games.filter((game) => !achievementCache.has(keyOf(game)));
    if (pending.length === 0) return;
    const priority = pending.findIndex((game) => keyOf(game) === paramKey);
    if (priority > 0) pending.unshift(...pending.splice(priority, 1));

    let buffer: Record<string, UserAchievement[]> = {};
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      flushTimer = null;
      if (cancelled || Object.keys(buffer).length === 0) return;
      const batch = buffer;
      buffer = {};
      setAchievementsByGame((prev) => ({ ...prev, ...batch }));
    };
    const store = (key: string, list: UserAchievement[], immediate: boolean) => {
      achievementCache.set(key, list);
      buffer[key] = list;
      if (immediate) flush();
      else flushTimer ??= setTimeout(flush, 300);
    };

    const worker = async () => {
      while (!cancelled && pending.length) {
        const game = pending.shift()!;
        const key = keyOf(game);
        const list = await window.electron
          .getUnlockedAchievements(game.objectId, game.shop)
          .catch(() => [] as UserAchievement[]);
        if (cancelled) return;
        store(key, list ?? [], key === paramKey);
      }
    };

    for (let i = 0; i < FETCH_CONCURRENCY; i++) void worker();

    return () => {
      cancelled = true;
      if (flushTimer) clearTimeout(flushTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [games]);

  const countsByGame = useMemo(() => {
    const result: Record<string, TierCounts> = {};
    for (const game of games) {
      const list = achievementsByGame[keyOf(game)];
      if (list?.length) result[keyOf(game)] = countTiers(list);
    }
    return result;
  }, [games, achievementsByGame]);

  const percentOf = (game: LibraryGame) =>
    countsByGame[keyOf(game)]?.percent ?? getTrophyProgress(game).percent;
  const isPlatinumGame = (game: LibraryGame) =>
    countsByGame[keyOf(game)]?.isPlatinum ?? getTrophyProgress(game).isPlatinum;

  // Ordered by the progress the library already knows, so rows don't jump while lists arrive.
  const sortedGames = useMemo(
    () =>
      orderBy(
        games,
        [
          (game) => (getTrophyProgress(game).isPlatinum ? 1 : 0),
          (game) => getTrophyProgress(game).percent,
          (game) => game.title.toLowerCase(),
        ],
        ["desc", "desc", "asc"]
      ),
    [games]
  );

  const totals = useMemo(() => {
    const earned = { platinum: 0, gold: 0, silver: 0, bronze: 0 };
    for (const game of games) {
      const counts = countsByGame[keyOf(game)];
      if (counts) {
        earned.gold += counts.earned.gold;
        earned.silver += counts.earned.silver;
        earned.bronze += counts.earned.bronze;
        earned.platinum += counts.earned.platinum;
      } else if (getTrophyProgress(game).isPlatinum) {
        earned.platinum += 1;
      }
    }

    const points = (Object.keys(earned) as AchievementTier[]).reduce(
      (sum, tier) => sum + earned[tier] * TIER_POINTS[tier],
      0
    );

    return {
      earned,
      all: earned.platinum + earned.gold + earned.silver + earned.bronze,
      level: Math.floor(points / POINTS_PER_LEVEL) + 1,
      levelProgress: (points % POINTS_PER_LEVEL) / POINTS_PER_LEVEL,
    };
  }, [games, countsByGame]);

  const selected =
    sortedGames.find((game) => keyOf(game) === paramKey) ??
    sortedGames[0] ??
    null;

  // A game picked before its turn in the background queue loads right away.
  const selectedKey = selected ? keyOf(selected) : null;
  useEffect(() => {
    if (!selected || !selectedKey || achievementCache.has(selectedKey)) return;
    let cancelled = false;
    window.electron
      .getUnlockedAchievements(selected.objectId, selected.shop)
      .catch(() => [] as UserAchievement[])
      .then((list) => {
        achievementCache.set(selectedKey, list ?? []);
        if (!cancelled) setAchievementsByGame((prev) => ({ ...prev, [selectedKey]: list ?? [] }));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  const selectGame = (game: LibraryGame) => {
    setFilter("all");
    setSearchParams(
      { shop: game.shop, objectId: game.objectId },
      { replace: true }
    );
  };

  const selectedAchievements = selected
    ? achievementsByGame[keyOf(selected)]
    : undefined;
  const selectedCounts = selected ? countsByGame[keyOf(selected)] : undefined;

  const rows = useMemo<TrophyRow[]>(() => {
    if (!selected || !selectedAchievements?.length) return [];

    const counts = countTiers(selectedAchievements);
    const rarest = Math.min(
      ...selectedAchievements.map((a) => a.globalUnlockPercent ?? 100)
    );
    const lastUnlock = Math.max(
      0,
      ...selectedAchievements.map((a) => a.unlockTime ?? 0)
    );

    const platinum: UserAchievement = {
      name: "__platinum__",
      displayName: t("platinum"),
      description: t("platinum_description", { title: selected.title }),
      icon: "",
      icongray: "",
      hidden: false,
      unlocked: counts.isPlatinum,
      unlockTime: counts.isPlatinum ? lastUnlock : null,
      globalUnlockPercent: rarest < 100 ? rarest : null,
    };

    const list: TrophyRow[] = orderBy(
      selectedAchievements,
      [(a) => (a.unlocked ? 1 : 0), (a) => a.globalUnlockPercent ?? 100],
      ["desc", "asc"]
    ).map((achievement) => ({
      key: achievement.name,
      tier: tierOf(achievement),
      achievement,
      isPlatinumRow: false,
    }));

    return [
      {
        key: platinum.name,
        tier: "platinum",
        achievement: platinum,
        isPlatinumRow: true,
      },
      ...list,
    ];
  }, [selected, selectedAchievements, t]);

  const filterCounts = {
    all: rows.length,
    earned: rows.filter((row) => row.achievement.unlocked).length,
    locked: rows.filter((row) => !row.achievement.unlocked).length,
  };

  const visibleRows = rows.filter((row) =>
    filter === "all"
      ? true
      : filter === "earned"
        ? row.achievement.unlocked
        : !row.achievement.unlocked
  );

  const formatDate = (unlockTime: number | null) => {
    if (!unlockTime) return null;
    const ms = unlockTime < 1e12 ? unlockTime * 1000 : unlockTime;
    return new Intl.DateTimeFormat(i18n.language, {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(ms));
  };

  const ringCircumference = 741;
  const tierCards: AchievementTier[] = ["platinum", "gold", "silver", "bronze"];

  return (
    <div className="trophies">
      <section className="trophies__header">
        <div className="trophies__header-bg" />
        <div className="trophies__header-shade" />

        <div className="trophies__header-row">
          <div className="trophies__level">
            <div className="trophies__ring">
              <img src={KarmaRing} alt="" />
              <svg viewBox="0 0 300 300">
                <circle
                  cx="150"
                  cy="150"
                  r="118"
                  fill="none"
                  stroke="#0070f3"
                  strokeWidth="18"
                  strokeLinecap="round"
                  strokeDasharray={ringCircumference}
                  strokeDashoffset={
                    ringCircumference * (1 - totals.levelProgress)
                  }
                />
              </svg>
              <div className="trophies__ring-label">
                <span className="trophies__ring-level">{totals.level}</span>
                <span className="trophies__ring-caption">{t("level")}</span>
              </div>
            </div>
            <div className="trophies__title-block">
              <span className="trophies__title">{t("trophies_title")}</span>
              <span className="trophies__subtitle">
                {t("level_progress", {
                  percent: Math.round(totals.levelProgress * 100),
                  level: totals.level + 1,
                })}
              </span>
            </div>
          </div>

          <div className="trophies__grow" />

          <div className="trophies__totals">
            <div className="trophies__total-card">
              <span className="trophies__total-label">{t("total")}</span>
              <span className="trophies__total-value">{totals.all}</span>
            </div>
            {tierCards.map((tier) => (
              <div
                key={tier}
                className={cn("trophies__tier-card", {
                  "trophies__tier-card--platinum": tier === "platinum",
                })}
              >
                <img src={TIER_BADGES[tier]} alt="" />
                <div className="trophies__tier-text">
                  <span
                    className="trophies__tier-label"
                    style={{ color: TIER_COLORS[tier] }}
                  >
                    {t(`tier_${tier}`)}
                  </span>
                  <span className="trophies__tier-value">
                    {totals.earned[tier]}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {games.length === 0 ? (
        <div className="trophies__empty">
          <p>{t("trophies_empty")}</p>
        </div>
      ) : (
        <section className="trophies__body">
          <div className="trophies__games">
            <span className="ps5-eyebrow trophies__games-title">
              {t("games_label", { count: games.length })}
            </span>

            {sortedGames.map((game) => {
              const counts = countsByGame[keyOf(game)];
              const isSelected = selected && keyOf(selected) === keyOf(game);
              const platinum = isPlatinumGame(game);
              const percent = percentOf(game);
              const cover = getCoverArt(game);

              return (
                <button
                  key={keyOf(game)}
                  type="button"
                  className={cn("trophies__game", {
                    "trophies__game--selected": isSelected,
                  })}
                  onClick={() => selectGame(game)}
                >
                  <div
                    className="trophies__game-cover"
                    style={cover ? { backgroundImage: `url("${cover}")` } : undefined}
                  >
                    {platinum && (
                      <img
                        className="trophies__game-plat"
                        src={TIER_BADGES.platinum}
                        alt=""
                      />
                    )}
                  </div>
                  <div className="trophies__game-info">
                    <span className="trophies__game-name">{game.title}</span>
                    <div className="ps5-bar">
                      <span
                        style={{
                          width: `${percent}%`,
                          background: platinum ? "#cfe6ea" : "#0070f3",
                        }}
                      />
                    </div>
                    <div className="trophies__game-tiers">
                      {counts ? (
                        <>
                          <span style={{ color: TIER_COLORS.gold }}>
                            ● {counts.earned.gold}/{counts.total.gold}
                          </span>
                          <span style={{ color: TIER_COLORS.silver }}>
                            ● {counts.earned.silver}/{counts.total.silver}
                          </span>
                          <span style={{ color: TIER_COLORS.bronze }}>
                            ● {counts.earned.bronze}/{counts.total.bronze}
                          </span>
                        </>
                      ) : (
                        <span>
                          {getTrophyProgress(game).unlocked}/
                          {getTrophyProgress(game).total}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="trophies__game-pct">{percent}%</span>
                </button>
              );
            })}
          </div>

          {selected && (
            <div className="trophies__panel">
              <div className="trophies__panel-head">
                <div
                  className="trophies__panel-bg"
                  style={
                    getHeroArt(selected)
                      ? { backgroundImage: `url("${getHeroArt(selected)}")` }
                      : undefined
                  }
                />
                <div className="trophies__panel-shade" />
                <button
                  type="button"
                  className="trophies__panel-cover"
                  style={
                    getCoverArt(selected)
                      ? { backgroundImage: `url("${getCoverArt(selected)}")` }
                      : undefined
                  }
                  onClick={() => navigate(buildGameDetailsPath(selected))}
                  title={selected.title}
                />
                <div className="trophies__panel-info">
                  <button
                    type="button"
                    className="trophies__panel-name"
                    onClick={() => navigate(buildGameDetailsPath(selected))}
                  >
                    {selected.title}
                  </button>
                  <div className="ps5-bar ps5-bar--4">
                    <span style={{ width: `${percentOf(selected)}%` }} />
                  </div>
                  {selectedCounts && (
                    <TierCountsRow counts={selectedCounts} size={18} />
                  )}
                </div>
                <span className="trophies__panel-pct">
                  {percentOf(selected)}%
                </span>
              </div>

              <div className="trophies__filters">
                {(["all", "earned", "locked"] as TrophyFilter[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={cn("trophies__chip", {
                      "trophies__chip--active": filter === key,
                    })}
                    onClick={() => setFilter(key)}
                  >
                    <span>{t(`filter_${key}`)}</span>
                    <span className="trophies__chip-count">
                      {filterCounts[key]}
                    </span>
                  </button>
                ))}
              </div>

              <div className="trophies__list">
                {selectedAchievements === undefined &&
                  Array.from({ length: 6 }).map((_, index) => (
                    <div
                      key={index}
                      className="trophies__row trophies__row--skeleton ps5-shimmer"
                    />
                  ))}

                {selectedAchievements !== undefined && rows.length === 0 && (
                  <p className="trophies__list-empty">{t("no_trophies_data")}</p>
                )}

                {visibleRows.map((row) => {
                  const { achievement, tier } = row;
                  const date = formatDate(achievement.unlockTime);

                  return (
                    <div
                      key={row.key}
                      className={cn("trophies__row", {
                        "trophies__row--platinum": row.isPlatinumRow,
                        "trophies__row--platinum-earned":
                          row.isPlatinumRow && achievement.unlocked,
                      })}
                    >
                      <TrophyArt achievement={achievement} tier={tier} size={54} />
                      <div
                        className="trophies__row-text"
                        style={{ opacity: achievement.unlocked ? 1 : 0.55 }}
                      >
                        <div className="trophies__row-title">
                          <span className="trophies__row-name">
                            {achievement.displayName}
                          </span>
                          <span
                            className="trophies__row-tier"
                            style={{ color: TIER_COLORS[tier] }}
                          >
                            {t(`tier_${tier}`)}
                          </span>
                        </div>
                        <span className="trophies__row-desc">
                          {achievement.hidden && !achievement.unlocked
                            ? t("hidden_trophy")
                            : (achievement.description ?? "")}
                        </span>
                      </div>
                      <div className="trophies__row-side">
                        <RarityLabel percent={achievement.globalUnlockPercent} />
                        <span className="trophies__row-date">
                          {achievement.unlocked
                            ? (date ?? "")
                            : t("locked")}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
