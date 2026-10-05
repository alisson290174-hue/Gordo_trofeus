import { useCallback, useEffect, useMemo, useState } from "react";
import { PlatformBadge } from "@renderer/components/platform-badge/platform-badge";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { orderBy } from "lodash-es";
import cn from "classnames";

import { Icon } from "@renderer/components/icon/icon";
import { useLibrary } from "@renderer/hooks";
import { buildGameDetailsPath, isGameReadyToPlay } from "@renderer/helpers";
import { pickShowcase } from "@renderer/helpers/showcase";
import {
  fetchGameSummary,
  formatSummaryMeta,
  getCoverArt,
  getHeaderArt,
  getTileArt,
  getHeroArt,
  getLogoArt,
  getTrophyProgress,
  type GameSummary,
} from "@renderer/helpers/ps5-game";
import type { LibraryGame, ShopAssets, Steam250Game } from "@types";
import "./home.scss";

const HERO_ROTATE_MS = 8000;
const HERO_TILE_COUNT = 8;
const SESSION_SEED = Date.now() % 100000;

type DiscoverTab = "hot" | "weekly" | "almost";

interface HeroGame {
  key: string;
  asset: ShopAssets | LibraryGame;
  libraryGame: LibraryGame | null;
}

const toKey = (game: { shop: string; objectId: string }) =>
  `${game.shop}:${game.objectId}`;

function GameLogo({
  game,
  className,
}: Readonly<{ game: ShopAssets | LibraryGame; className: string }>) {
  const logo = getLogoArt(game);
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [logo]);

  if (!logo || failed) {
    return <div className={`${className}--text`}>{game.title}</div>;
  }

  return (
    <img
      className={className}
      src={logo}
      alt={game.title}
      onError={() => setFailed(true)}
    />
  );
}

function DiscoverCard({
  game,
  sub,
  onOpen,
}: Readonly<{
  game: ShopAssets | LibraryGame;
  sub: string | null;
  onOpen: () => void;
}>) {
  const { i18n } = useTranslation();
  const [summary, setSummary] = useState<GameSummary | null>(null);

  useEffect(() => {
    if (sub !== null) return;
    let cancelled = false;

    fetchGameSummary(game.objectId, game.shop, i18n.language).then((result) => {
      if (!cancelled) setSummary(result);
    });

    return () => {
      cancelled = true;
    };
  }, [game.objectId, game.shop, i18n.language, sub]);

  const header = getHeaderArt(game);
  const subtitle =
    sub ?? [summary?.genre, summary?.developer].filter(Boolean).join(" · ");

  return (
    <button type="button" className="home-discover__card" onClick={onOpen}>
      <div
        className="home-discover__art"
        style={header ? { backgroundImage: `url("${header}")` } : undefined}
      />
      <div className="home-discover__text">
        <span className="home-discover__name">{game.title}</span>
        <span className="home-discover__sub">{subtitle || " "}</span>
      </div>
    </button>
  );
}

export default function Home() {
  const { t, i18n } = useTranslation("dashboard");
  const navigate = useNavigate();
  const { library } = useLibrary();

  // "Em alta" / "Mais baixados" come from the bundled showcase (helpers/showcase.ts): instant,
  // offline-proof and no broken images while the server/CDN load. New shuffle per app session.
  const catalogue = useMemo<Record<"hot" | "weekly", ShopAssets[]>>(() => {
    const picks = pickShowcase(24, SESSION_SEED);
    return { hot: picks.slice(0, 12), weekly: picks.slice(12, 24) };
  }, []);
  const [discoverTab, setDiscoverTab] = useState<DiscoverTab>("hot");
  const [randomGame, setRandomGame] = useState<Steam250Game | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const [summaries, setSummaries] = useState<
    Record<string, GameSummary | null>
  >({});

  useEffect(() => {
    window.electron.getRandomGame().then((game) => {
      if (game) setRandomGame(game);
    });
  }, []);

  const libraryGames = useMemo(
    () => library.filter((game) => !game.isDeleted),
    [library]
  );

  // Hero row = most recently played library games; falls back to "Em alta" for a new user.
  const heroGames = useMemo<HeroGame[]>(() => {
    const played = orderBy(
      libraryGames,
      [
        (game) =>
          game.lastTimePlayed ? new Date(game.lastTimePlayed).getTime() : 0,
        (game) =>
          game.addedToLibraryAt ? new Date(game.addedToLibraryAt).getTime() : 0,
      ],
      ["desc", "desc"]
    ).slice(0, HERO_TILE_COUNT);

    if (played.length > 0) {
      return played.map((game) => ({
        key: toKey(game),
        asset: game,
        libraryGame: game,
      }));
    }

    return (catalogue.hot ?? []).slice(0, HERO_TILE_COUNT).map((game) => ({
      key: toKey(game),
      asset: game,
      libraryGame: null,
    }));
  }, [libraryGames, catalogue.hot]);

  const safeFocusIndex = heroGames.length ? focusIndex % heroGames.length : 0;
  const focus = heroGames[safeFocusIndex] ?? null;

  useEffect(() => {
    if (heroGames.length < 2) return;

    const timeout = setTimeout(
      () => setFocusIndex((index) => (index + 1) % heroGames.length),
      HERO_ROTATE_MS
    );

    return () => clearTimeout(timeout);
  }, [focusIndex, heroGames.length]);

  useEffect(() => {
    if (!focus || focus.key in summaries) return;
    let cancelled = false;

    fetchGameSummary(
      focus.asset.objectId,
      focus.asset.shop,
      i18n.language
    ).then((summary) => {
      if (!cancelled) {
        setSummaries((prev) => ({ ...prev, [focus.key]: summary }));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [focus, summaries, i18n.language]);

  const openGame = useCallback(
    (game: { shop: ShopAssets["shop"]; objectId: string; title: string }) =>
      navigate(buildGameDetailsPath(game)),
    [navigate]
  );

  const handleSurprise = () => {
    if (randomGame) {
      navigate(
        buildGameDetailsPath(
          { ...randomGame, shop: "steam" },
          { fromRandomizer: "1" }
        )
      );
    }
  };

  const discoverGames = useMemo(() => {
    if (discoverTab === "almost") {
      return orderBy(
        // Same rule as the library's "Em andamento": started and not platinum yet.
        libraryGames.filter((game) => {
          const progress = getTrophyProgress(game);
          return progress.unlocked > 0 && !progress.isPlatinum;
        }),
        [(game) => getTrophyProgress(game).percent],
        ["desc"]
      ).slice(0, 6);
    }

    return catalogue[discoverTab]?.slice(0, 6) ?? null;
  }, [discoverTab, libraryGames, catalogue]);

  const focusSummary = focus ? summaries[focus.key] : null;
  const focusProgress = focus?.libraryGame
    ? getTrophyProgress(focus.libraryGame)
    : null;
  const focusHero = focus ? getHeroArt(focus.asset) : null;
  const isFocusReady = focus?.libraryGame
    ? isGameReadyToPlay(focus.libraryGame)
    : false;

  const discoverTabs: { key: DiscoverTab; icon: string; label: string }[] = [
    { key: "hot", icon: "graph", label: t("discover_hot") },
    { key: "weekly", icon: "star", label: t("discover_weekly") },
    { key: "almost", icon: "trophy", label: t("discover_almost") },
  ];

  return (
    <div className="home">
      <section className="home-hero">
        <div
          key={focus?.key ?? "empty"}
          className={cn("home-hero__art", {
            // No landscape art (classics before the PS2 index fills in): a box scan blown up to
            // full screen pixelates, so it becomes a soft blurred backdrop instead.
            "home-hero__art--from-cover":
              Boolean(focusHero) &&
              focus &&
              focusHero === getCoverArt(focus.asset),
          })}
          style={
            focusHero ? { backgroundImage: `url("${focusHero}")` } : undefined
          }
        />
        <div className="home-hero__shade-x" />
        <div className="home-hero__shade-y" />

        <div className="home-hero__content">
          <div className="home-hero__tiles">
            {heroGames.map((game, index) => {
              const isFocused = index === safeFocusIndex;
              const tile = getTileArt(game.asset);

              return (
                <div key={game.key} className="home-hero__tile-wrap">
                  <button
                    type="button"
                    className={cn("home-hero__tile", {
                      "home-hero__tile--focused": isFocused,
                    })}
                    style={
                      tile
                        ? {
                            backgroundImage: tile.fallback
                              ? `url("${tile.url}"), url("${tile.fallback}")`
                              : `url("${tile.url}")`,
                            backgroundSize: tile.fallback
                              ? `${tile.size ?? "cover"}, cover`
                              : tile.size,
                            backgroundPosition: tile.fallback
                              ? `${tile.position ?? "center"}, center`
                              : tile.position,
                          }
                        : undefined
                    }
                    onClick={() =>
                      isFocused ? openGame(game.asset) : setFocusIndex(index)
                    }
                    title={game.asset.title}
                  />
                  {isFocused && (
                    <div className="home-hero__tile-label">
                      <PlatformBadge game={game.asset} />
                      <span className="home-hero__tile-name">
                        {game.asset.title}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="home-hero__spacer" />

          {focus && (
            <div className="home-hero__info" key={focus.key}>
              <GameLogo game={focus.asset} className="home-hero__logo" />

              <div className="home-hero__meta">
                {formatSummaryMeta(focusSummary) || " "}
              </div>

              {focusSummary?.description && (
                <p className="home-hero__desc">{focusSummary.description}</p>
              )}

              <div className="home-hero__actions">
                <button
                  type="button"
                  className="home-hero__primary"
                  onClick={() => openGame(focus.asset)}
                >
                  <Icon name={isFocusReady ? "play" : "download"} size={18} />
                  <span>{isFocusReady ? t("play") : t("download")}</span>
                </button>

                <button
                  type="button"
                  className="home-hero__round"
                  onClick={() => openGame(focus.asset)}
                  title={t("more")}
                >
                  <Icon name="kebab-horizontal" size={20} />
                </button>

                {focusProgress && focusProgress.total > 0 && (
                  <div className="home-hero__trophy-pill">
                    <Icon
                      name="trophy"
                      size={18}
                      className={cn("home-hero__trophy-icon", {
                        "home-hero__trophy-icon--platinum":
                          focusProgress.isPlatinum,
                      })}
                    />
                    <span>{focusProgress.percent}%</span>
                    <div className="home-hero__trophy-bar">
                      <span style={{ width: `${focusProgress.percent}%` }} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="home-discover">
        <div className="home-discover__header">
          {discoverTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={cn("home-discover__tab", {
                "home-discover__tab--active": discoverTab === tab.key,
              })}
              onClick={() => setDiscoverTab(tab.key)}
            >
              <Icon name={tab.icon} size={18} />
              <span>{tab.label}</span>
            </button>
          ))}

          <div className="home-discover__grow" />

          <button
            type="button"
            className="home-discover__surprise"
            onClick={handleSurprise}
            disabled={!randomGame}
          >
            <Icon name="sync" size={16} />
            <span>{t("surprise_me")}</span>
          </button>
        </div>

        <div className="home-discover__grid">
          {discoverGames === null
            ? Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="home-discover__skeleton">
                  <div className="home-discover__art ps5-shimmer" />
                  <div className="home-discover__skeleton-line ps5-shimmer" />
                </div>
              ))
            : discoverGames.map((game) => {
                const progress =
                  discoverTab === "almost" ? getTrophyProgress(game) : null;

                return (
                  <DiscoverCard
                    key={toKey(game)}
                    game={game}
                    sub={
                      progress
                        ? t("almost_platinum_sub", {
                            percent: progress.percent,
                            count: progress.total - progress.unlocked,
                          })
                        : null
                    }
                    onOpen={() => openGame(game)}
                  />
                );
              })}
        </div>

        {discoverGames !== null && discoverGames.length === 0 && (
          <p className="home-discover__empty">
            {discoverTab === "almost" ? t("almost_empty") : t("discover_empty")}
          </p>
        )}
      </section>
    </div>
  );
}
