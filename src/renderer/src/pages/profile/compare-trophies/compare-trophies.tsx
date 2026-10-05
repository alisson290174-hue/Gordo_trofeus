import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import cn from "classnames";
import { AuthPage } from "@shared";
import { Icon } from "@renderer/components/icon/icon";
import { useTrophySummary, useUserDetails } from "@renderer/hooks";
import { buildGameDetailsPath } from "@renderer/helpers";
import {
  computeTrophyLevel,
  getCoverArt,
  type TrophyCounts,
  type TrophySummaryGame,
} from "@renderer/helpers/ps5-game";
import { TIER_BADGE_IMAGES } from "../ps5/profile-ps5";
import "./compare-trophies.scss";

type CompareFilter = "all" | "common" | "mine" | "theirs";

const TIERS = ["platinum", "gold", "silver", "bronze"] as const;

const keyOf = (game: { shop: string; objectId: string }) =>
  `${game.shop}:${game.objectId}`;

const percentOf = (game: TrophySummaryGame) =>
  game.achievementCount > 0
    ? Math.round((game.unlockedAchievementCount / game.achievementCount) * 100)
    : 0;

const tiersLine = (game: TrophySummaryGame) =>
  `${game.tiers.gold.earned}/${game.tiers.gold.total} · ${game.tiers.silver.earned}/${game.tiers.silver.total} · ${game.tiers.bronze.earned}/${game.tiers.bronze.total}`;

interface CompareRow {
  key: string;
  base: TrophySummaryGame;
  mine: TrophySummaryGame | null;
  theirs: TrophySummaryGame | null;
}

function Person({
  name,
  imageUrl,
  counts,
  ahead,
  align,
}: Readonly<{
  name: string;
  imageUrl: string | null;
  counts: TrophyCounts | undefined;
  ahead: number;
  align: "left" | "right";
}>) {
  const { t } = useTranslation("dashboard");
  const { level } = computeTrophyLevel(
    counts ?? { platinum: 0, gold: 0, silver: 0, bronze: 0 }
  );

  return (
    <div
      className={cn("cmp-person", { "cmp-person--right": align === "right" })}
    >
      <span className="cmp-person__avatar">
        {imageUrl ? (
          <img src={imageUrl} alt="" />
        ) : (
          name.charAt(0).toUpperCase()
        )}
      </span>
      <span className="cmp-person__text">
        <span className="cmp-person__name">{name}</span>
        <span className="cmp-person__meta">
          {t("level_n", { level })} ·{" "}
          {t("trophies_n", { count: counts?.total ?? 0 })}
        </span>
        <span className="cmp-person__meta">
          {t("ahead_in", { count: ahead })}
        </span>
      </span>
    </div>
  );
}

export default function CompareTrophies() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation(["dashboard", "user_profile"]);
  const { userDetails } = useUserDetails();

  const [theirProfile, setTheirProfile] = useState<{
    displayName: string;
    profileImageUrl: string | null;
  } | null>(null);
  const [filter, setFilter] = useState<CompareFilter>("all");

  const { summary: mySummary, isLoading: myLoading } = useTrophySummary(
    userDetails?.id
  );
  const { summary: theirSummary, isLoading: theirLoading } =
    useTrophySummary(userId);

  useEffect(() => {
    if (!userId) return;
    window.electron.hydraApi
      .get<{ displayName: string; profileImageUrl: string | null }>(
        `/users/${userId}`,
        { needsAuth: false }
      )
      .then(setTheirProfile)
      .catch(() => setTheirProfile(null));
  }, [userId]);

  const theirName = theirProfile?.displayName ?? "";

  const rows = useMemo<CompareRow[]>(() => {
    const map = new Map<string, CompareRow>();
    for (const game of mySummary?.games ?? []) {
      map.set(keyOf(game), {
        key: keyOf(game),
        base: game,
        mine: game,
        theirs: null,
      });
    }
    for (const game of theirSummary?.games ?? []) {
      const existing = map.get(keyOf(game));
      if (existing) existing.theirs = game;
      else
        map.set(keyOf(game), {
          key: keyOf(game),
          base: game,
          mine: null,
          theirs: game,
        });
    }

    const lastActivity = (row: CompareRow) =>
      Math.max(row.mine?.lastUnlockAt ?? 0, row.theirs?.lastUnlockAt ?? 0);

    return [...map.values()].sort((a, b) => {
      const aCommon = a.mine && a.theirs ? 1 : 0;
      const bCommon = b.mine && b.theirs ? 1 : 0;
      return bCommon - aCommon || lastActivity(b) - lastActivity(a);
    });
  }, [mySummary, theirSummary]);

  const aheadMine = rows.filter(
    (row) =>
      row.mine && (!row.theirs || percentOf(row.mine) > percentOf(row.theirs))
  ).length;
  const aheadTheirs = rows.filter(
    (row) =>
      row.theirs && (!row.mine || percentOf(row.theirs) > percentOf(row.mine))
  ).length;

  const filters: {
    key: CompareFilter;
    label: string;
    test: (row: CompareRow) => boolean;
  }[] = [
    { key: "all", label: t("filter_all"), test: () => true },
    {
      key: "common",
      label: t("in_common"),
      test: (row) => Boolean(row.mine && row.theirs),
    },
    {
      key: "mine",
      label: t("only_you"),
      test: (row) => Boolean(row.mine && !row.theirs),
    },
    {
      key: "theirs",
      label: t("only_them", { name: theirName }),
      test: (row) => Boolean(row.theirs && !row.mine),
    },
  ];
  const activeFilter =
    filters.find((item) => item.key === filter) ?? filters[0];
  const visibleRows = rows.filter(activeFilter.test);

  if (!userDetails) {
    return (
      <div className="cmp cmp--signed-out">
        <p>{t("compare_trophies_sign_in_required", { ns: "user_profile" })}</p>
        <button
          type="button"
          className="cmp-chip cmp-chip--active"
          onClick={() => window.electron.openAuthWindow(AuthPage.SignIn)}
        >
          <Icon name="sign-in" size={16} />
        </button>
      </div>
    );
  }

  const isLoading = myLoading || theirLoading;
  const hasTierData = Boolean(mySummary?.hasTiers && theirSummary?.hasTiers);

  return (
    <div className="cmp">
      <button type="button" className="cmp__back" onClick={() => navigate(-1)}>
        <Icon name="arrow-left" size={16} />
        {theirName ? t("profile_of", { name: theirName }) : t("back")}
      </button>

      <div className="cmp__title-block">
        <span className="cmp__eyebrow">{t("you_vs", { name: theirName })}</span>
        <h1 className="cmp__title">{t("compare_trophies")}</h1>
      </div>

      <div className="cmp-duel">
        <Person
          name={t("you")}
          imageUrl={userDetails.profileImageUrl ?? null}
          counts={mySummary?.counts}
          ahead={aheadMine}
          align="left"
        />

        <div className="cmp-duel__bars">
          {TIERS.map((tier) => {
            const mine = mySummary?.counts[tier] ?? 0;
            const theirs = theirSummary?.counts[tier] ?? 0;
            const max = Math.max(mine, theirs, 1);
            return (
              <div key={tier} className="cmp-duel__row">
                <span
                  className={cn("cmp-duel__num cmp-duel__num--mine", {
                    "cmp-duel__num--ahead": mine > theirs,
                  })}
                >
                  {tier === "platinum" || hasTierData ? mine : "—"}
                </span>
                <span className="cmp-duel__track cmp-duel__track--mine">
                  <span
                    className={`cmp-duel__fill cmp-duel__fill--${tier}`}
                    style={{ width: `${(mine / max) * 100}%` }}
                  />
                </span>
                <img src={TIER_BADGE_IMAGES[tier]} alt={t(`tier_${tier}`)} />
                <span className="cmp-duel__track">
                  <span
                    className={`cmp-duel__fill cmp-duel__fill--${tier}`}
                    style={{ width: `${(theirs / max) * 100}%` }}
                  />
                </span>
                <span
                  className={cn("cmp-duel__num", {
                    "cmp-duel__num--ahead": theirs > mine,
                  })}
                >
                  {tier === "platinum" || hasTierData ? theirs : "—"}
                </span>
              </div>
            );
          })}
        </div>

        <Person
          name={theirName}
          imageUrl={theirProfile?.profileImageUrl ?? null}
          counts={theirSummary?.counts}
          ahead={aheadTheirs}
          align="right"
        />
      </div>

      <div className="cmp__chips">
        {filters.map((item) => (
          <button
            key={item.key}
            type="button"
            className={cn("cmp-chip", {
              "cmp-chip--active": filter === item.key,
            })}
            onClick={() => setFilter(item.key)}
          >
            {item.label}
            <span className="cmp-chip__count">
              {rows.filter(item.test).length}
            </span>
          </button>
        ))}
      </div>

      <div className="cmp-list">
        <div className="cmp-list__head">
          <span className="cmp-list__col-mine">{t("you")}</span>
          <span className="cmp-list__col-game">{t("game")}</span>
          <span>{theirName}</span>
        </div>

        {isLoading &&
          rows.length === 0 &&
          Array.from({ length: 5 }).map((_, index) => (
            <div
              key={index}
              className="cmp-list__row cmp-list__row--skeleton ps5-shimmer"
            />
          ))}

        {!isLoading && rows.length === 0 && (
          <p className="cmp__empty">
            {hasTierData ? t("compare_empty") : t("compare_needs_server")}
          </p>
        )}

        {visibleRows.map((row) => {
          const cover = getCoverArt(row.base);
          const mine = row.mine;
          const theirs = row.theirs;
          const mineAhead =
            mine && (!theirs || percentOf(mine) > percentOf(theirs));
          const theirsAhead =
            theirs && (!mine || percentOf(theirs) > percentOf(mine));
          const isCommon = Boolean(mine && theirs);

          return (
            <button
              key={row.key}
              type="button"
              className="cmp-list__row"
              onClick={() =>
                navigate(
                  isCommon
                    ? `/profile/${userId}/compare/${row.base.shop}/${row.base.objectId}?title=${encodeURIComponent(row.base.title)}`
                    : buildGameDetailsPath(row.base)
                )
              }
            >
              <span className="cmp-side cmp-side--mine">
                {mine ? (
                  <>
                    <span className="cmp-side__detail">
                      <span className="cmp-side__track cmp-side__track--mine">
                        <span
                          className={cn("cmp-side__fill", {
                            "cmp-side__fill--ahead": mineAhead,
                            "cmp-side__fill--platinum": mine.isPlatinum,
                          })}
                          style={{ width: `${percentOf(mine)}%` }}
                        />
                      </span>
                      <span className="cmp-side__tiers">{tiersLine(mine)}</span>
                    </span>
                    <span
                      className={cn("cmp-side__pct", {
                        "cmp-side__pct--ahead": mineAhead,
                      })}
                    >
                      {percentOf(mine)}%
                    </span>
                    {mine.isPlatinum && (
                      <img
                        className="cmp-side__plat"
                        src={TIER_BADGE_IMAGES.platinum}
                        alt=""
                      />
                    )}
                  </>
                ) : (
                  <span className="cmp-side__missing">
                    {t("doesnt_have_game")}
                  </span>
                )}
              </span>

              <span className="cmp-game">
                <span className="cmp-game__cover">
                  {cover && <img src={cover} alt="" loading="lazy" />}
                </span>
                <span className="cmp-game__title">{row.base.title}</span>
              </span>

              <span className="cmp-side">
                {theirs ? (
                  <>
                    {theirs.isPlatinum && (
                      <img
                        className="cmp-side__plat"
                        src={TIER_BADGE_IMAGES.platinum}
                        alt=""
                      />
                    )}
                    <span
                      className={cn("cmp-side__pct", {
                        "cmp-side__pct--ahead": theirsAhead,
                      })}
                    >
                      {percentOf(theirs)}%
                    </span>
                    <span className="cmp-side__detail">
                      <span className="cmp-side__track">
                        <span
                          className={cn("cmp-side__fill", {
                            "cmp-side__fill--ahead": theirsAhead,
                            "cmp-side__fill--platinum": theirs.isPlatinum,
                          })}
                          style={{ width: `${percentOf(theirs)}%` }}
                        />
                      </span>
                      <span className="cmp-side__tiers">
                        {tiersLine(theirs)}
                      </span>
                    </span>
                  </>
                ) : (
                  <span className="cmp-side__missing">
                    {t("doesnt_have_game")}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
