import { useCallback, useEffect, useMemo, useState } from "react";
import { CoverFrame } from "@renderer/components/cover-frame/cover-frame";
import { getCoverRatio } from "@renderer/helpers/platform-cover";
import { getPlatformBadge } from "@renderer/helpers/platform-badge";
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
  heroFallback,
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

/**
 * Whether a full-screen art is too small or not wide enough to show sharp (null while it loads).
 * Same rule as Big Picture: under 1280px wide or narrower than 4:3 (a 1600x1200 picture is cropped a little but sharp).
 */
function useHeroImage(url: string | null): {
  url: string | null;
  small: boolean | null;
} {
  const [result, setResult] = useState<{
    requested: string;
    url: string;
    small: boolean;
  } | null>(null);
  useEffect(() => {
    if (!url) return undefined;
    let cancelled = false;
    const load = (candidate: string) => {
      const image = new Image();
      image.onload = () => {
        if (cancelled) return;
        const { naturalWidth: width, naturalHeight: height } = image;
        setResult({
          requested: url,
          url: candidate,
          small: width < 1280 || width / Math.max(1, height) < 1.3,
        });
      };
      // An upgraded (larger) picture that doesn't exist: back to the original.
      image.onerror = () => {
        if (cancelled) return;
        const fallback = heroFallback(candidate);
        if (fallback !== candidate) load(fallback);
        else setResult({ requested: url, url: candidate, small: true });
      };
      image.src = candidate;
    };
    load(url);
    return () => {
      cancelled = true;
    };
  }, [url]);
  return result?.requested === url
    ? { url: result.url, small: result.small }
    : { url, small: null };
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

  // One platform at a time (every cover in its console's case shape, none cut). Starts on the
  // platform of the game played last.
  const [platform, setPlatform] = useState<string | null>(null);
  const platforms = useMemo(() => {
    const counts = new Map<string, { name: string; count: number }>();
    for (const game of libraryGames) {
      const badge = getPlatformBadge(game);
      const entry = counts.get(badge.tone) ?? {
        name: badge.tone === "pc" ? "PC" : badge.name,
        count: 0,
      };
      entry.count += 1;
      counts.set(badge.tone, entry);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .map(([tone, value]) => ({ tone, ...value }));
  }, [libraryGames]);
  const activePlatform = useMemo(() => {
    if (platform && platforms.some((entry) => entry.tone === platform))
      return platform;
    const last = orderBy(
      libraryGames,
      [
        (game) =>
          game.lastTimePlayed ? new Date(game.lastTimePlayed).getTime() : 0,
      ],
      ["desc"]
    )[0];
    return last ? getPlatformBadge(last).tone : (platforms[0]?.tone ?? null);
  }, [platform, platforms, libraryGames]);

  // Hero row = most recently played games of the platform; falls back to "Em alta" for a new user.
  const heroGames = useMemo<HeroGame[]>(() => {
    const played = orderBy(
      libraryGames.filter(
        (game) => getPlatformBadge(game).tone === activePlatform
      ),
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
  }, [libraryGames, catalogue.hot, activePlatform]);
  const coverRatio = heroGames[0] ? getCoverRatio(heroGames[0].asset) : 2 / 3;

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
  const requestedHero = focus ? getHeroArt(focus.asset) : null;
  const { url: focusHero, small: heroIsSmall } = useHeroImage(requestedHero);
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
            // No proper landscape art (a box scan, or a small 500px picture): blown up to full
            // screen it pixelates, so it becomes a soft blurred backdrop instead.
            "home-hero__art--from-cover":
              heroIsSmall === true ||
              (Boolean(focusHero) &&
                focus &&
                requestedHero === getCoverArt(focus.asset)),
            "home-hero__art--pending":
              Boolean(focusHero) && heroIsSmall === null,
          })}
          style={
            focusHero ? { backgroundImage: `url("${focusHero}")` } : undefined
          }
        />
        <div className="home-hero__shade-x" />
        <div className="home-hero__shade-y" />

        <div className="home-hero__content">
          {platforms.length > 1 && activePlatform && (
            <nav
              className="home-hero__platforms"
              aria-label="Plataformas"
              onWheel={(event) => {
                if (Math.abs(event.deltaY) > Math.abs(event.deltaX))
                  event.currentTarget.scrollLeft += event.deltaY;
              }}
            >
              {platforms.map((entry) => (
                <button
                  key={entry.tone}
                  type="button"
                  className={cn(
                    "home-hero__platform",
                    `platform-tone--${entry.tone}`,
                    {
                      "home-hero__platform--active":
                        entry.tone === activePlatform,
                    }
                  )}
                  onClick={() => {
                    setPlatform(entry.tone);
                    setFocusIndex(0);
                  }}
                >
                  <i aria-hidden="true" />
                  {entry.name}
                  <span>{entry.count}</span>
                </button>
              ))}
            </nav>
          )}
          <div
            className="home-hero__tiles"
            style={{ "--ratio": coverRatio } as React.CSSProperties}
          >
            {heroGames.map((game, index) => {
              const isFocused = index === safeFocusIndex;
              const cover =
                getCoverArt(game.asset) ?? getTileArt(game.asset)?.url ?? null;

              return (
                <div key={game.key} className="home-hero__tile-wrap">
                  <button
                    type="button"
                    className={cn("home-hero__tile", {
                      "home-hero__tile--focused": isFocused,
                    })}
                    onClick={() =>
                      isFocused ? openGame(game.asset) : setFocusIndex(index)
                    }
                    title={game.asset.title}
                  >
                    {cover && <CoverFrame url={cover} ratio={coverRatio} />}
                  </button>
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
