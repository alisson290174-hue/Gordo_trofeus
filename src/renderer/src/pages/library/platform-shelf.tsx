import { useTranslation } from "react-i18next";
import cn from "classnames";
import type { LibraryGame } from "@types";
import { Icon } from "@renderer/components/icon/icon";
import { getPlatformBadge } from "@renderer/helpers/platform-badge";
import { getCoverArt } from "@renderer/helpers/ps5-game";
import { isGameInstalled } from "@renderer/helpers";
import type { LibraryCategory } from "./library-category";
import "./platform-shelf.scss";

/**
 * One card per platform at the top of the Biblioteca (replaces the row of small source/console
 * chips + the "Todos os consoles" dropdown, which said the same thing twice). Each card carries
 * the console's colour, its full name, how many games it has and a fan of three covers.
 */

export interface PlatformEntry {
  category: LibraryCategory;
  /** platform-badge tone (colours) — "all" for the overview card. */
  tone: string;
  name: string;
  short: string;
  count: number;
  installed: number;
  covers: string[];
}

const isPcGame = (game: LibraryGame) =>
  game.shop !== "launchbox" && game.platform !== "port";

export const isPlatformGame = (game: LibraryGame) =>
  game.shop === "launchbox" || game.platform === "port";

const pickCovers = (games: LibraryGame[]) => {
  // Played and installed games first: the fan shows what the user actually has.
  const sorted = [...games].sort(
    (a, b) =>
      Number(isGameInstalled(b)) - Number(isGameInstalled(a)) ||
      (b.playTimeInMilliseconds ?? 0) - (a.playTimeInMilliseconds ?? 0)
  );
  const covers: string[] = [];
  for (const game of sorted) {
    const cover = getCoverArt(game);
    if (cover && !covers.includes(cover)) covers.push(cover);
    if (covers.length === 3) break;
  }
  return covers;
};

export const buildPlatformEntries = (
  library: LibraryGame[],
  labels: { all: string; pc: string }
): PlatformEntry[] => {
  const consoles = new Map<
    string,
    { name: string; short: string; games: LibraryGame[] }
  >();
  const pcGames: LibraryGame[] = [];
  for (const game of library) {
    if (isPcGame(game)) {
      pcGames.push(game);
      continue;
    }
    const badge = getPlatformBadge(game);
    const entry = consoles.get(badge.tone) ?? {
      name: badge.name,
      short: badge.label,
      games: [],
    };
    entry.games.push(game);
    consoles.set(badge.tone, entry);
  }

  const entry = (
    category: LibraryCategory,
    tone: string,
    name: string,
    short: string,
    games: LibraryGame[]
  ): PlatformEntry => ({
    category,
    tone,
    name,
    short,
    count: games.length,
    installed: games.filter(isGameInstalled).length,
    covers: pickCovers(games),
  });

  return [
    entry("all", "all", labels.all, "", library),
    ...(pcGames.length ? [entry("pc", "pc", labels.pc, "PC", pcGames)] : []),
    ...[...consoles.entries()]
      .sort((a, b) => b[1].games.length - a[1].games.length)
      .map(([tone, { name, short, games }]) =>
        entry(`console:${tone}` as LibraryCategory, tone, name, short, games)
      ),
  ];
};

/** The platform a category belongs to ("steam"/"epic"/"torrent" live inside PC). */
export const platformOfCategory = (category: LibraryCategory) =>
  category === "steam" || category === "epic" || category === "torrent"
    ? "pc"
    : category;

interface PlatformShelfProps {
  entries: PlatformEntry[];
  category: LibraryCategory;
  onSelect: (category: LibraryCategory) => void;
}

export function PlatformShelf({
  entries,
  category,
  onSelect,
}: Readonly<PlatformShelfProps>) {
  const { t } = useTranslation("library");
  const active = platformOfCategory(category);

  return (
    <nav
      className="platform-shelf"
      aria-label={t("platforms")}
      // A plain mouse wheel scrolls the row sideways.
      onWheel={(event) => {
        if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
        event.currentTarget.scrollLeft += event.deltaY;
      }}
    >
      {entries.map((entry) => (
        <button
          key={entry.category}
          type="button"
          className={cn(
            "platform-shelf__card",
            `platform-tone--${entry.tone}`,
            { "platform-shelf__card--active": active === entry.category }
          )}
          onClick={() => onSelect(entry.category)}
          title={entry.name}
        >
          <span className="platform-shelf__text">
            <span className="platform-shelf__name">
              {entry.tone === "all" ? (
                <>
                  <Icon name="stack" size={15} />
                  {entry.name}
                </>
              ) : (
                entry.name
              )}
            </span>
            <span className="platform-shelf__count">
              {t("platform_games", { count: entry.count })}
            </span>
          </span>
          <span className="platform-shelf__fan" aria-hidden="true">
            {entry.covers.map((cover, index) => (
              <img
                key={cover}
                src={cover}
                alt=""
                loading="lazy"
                style={{ "--i": index } as React.CSSProperties}
                onError={(event) => {
                  event.currentTarget.style.display = "none";
                }}
              />
            ))}
          </span>
        </button>
      ))}
    </nav>
  );
}

interface PlatformHeroProps {
  entry: PlatformEntry;
  /** PC only: Steam / Epic / Torrent inside the PC section. */
  pcSources?: { value: LibraryCategory; label: string; count: number }[];
  category: LibraryCategory;
  onSelect: (category: LibraryCategory) => void;
  onConfigureEmulator?: () => void;
}

/** Banner of the selected platform: its colour, full name, numbers and (PC) store tabs. */
export function PlatformHero({
  entry,
  pcSources,
  category,
  onSelect,
  onConfigureEmulator,
}: Readonly<PlatformHeroProps>) {
  const { t } = useTranslation("library");
  return (
    <section
      className={cn("platform-hero", `platform-tone--${entry.tone}`)}
      aria-label={entry.name}
    >
      <div className="platform-hero__backdrop" aria-hidden="true">
        {entry.covers.map((cover) => (
          <img key={cover} src={cover} alt="" />
        ))}
      </div>
      <div className="platform-hero__body">
        {entry.short && (
          <span className="platform-hero__short">{entry.short}</span>
        )}
        <h2 className="platform-hero__name">{entry.name}</h2>
        <p className="platform-hero__stats">
          {t("platform_games", { count: entry.count })}
          <span aria-hidden="true">·</span>
          {t("platform_installed", { count: entry.installed })}
        </p>
        <div className="platform-hero__actions">
          {pcSources?.map((source) => (
            <button
              key={source.value}
              type="button"
              className={cn("platform-hero__source", {
                "platform-hero__source--active": category === source.value,
              })}
              onClick={() =>
                onSelect(category === source.value ? "pc" : source.value)
              }
            >
              {source.label}
              <span>{source.count}</span>
            </button>
          ))}
          {onConfigureEmulator && (
            <button
              type="button"
              className="platform-hero__source"
              onClick={onConfigureEmulator}
            >
              <Icon name="settings" size={14} />
              {t("platform_configure_emulator")}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

/** Section title inside the "Todos" grid (one per platform). */
export function PlatformSectionHeader({
  entry,
  onOpen,
}: Readonly<{ entry: PlatformEntry; onOpen: () => void }>) {
  const { t } = useTranslation("library");
  return (
    <div className={cn("platform-section", `platform-tone--${entry.tone}`)}>
      <span className="platform-section__bar" aria-hidden="true" />
      <h3 className="platform-section__name">{entry.name}</h3>
      <span className="platform-section__count">
        {t("platform_games", { count: entry.count })}
      </span>
      <span className="platform-section__line" aria-hidden="true" />
      <button type="button" className="platform-section__open" onClick={onOpen}>
        {t("platform_open_section")}
        <Icon name="chevron-right" size={14} />
      </button>
    </div>
  );
}
