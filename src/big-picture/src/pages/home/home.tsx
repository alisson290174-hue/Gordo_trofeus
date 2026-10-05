import { DotsThreeIcon, PlayIcon, TrophyIcon } from "@phosphor-icons/react";
import type { LibraryGame } from "@types";
import { getDisplayedPlayTimeInMilliseconds } from "@shared";
import { PlatformBadge } from "@renderer/components/platform-badge/platform-badge";
import { getPlatformBadge } from "@renderer/helpers/platform-badge";
import { getHeroArt, getLogoArt, getTileArt } from "@renderer/helpers/ps5-game";
import cn from "classnames";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FocusItem,
  HorizontalFocusGroup,
  VerticalFocusGroup,
} from "../../components";
import { useLibraryLaunchGame } from "../../components/pages/library/use-library-launch-game";
import { IS_DESKTOP } from "../../constants";
import {
  getBigPictureGameAchievementsPath,
  getBigPictureGameDetailsPath,
} from "../../helpers";
import { formatLastPlayed, formatPlayTime, tr } from "../../helpers/opus-text";
import { useLibrary, useNavigationScreenActions } from "../../hooks";
import { NavigationService } from "../../services";
import { useNavigationStore } from "../../stores";
import { HOME_PAGE_REGION_ID } from "./navigation";
import "./opus-home.scss";

const BASE_PATH = IS_DESKTOP ? "/big-picture" : "";
const STRIP_SIZE = 18;
const TILE_PREFIX = "home-tile-";
const TILES_REGION_ID = "home-tiles";
const ACTIONS_REGION_ID = "home-actions";
const CONSOLES_REGION_ID = "home-consoles";
const PLAY_BUTTON_ID = "home-play";

const gameKey = (game: LibraryGame) => `${game.shop}:${game.objectId}`;
const tileId = (game: LibraryGame) =>
  `${TILE_PREFIX}${game.shop}-${game.objectId}`;

const hasTranslation = (game: LibraryGame) =>
  /\bPT-?BR\b/i.test(game.title) ||
  (game.discs ?? []).some((disc) => /\bPT-?BR\b/i.test(disc.fileName ?? ""));

/** Most recently played first, then the newest additions: the strip is "where you left off". */
const sortRecent = (games: LibraryGame[]) =>
  [...games].sort((a, b) => {
    const playedA = a.lastTimePlayed ? new Date(a.lastTimePlayed).getTime() : 0;
    const playedB = b.lastTimePlayed ? new Date(b.lastTimePlayed).getTime() : 0;
    if (playedA !== playedB) return playedB - playedA;
    const addedA = a.addedToLibraryAt
      ? new Date(a.addedToLibraryAt).getTime()
      : 0;
    const addedB = b.addedToLibraryAt
      ? new Date(b.addedToLibraryAt).getTime()
      : 0;
    return addedB - addedA;
  });

export default function Home() {
  const navigate = useNavigate();
  const { library, loaded } = useLibrary();
  const [consoleFilter, setConsoleFilter] = useState<string>("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const currentFocusId = useNavigationStore((state) => state.currentFocusId);

  const visible = useMemo(
    () => library.filter((game) => !game.isDeleted),
    [library]
  );

  // Console chips: only consoles that actually have games, in a stable order.
  const consoles = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const game of visible) {
      const badge = getPlatformBadge(game);
      const entry = counts.get(badge.tone) ?? { label: badge.label, count: 0 };
      entry.count += 1;
      counts.set(badge.tone, entry);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .map(([tone, { label, count }]) => ({ tone, label, count }));
  }, [visible]);

  const strip = useMemo(() => {
    const filtered =
      consoleFilter === "all"
        ? visible
        : visible.filter(
            (game) => getPlatformBadge(game).tone === consoleFilter
          );
    return sortRecent(filtered).slice(0, STRIP_SIZE);
  }, [consoleFilter, visible]);

  // The focused tile drives the whole screen; moving down to the buttons keeps the last one.
  useEffect(() => {
    if (!currentFocusId?.startsWith(TILE_PREFIX)) return;
    const game = strip.find(
      (candidate) => tileId(candidate) === currentFocusId
    );
    if (game) setSelectedKey(gameKey(game));
  }, [currentFocusId, strip]);

  const selected =
    strip.find((game) => gameKey(game) === selectedKey) ?? strip[0] ?? null;

  // Keep the focused tile on screen (PS5 style: it sits near the left, the previous one peeking).
  useEffect(() => {
    if (!currentFocusId?.startsWith(TILE_PREFIX)) return;
    const frame = globalThis.requestAnimationFrame(() => {
      const container =
        globalThis.document.querySelector<HTMLElement>(".opus-home__tiles");
      const tile = container?.querySelector<HTMLElement>(
        '[data-focused="true"]'
      );
      if (!container || !tile) return;
      const previous = tile.previousElementSibling as HTMLElement | null;
      const peek = previous ? previous.offsetWidth * 0.6 : 0;
      container.scrollTo({
        // The tiles row is positioned, so offsetLeft is measured inside it.
        left: Math.max(0, tile.offsetLeft - peek),
        behavior: "smooth",
      });
    });
    return () => globalThis.cancelAnimationFrame(frame);
  }, [currentFocusId]);

  const openGamePage = useCallback(
    (game: LibraryGame) => navigate(getBigPictureGameDetailsPath(game)),
    [navigate]
  );
  const launch = useLibraryLaunchGame(openGamePage);

  useNavigationScreenActions({
    press: { y: () => navigate(`${BASE_PATH}/library?search=1`) },
  });

  // First paint: once the games arrive, start on the first tile (not on the section bar).
  const firstTileId = strip[0] ? tileId(strip[0]) : null;
  const didInitialFocusRef = useRef(false);
  useEffect(() => {
    if (didInitialFocusRef.current || !firstTileId) return;
    didInitialFocusRef.current = true;
    const { currentFocusId: focusNow } = useNavigationStore.getState();
    if (!focusNow || !focusNow.startsWith("home-")) {
      globalThis.requestAnimationFrame(() =>
        NavigationService.getInstance().setFocus(firstTileId)
      );
    }
  }, [firstTileId]);

  if (!loaded) return <div className="opus-home" />;

  if (!library.length) {
    return (
      <VerticalFocusGroup
        regionId={HOME_PAGE_REGION_ID}
        className="opus-home opus-home--empty"
      >
        <h1>{tr("Your library is empty", "Sua biblioteca está vazia")}</h1>
        <p>
          {tr(
            "Link your games folder in Settings › Emulation, or add PC games in the desktop app.",
            "Vincule a pasta dos seus jogos em Configurações › Emulação, ou adicione jogos de PC no app."
          )}
        </p>
        <FocusItem
          id="home-empty-settings"
          actions={{ primary: () => navigate(`${BASE_PATH}/settings`) }}
          asChild
        >
          <button
            type="button"
            className="opus-home__button opus-home__button--primary"
            onClick={() => navigate(`${BASE_PATH}/settings`)}
          >
            Settings
          </button>
        </FocusItem>
      </VerticalFocusGroup>
    );
  }

  const hero = selected ? getHeroArt(selected) : null;
  const logo = selected ? getLogoArt(selected) : null;
  const playTime = selected ? getDisplayedPlayTimeInMilliseconds(selected) : 0;
  const achievements = selected?.achievementCount ?? 0;
  const unlocked = selected?.unlockedAchievementCount ?? 0;
  const lastPlayed = selected
    ? formatLastPlayed(selected.lastTimePlayed)
    : null;

  return (
    <VerticalFocusGroup regionId={HOME_PAGE_REGION_ID} className="opus-home">
      <div className="opus-home__backdrop" aria-hidden="true">
        {hero && (
          <img key={hero} src={hero} alt="" className="opus-home__hero" />
        )}
        <div className="opus-home__shade" />
      </div>

      <HorizontalFocusGroup
        regionId={TILES_REGION_ID}
        className="opus-home__tiles"
        aria-label="Recent games"
      >
        {strip.map((game) => {
          const art = getTileArt(game);
          const isSelected = selected && gameKey(game) === gameKey(selected);
          return (
            <FocusItem
              key={gameKey(game)}
              id={tileId(game)}
              actions={{
                primary: () => void launch(game),
                press: { x: () => openGamePage(game) },
              }}
              asChild
            >
              <button
                type="button"
                className={cn("opus-home__tile", {
                  "opus-home__tile--selected": isSelected,
                })}
                aria-label={game.title}
                onClick={() => void launch(game)}
                style={
                  art
                    ? {
                        backgroundImage: art.fallback
                          ? `url("${art.url}"), url("${art.fallback}")`
                          : `url("${art.url}")`,
                        backgroundSize: art.fallback
                          ? `${art.size ?? "cover"}, cover`
                          : (art.size ?? "cover"),
                        backgroundPosition: art.fallback
                          ? `${art.position ?? "center"}, center`
                          : (art.position ?? "center"),
                      }
                    : undefined
                }
              >
                {!art && (
                  <span className="opus-home__tile-name">{game.title}</span>
                )}
              </button>
            </FocusItem>
          );
        })}
      </HorizontalFocusGroup>

      {selected && (
        <section className="opus-home__info">
          <div className="opus-home__eyebrow">
            <PlatformBadge game={selected} className="opus-home__badge" />
            {hasTranslation(selected) && (
              <span className="opus-home__note">
                {tr("PT-BR translation installed", "Tradução PT-BR instalada")}
              </span>
            )}
          </div>

          {logo ? (
            <img src={logo} alt={selected.title} className="opus-home__logo" />
          ) : (
            <h1 className="opus-home__title">{selected.title}</h1>
          )}

          <div className="opus-home__meta">
            {lastPlayed && <span>{lastPlayed}</span>}
            {formatPlayTime(playTime) && (
              <span>{formatPlayTime(playTime)}</span>
            )}
            {!lastPlayed && !formatPlayTime(playTime) && (
              <span>{tr("Not played yet", "Ainda não jogado")}</span>
            )}
            {achievements > 0 && (
              <span>
                {tr(
                  `Trophies ${unlocked} of ${achievements}`,
                  `Troféus ${unlocked} de ${achievements}`
                )}
              </span>
            )}
          </div>

          {achievements > 0 && (
            <div className="opus-home__progress" aria-hidden="true">
              <div
                style={{
                  width: `${Math.round((unlocked / achievements) * 100)}%`,
                }}
              />
            </div>
          )}

          <HorizontalFocusGroup
            regionId={ACTIONS_REGION_ID}
            className="opus-home__actions"
          >
            <FocusItem
              id={PLAY_BUTTON_ID}
              actions={{ primary: () => void launch(selected) }}
              asChild
            >
              <button
                type="button"
                className="opus-home__button opus-home__button--primary"
                onClick={() => void launch(selected)}
              >
                <PlayIcon size={26} weight="fill" />
                Play
              </button>
            </FocusItem>
            {achievements > 0 && (
              <FocusItem
                id="home-trophies"
                actions={{
                  primary: () =>
                    navigate(getBigPictureGameAchievementsPath(selected)),
                }}
                asChild
              >
                <button
                  type="button"
                  className="opus-home__button"
                  onClick={() =>
                    navigate(getBigPictureGameAchievementsPath(selected))
                  }
                >
                  <TrophyIcon size={26} />
                  Trophies
                </button>
              </FocusItem>
            )}
            <FocusItem
              id="home-more"
              actions={{ primary: () => openGamePage(selected) }}
              asChild
            >
              <button
                type="button"
                className="opus-home__button opus-home__button--round"
                aria-label="Game page"
                onClick={() => openGamePage(selected)}
              >
                <DotsThreeIcon size={30} weight="bold" />
              </button>
            </FocusItem>
          </HorizontalFocusGroup>
        </section>
      )}

      {consoles.length > 1 && (
        <HorizontalFocusGroup
          regionId={CONSOLES_REGION_ID}
          className="opus-home__consoles"
          aria-label="Filter by console"
        >
          {[
            { tone: "all", label: tr("All", "Todos"), count: visible.length },
            ...consoles,
          ].map((entry) => (
            <FocusItem
              key={entry.tone}
              id={`home-console-${entry.tone}`}
              actions={{ primary: () => setConsoleFilter(entry.tone) }}
              asChild
            >
              <button
                type="button"
                className={cn("opus-home__chip", {
                  "opus-home__chip--active": consoleFilter === entry.tone,
                })}
                onClick={() => setConsoleFilter(entry.tone)}
              >
                {entry.label}
                <span>{entry.count}</span>
              </button>
            </FocusItem>
          ))}
        </HorizontalFocusGroup>
      )}
    </VerticalFocusGroup>
  );
}
