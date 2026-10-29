import { DotsThreeIcon, PlayIcon, TrophyIcon } from "@phosphor-icons/react";
import { CoverFrame } from "@renderer/components/cover-frame/cover-frame";
import { getCoverRatio } from "@renderer/helpers/platform-cover";
import type { LibraryGame } from "@types";
import { getDisplayedPlayTimeInMilliseconds } from "@shared";
import { PlatformBadge } from "@renderer/components/platform-badge/platform-badge";
import { getPlatformBadge } from "@renderer/helpers/platform-badge";
import {
  getCoverArt,
  getHeroArt,
  getLogoArt,
  getTileArt,
  heroFallback,
} from "@renderer/helpers/ps5-game";
import cn from "classnames";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BumperBadge,
  FocusItem,
  HorizontalFocusGroup,
  Tabs,
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

/**
 * Full-screen art. Some games only have a small or square picture (a box scan, a 600px key art):
 * stretched to 1920x1080 it came out pixelated and cropped. Those become a soft, blurred ambient
 * backdrop instead, the way the PS5 shows games without a proper hero.
 */
function HeroBackdrop({ src }: Readonly<{ src: string }>) {
  const [soft, setSoft] = useState<boolean | null>(null);
  const [current, setCurrent] = useState(src);
  return (
    <img
      src={current}
      alt=""
      className={cn("opus-home__hero", {
        "opus-home__hero--soft": soft === true,
        "opus-home__hero--pending": soft === null,
      })}
      onLoad={(event) => {
        const { naturalWidth: width, naturalHeight: height } =
          event.currentTarget;
        setSoft(width < 1280 || width / Math.max(1, height) < 1.3);
      }}
      // An upgraded (larger) picture that doesn't exist: back to the original.
      onError={() => {
        const fallback = heroFallback(current);
        if (fallback !== current) setCurrent(fallback);
        else setSoft(true);
      }}
    />
  );
}

export default function Home() {
  const navigate = useNavigate();
  const { library, loaded } = useLibrary();
  // One platform at a time: every cover on screen shares its console's case shape (no crops).
  // Starts on the platform of the game played last; LT / RT switch.
  const [consoleFilter, setConsoleFilter] = useState<string | null>(null);
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
      // Full console name on the chip ("PlayStation 2", "Nintendo Switch"); PC stays "PC".
      const label = badge.tone === "pc" ? "PC" : badge.name;
      const entry = counts.get(badge.tone) ?? { label, count: 0 };
      entry.count += 1;
      counts.set(badge.tone, entry);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .map(([tone, { label, count }]) => ({ tone, label, count }));
  }, [visible]);

  const activeConsole = useMemo(() => {
    if (consoleFilter && consoles.some((entry) => entry.tone === consoleFilter))
      return consoleFilter;
    const lastPlayed = sortRecent(visible)[0];
    return lastPlayed
      ? getPlatformBadge(lastPlayed).tone
      : (consoles[0]?.tone ?? null);
  }, [consoleFilter, consoles, visible]);

  const strip = useMemo(
    () =>
      sortRecent(
        visible.filter((game) => getPlatformBadge(game).tone === activeConsole)
      ).slice(0, STRIP_SIZE),
    [activeConsole, visible]
  );
  const coverRatio = strip[0] ? getCoverRatio(strip[0]) : 2 / 3;

  // A new platform: its first game takes the focus (and the backdrop).
  const changeConsole = useCallback(
    (tone: string) => {
      setConsoleFilter(tone);
      setSelectedKey(null);
      // The new strip starts at its first cover, not at the previous console's scroll.
      globalThis.document
        .querySelector<HTMLElement>(".opus-home__tiles")
        ?.scrollTo({ left: 0 });
      const first = sortRecent(
        visible.filter((game) => getPlatformBadge(game).tone === tone)
      )[0];
      if (first)
        NavigationService.getInstance().requestFocusWhenAvailable(
          tileId(first)
        );
    },
    [visible]
  );

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
      // The previous cover stays fully visible (no half-cut sliver at the left edge); the row has
      // room at its end, so even the last covers can align this way.
      const previous = tile.previousElementSibling as HTMLElement | null;
      container.scrollTo({
        left: previous ? Math.max(0, previous.offsetLeft - 4) : 0,
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
        {hero && <HeroBackdrop key={hero} src={hero} />}
        <div className="opus-home__shade" />
      </div>

      {consoles.length > 1 && activeConsole && (
        <div className="opus-home__platforms">
          <BumperBadge label="LT" />
          <Tabs
            className="opus-home__platform-tabs"
            items={consoles.map((entry) => ({
              id: `home-console-${entry.tone}`,
              value: entry.tone,
              label: (
                <span
                  className={cn(
                    "opus-home__platform",
                    `platform-tone--${entry.tone}`
                  )}
                >
                  <i className="opus-home__chip-dot" aria-hidden="true" />
                  {entry.label}
                  <span className="opus-home__platform-count">
                    {entry.count}
                  </span>
                </span>
              ),
            }))}
            value={activeConsole}
            onValueChange={changeConsole}
            manageFocusRegion={false}
            itemsFocusable={false}
            ariaLabel={tr("Platforms", "Plataformas")}
          />
          <BumperBadge label="RT" />
        </div>
      )}

      <HorizontalFocusGroup
        regionId={TILES_REGION_ID}
        className="opus-home__tiles"
        aria-label="Recent games"
      >
        {strip.map((game, index) => {
          const cover = getCoverArt(game) ?? getTileArt(game)?.url ?? null;
          const isSelected = selected && gameKey(game) === gameKey(selected);
          const previous = strip[index - 1];
          const next = strip[index + 1];
          return (
            <FocusItem
              key={gameKey(game)}
              id={tileId(game)}
              // Left/right follow the strip's order. Picking the neighbour by on-screen position
              // went wrong while the row scrolled and the focused cover grew (it could jump to the
              // end of the list).
              navigationOverrides={{
                left: previous
                  ? { type: "item", itemId: tileId(previous) }
                  : { type: "block" },
                right: next
                  ? { type: "item", itemId: tileId(next) }
                  : { type: "block" },
              }}
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
                style={{ "--ratio": coverRatio } as React.CSSProperties}
                aria-label={game.title}
                onClick={() => void launch(game)}
              >
                {cover && <CoverFrame url={cover} ratio={coverRatio} eager />}
                {!cover && (
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
    </VerticalFocusGroup>
  );
}
