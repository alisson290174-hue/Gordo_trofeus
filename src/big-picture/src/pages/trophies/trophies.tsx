import type { LibraryGame } from "@types";
import { PlatformBadge } from "@renderer/components/platform-badge/platform-badge";
import { getCoverArt, getTrophyProgress } from "@renderer/helpers/ps5-game";
import {
  TIER_BADGES,
  TIER_COLORS,
  type AchievementTier,
} from "@renderer/pages/game-details/ps5/ps5-details";
import { keyOf, useTrophyData } from "@renderer/pages/trophies/use-trophy-data";
import KarmaRing from "@renderer/assets/profile/karma-level-ring-bg.png";
import cn from "classnames";
import { orderBy } from "lodash-es";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FocusItem,
  GridFocusGroup,
  HorizontalFocusGroup,
  VerticalFocusGroup,
} from "../../components";
import {
  getBigPictureGameAchievementsPath,
  getBigPictureGameDetailsPath,
} from "../../helpers";
import { tr } from "../../helpers/opus-text";
import { useLibrary } from "../../hooks";
import { TROPHIES_PAGE_REGION_ID } from "./navigation";
import "./trophies.scss";

type GameFilter = "all" | "platinum" | "progress" | "not_started";

const GAME_FILTERS: Array<{ key: GameFilter; en: string; pt: string }> = [
  { key: "all", en: "All", pt: "Todos" },
  { key: "platinum", en: "Platinum", pt: "Platinados" },
  { key: "progress", en: "In progress", pt: "Em andamento" },
  { key: "not_started", en: "Not started", pt: "Não iniciados" },
];

const TIERS: AchievementTier[] = ["platinum", "gold", "silver", "bronze"];
const TIER_NAMES: Record<AchievementTier, [string, string]> = {
  platinum: ["Platinum", "Platina"],
  gold: ["Gold", "Ouro"],
  silver: ["Silver", "Prata"],
  bronze: ["Bronze", "Bronze"],
};

const matchesGameFilter = (game: LibraryGame, filter: GameFilter) => {
  const progress = getTrophyProgress(game);
  if (filter === "platinum") return progress.isPlatinum;
  if (filter === "progress")
    return !progress.isPlatinum && progress.unlocked > 0;
  if (filter === "not_started") return progress.unlocked === 0;
  return true;
};

const RING_CIRCUMFERENCE = 741;

/** Big Picture "Troféus": the same numbers as the normal-mode screen, laid out for the TV. */
export default function BigPictureTrophies() {
  const navigate = useNavigate();
  const { library } = useLibrary();
  const [gameFilter, setGameFilter] = useState<GameFilter>("all");
  const { games, countsByGame, totals, percentOf, isPlatinumGame } =
    useTrophyData(library);

  // Ordered by the progress the library already knows, so cards don't jump while lists arrive.
  const sortedGames = useMemo(
    () =>
      orderBy(
        games,
        [
          (game) => (getTrophyProgress(game).unlocked > 0 ? 1 : 0),
          (game) =>
            game.lastTimePlayed ? new Date(game.lastTimePlayed).getTime() : 0,
          (game) => getTrophyProgress(game).percent,
          (game) => game.title.toLowerCase(),
        ],
        ["desc", "desc", "desc", "asc"]
      ),
    [games]
  );

  const filterCounts = useMemo(
    () =>
      Object.fromEntries(
        GAME_FILTERS.map(({ key }) => [
          key,
          games.filter((game) => matchesGameFilter(game, key)).length,
        ])
      ) as Record<GameFilter, number>,
    [games]
  );

  const visibleGames = sortedGames.filter((game) =>
    matchesGameFilter(game, gameFilter)
  );

  return (
    <VerticalFocusGroup
      regionId={TROPHIES_PAGE_REGION_ID}
      className="bp-trophies"
    >
      <header className="bp-trophies__header">
        <div className="bp-trophies__level">
          <div className="bp-trophies__ring">
            <img src={KarmaRing} alt="" />
            <svg viewBox="0 0 300 300" aria-hidden="true">
              <circle
                cx="150"
                cy="150"
                r="118"
                fill="none"
                stroke="#0070f3"
                strokeWidth="18"
                strokeLinecap="round"
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={
                  RING_CIRCUMFERENCE * (1 - totals.levelProgress)
                }
              />
            </svg>
            <div className="bp-trophies__ring-label">
              <span className="bp-trophies__ring-level">{totals.level}</span>
              <span className="bp-trophies__ring-caption">
                {tr("Level", "Nível")}
              </span>
            </div>
          </div>
          <div className="bp-trophies__title-block">
            <h1 className="bp-trophies__title">{tr("Trophies", "Troféus")}</h1>
            <span className="bp-trophies__subtitle">
              {tr(
                `${Math.round(totals.levelProgress * 100)}% to level ${totals.level + 1}`,
                `${Math.round(totals.levelProgress * 100)}% até o nível ${totals.level + 1}`
              )}
            </span>
          </div>
        </div>

        <div className="bp-trophies__totals">
          <div className="bp-trophies__total">
            <span className="bp-trophies__total-label">
              {tr("Total", "Total")}
            </span>
            <span className="bp-trophies__total-value">{totals.all}</span>
          </div>
          {TIERS.map((tier) => (
            <div
              key={tier}
              className={cn("bp-trophies__tier", {
                "bp-trophies__tier--platinum": tier === "platinum",
              })}
            >
              <img src={TIER_BADGES[tier]} alt="" />
              <div className="bp-trophies__tier-text">
                <span
                  className="bp-trophies__tier-label"
                  style={{ color: TIER_COLORS[tier] }}
                >
                  {tr(...TIER_NAMES[tier])}
                </span>
                <span className="bp-trophies__tier-value">
                  {totals.earned[tier]}
                </span>
              </div>
            </div>
          ))}
        </div>
      </header>

      {games.length === 0 ? (
        <p className="bp-trophies__empty">
          {tr(
            "Play a game with trophies and your progress shows up here.",
            "Jogue um jogo com troféus e o seu progresso aparece aqui."
          )}
        </p>
      ) : (
        <>
          <HorizontalFocusGroup
            regionId="bp-trophies-filters"
            className="bp-trophies__filters"
          >
            {GAME_FILTERS.map(({ key, en, pt }) => (
              <FocusItem
                key={key}
                id={`bp-trophies-filter-${key}`}
                actions={{ primary: () => setGameFilter(key) }}
                asChild
              >
                <button
                  type="button"
                  className={cn("bp-trophies__chip", {
                    "bp-trophies__chip--active": gameFilter === key,
                  })}
                  onClick={() => setGameFilter(key)}
                >
                  {tr(en, pt)}
                  <span>{filterCounts[key]}</span>
                </button>
              </FocusItem>
            ))}
          </HorizontalFocusGroup>

          <GridFocusGroup
            regionId="bp-trophies-games"
            className="bp-trophies__grid"
          >
            {visibleGames.map((game) => {
              const counts = countsByGame[keyOf(game)];
              const platinum = isPlatinumGame(game);
              const percent = percentOf(game);
              const cover = getCoverArt(game);
              const progress = getTrophyProgress(game);
              const openTrophies = () =>
                navigate(getBigPictureGameAchievementsPath(game));

              return (
                <FocusItem
                  key={keyOf(game)}
                  id={`bp-trophies-game-${game.shop}-${game.objectId}`}
                  actions={{
                    primary: openTrophies,
                    press: {
                      x: () => navigate(getBigPictureGameDetailsPath(game)),
                    },
                  }}
                  asChild
                >
                  <button
                    type="button"
                    className={cn("bp-trophies__game", {
                      "bp-trophies__game--platinum": platinum,
                    })}
                    onClick={openTrophies}
                  >
                    <span className="bp-trophies__cover">
                      {cover && (
                        <img
                          src={cover}
                          alt=""
                          loading="lazy"
                          decoding="async"
                        />
                      )}
                      {platinum && (
                        <img
                          className="bp-trophies__cover-plat"
                          src={TIER_BADGES.platinum}
                          alt=""
                        />
                      )}
                    </span>
                    <span className="bp-trophies__game-info">
                      <span className="bp-trophies__game-name">
                        <PlatformBadge
                          game={game}
                          className="bp-trophies__badge"
                        />
                        <span className="bp-trophies__game-title">
                          {game.title}
                        </span>
                      </span>
                      <span className="bp-trophies__bar">
                        <span
                          style={{
                            width: `${percent}%`,
                            background: platinum ? "#cfe6ea" : "#0070f3",
                          }}
                        />
                      </span>
                      <span className="bp-trophies__game-tiers">
                        {counts ? (
                          (["gold", "silver", "bronze"] as const)
                            .filter((tier) => counts.total[tier] > 0)
                            .map((tier) => (
                              <span
                                key={tier}
                                style={{ color: TIER_COLORS[tier] }}
                              >
                                <img src={TIER_BADGES[tier]} alt="" />
                                {counts.earned[tier]}/{counts.total[tier]}
                              </span>
                            ))
                        ) : (
                          <span>
                            {progress.unlocked}/{progress.total}
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="bp-trophies__game-pct">{percent}%</span>
                  </button>
                </FocusItem>
              );
            })}
          </GridFocusGroup>
        </>
      )}
    </VerticalFocusGroup>
  );
}
