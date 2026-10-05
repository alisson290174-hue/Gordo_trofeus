import type { GameShop, LibraryGame } from "@types";
import { resolveImageSource } from "@renderer/helpers";
import { getShowcaseArt } from "./showcase";
import { getPlatformBadge, type PlatformTone } from "./platform-badge";

const STEAM_CDN = "https://cdn.cloudflare.steamstatic.com/steam/apps/";

type GameArt = Partial<
  Pick<
    LibraryGame,
    | "customCoverImageUrl"
    | "coverImageUrl"
    | "libraryImageUrl"
    | "customHeroImageUrl"
    | "libraryHeroImageUrl"
    | "customLogoImageUrl"
    | "logoImageUrl"
    | "iconUrl"
    | "customIconUrl"
    | "tileImageUrl"
  >
> & { shop: GameShop; objectId: string; platform?: string | null };

const steamAsset = (game: GameArt, file: string) =>
  game.shop === "steam" && /^\d+$/.test(game.objectId)
    ? `${STEAM_CDN}${game.objectId}/${file}`
    : null;

const firstImage = (...urls: (string | null | undefined)[]) => {
  for (const url of urls) {
    const resolved = resolveImageSource(url);
    if (resolved) return resolved;
  }
  return null;
};

/**
 * Epic serves its key art at full size (1200x1600 PNG/JPEG, ~0.6 MB each): ask its CDN for the
 * size the screen needs, ~13x lighter, so the library and the Início strip paint at once.
 */
export const sizedEpicArt = (
  url: string | null,
  width: number,
  height: number
) => {
  if (
    !url ||
    !/^https:\/\/cdn\d*\.epicgames\.com\//.test(url) ||
    url.includes("?")
  )
    return url;
  return `${url}?h=${height}&quality=medium&resize=1&w=${width}`;
};

/** 2:3 box art (Biblioteca grid, Início tiles). */
export const getCoverArt = (game: GameArt) =>
  sizedEpicArt(
    firstImage(
      game.customCoverImageUrl,
      getShowcaseArt(game, "cover"),
      game.coverImageUrl,
      steamAsset(game, "library_600x900.jpg"),
      game.libraryImageUrl,
      game.libraryHeroImageUrl
    ),
    480,
    640
  );

export interface TileArt {
  url: string;
  /** Box art painted underneath: shows when the tile art fails to load or is transparent. */
  fallback?: string | null;
  /** CSS background-size/position that crop the console's strip off a box scan. */
  size?: string;
  position?: string;
}

/**
 * How to frame a box scan in a square so only its artwork shows: SNES/N64 boxes are landscape
 * with the console banner along the bottom, PS1 and Game Boy boxes carry a spine down the left,
 * 3DS/PSP/NES boxes a banner across the top. Title screens looked worse (pixel art on black or
 * flat colour), so these consoles use the framed box instead.
 */
const BOX_FRAMES: Partial<
  Record<PlatformTone, { size: string; position: string }>
> = {
  snes: { size: "auto 122%", position: "50% 12%" },
  // Landscape box: keep the logo whole and leave the red "NINTENDO 64" edge out.
  n64: { size: "cover", position: "25% 50%" },
  // Title screens are letterboxed; the box art (minus its console header) reads better.
  gamecube: { size: "cover", position: "50% 50%" },
  wii: { size: "cover", position: "50% 60%" },
  ps1: { size: "126% auto", position: "100% 35%" },
  // LaunchBox fanart for PS2 ranges from great to blank/white/screenshots: the box is consistent.
  ps2: { size: "cover", position: "50% 50%" },
  gba: { size: "122% auto", position: "100% 40%" },
  gbc: { size: "122% auto", position: "100% 40%" },
  nds: { size: "122% auto", position: "100% 40%" },
  gb: { size: "122% auto", position: "100% 40%" },
  nes: { size: "cover", position: "50% 65%" },
  n3ds: { size: "122% auto", position: "0% 55%" },
  psp: { size: "cover", position: "50% 62%" },
  // webMAN box scans: drop the "PLAYSTATION 3" spine on the left and the black top band.
  ps3: { size: "115% auto", position: "100% 60%" },
};

/**
 * Square tile in the Início strip. A custom icon wins; boxed classics get their box framed above;
 * the rest keep dedicated square art (Switch icon, PS3 ICON0, fanart) and only then the box.
 */
export const getTileArt = (game: GameArt): TileArt | null => {
  const custom = firstImage(game.customIconUrl);
  if (custom) return { url: custom };

  const cover = getCoverArt(game);
  if (game.shop === "launchbox" && cover) {
    const tone = getPlatformBadge(game).tone;
    // PS3 games without a box scan only have the disc's landscape ICON0: no frame for that.
    const frame =
      tone === "ps3" && !cover.includes("aldostools")
        ? undefined
        : BOX_FRAMES[tone];
    if (frame) return { url: cover, ...frame };
  }

  const fanart =
    game.shop === "launchbox" &&
    game.libraryHeroImageUrl &&
    game.libraryHeroImageUrl !== game.coverImageUrl
      ? game.libraryHeroImageUrl
      : null;
  const url = firstImage(game.tileImageUrl, fanart) ?? cover;
  return url ? { url, fallback: url !== cover ? cover : null } : null;
};

/** Wide key art behind the Início / Detalhes hero. */
export const getHeroArt = (game: GameArt) =>
  sizedEpicArt(
    firstImage(
      game.customHeroImageUrl,
      getShowcaseArt(game, "hero"),
      game.libraryHeroImageUrl,
      steamAsset(game, "library_hero.jpg"),
      game.libraryImageUrl
    ),
    1920,
    1080
  );

/** 460x215 capsule used by the "Descobrir" cards. */
export const getHeaderArt = (game: GameArt) =>
  firstImage(
    getShowcaseArt(game, "header"),
    steamAsset(game, "header.jpg"),
    // Classics: the fanart is landscape; the box scan would be cropped to a strip.
    game.shop === "launchbox" &&
      !game.libraryHeroImageUrl?.includes("xlenore/ps2-covers")
      ? game.libraryHeroImageUrl
      : null,
    game.libraryImageUrl,
    game.libraryHeroImageUrl,
    game.coverImageUrl
  );

export const getLogoArt = (game: GameArt) =>
  firstImage(
    game.customLogoImageUrl,
    getShowcaseArt(game, "logo"),
    game.logoImageUrl,
    steamAsset(game, "logo.png")
  );

/** Steam sends genres as { id, description }; the Hydra type calls it `name`. Accept both, drop blanks. */
export const getGenreNames = (
  genres: { name?: string; description?: string }[] | null | undefined
): string[] =>
  (genres ?? [])
    .map((genre) => genre.name || genre.description || "")
    .filter(Boolean);

export interface GameSummary {
  developer: string | null;
  year: string | null;
  genre: string | null;
  description: string | null;
}

const summaryCache = new Map<string, Promise<GameSummary | null>>();

const stripHtml = (html: string) => {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
};

/** Developer · year · genre + short blurb, from the (main-process cached) shop details. */
export const fetchGameSummary = (
  objectId: string,
  shop: GameShop,
  language: string
): Promise<GameSummary | null> => {
  const key = `${shop}:${objectId}:${language}`;
  const cached = summaryCache.get(key);
  if (cached) return cached;

  const promise = window.electron
    .getGameShopDetails(objectId, shop, language)
    .then((details) => {
      if (!details) return null;

      const yearMatch = details.release_date?.date?.match(/\d{4}/);

      return {
        developer: details.developers?.[0] ?? null,
        year: yearMatch ? yearMatch[0] : null,
        genre: getGenreNames(details.genres)[0] ?? null,
        description: details.short_description
          ? stripHtml(details.short_description)
          : null,
      };
    })
    .catch(() => {
      summaryCache.delete(key);
      return null;
    });

  summaryCache.set(key, promise);
  return promise;
};

export const formatSummaryMeta = (summary: GameSummary | null | undefined) =>
  summary
    ? [summary.developer, summary.year, summary.genre]
        .filter(Boolean)
        .join(" · ")
    : "";

export interface TrophyProgress {
  unlocked: number;
  total: number;
  percent: number;
  isPlatinum: boolean;
}

export const getTrophyProgress = (game: {
  achievementCount?: number | null;
  unlockedAchievementCount?: number | null;
}): TrophyProgress => {
  const total = game.achievementCount ?? 0;
  const unlocked = Math.min(game.unlockedAchievementCount ?? 0, total);
  const percent = total > 0 ? Math.round((unlocked / total) * 100) : 0;

  return {
    unlocked,
    total,
    percent,
    isPlatinum: total > 0 && unlocked >= total,
  };
};

export const countPlatinums = (library: LibraryGame[]) =>
  library.filter((game) => getTrophyProgress(game).isPlatinum).length;

/** "Hoje", "Ontem", "Há 4 dias", "Semana passada"… in the UI language. */
export const formatLastPlayed = (
  date: Date | string | null | undefined,
  language: string
) => {
  if (!date) return null;

  const then = new Date(date);
  if (Number.isNaN(then.getTime())) return null;

  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round(
    (startOfDay(new Date()) - startOfDay(then)) / 86_400_000
  );

  const rtf = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  const capitalize = (text: string) =>
    text.charAt(0).toLocaleUpperCase(language) + text.slice(1);

  if (days < 7) return capitalize(rtf.format(-Math.max(days, 0), "day"));
  if (days < 30) return capitalize(rtf.format(-Math.round(days / 7), "week"));
  if (days < 365)
    return capitalize(rtf.format(-Math.round(days / 30), "month"));
  return capitalize(rtf.format(-Math.round(days / 365), "year"));
};

export const formatHours = (milliseconds: number, language: string) => {
  const hours = milliseconds / 3_600_000;
  if (hours < 1) return `${Math.round(milliseconds / 60_000)} min`;

  const formatted = new Intl.NumberFormat(language, {
    maximumFractionDigits: hours < 10 ? 1 : 0,
  }).format(hours);

  return `${formatted} h`;
};

export type RarityTone = "ultra_rare" | "very_rare" | "rare" | "common";

/** Handoff rarity bands (<5 / <15 / <35 / rest) with their label colors. */
export const getRarityTone = (
  percent: number | null | undefined
): { tone: RarityTone; color: string } => {
  if (percent == null)
    return { tone: "common", color: "rgba(233,238,247,0.45)" };
  if (percent < 5) return { tone: "ultra_rare", color: "#f4b43a" };
  if (percent < 15) return { tone: "very_rare", color: "#e0a56a" };
  if (percent < 35) return { tone: "rare", color: "#9fb4d8" };
  return { tone: "common", color: "rgba(233,238,247,0.45)" };
};

// ---- Trophy summary (server `/users/:id/trophy-summary`) ----

export interface TierProgress {
  earned: number;
  total: number;
}

export interface TrophySummaryGame {
  objectId: string;
  shop: GameShop;
  title: string;
  libraryImageUrl: string | null;
  coverImageUrl: string | null;
  libraryHeroImageUrl: string | null;
  iconUrl: string | null;
  logoImageUrl: string | null;
  playTimeInSeconds: number;
  lastTimePlayed: string | null;
  achievementCount: number;
  unlockedAchievementCount: number;
  tiers: { gold: TierProgress; silver: TierProgress; bronze: TierProgress };
  isPlatinum: boolean;
  lastUnlockAt: number | null;
  platinumAt: number | null;
}

export interface TrophyCounts {
  platinum: number;
  gold: number;
  silver: number;
  bronze: number;
  total: number;
}

export interface TrophySummary {
  counts: TrophyCounts;
  /** False when only the old /stats totals were available (no per-tier split). */
  hasTiers: boolean;
  games: TrophySummaryGame[];
}

// PSN point values; a level every 600 points (same rule as the Conquistas screen).
const TROPHY_POINTS = { platinum: 300, gold: 90, silver: 30, bronze: 15 };
const POINTS_PER_LEVEL = 600;

export const computeTrophyLevel = (counts: Omit<TrophyCounts, "total">) => {
  const points =
    counts.platinum * TROPHY_POINTS.platinum +
    counts.gold * TROPHY_POINTS.gold +
    counts.silver * TROPHY_POINTS.silver +
    counts.bronze * TROPHY_POINTS.bronze;

  return {
    level: Math.floor(points / POINTS_PER_LEVEL) + 1,
    progress: (points % POINTS_PER_LEVEL) / POINTS_PER_LEVEL,
  };
};

/** Unlock times arrive in seconds or milliseconds depending on the source. */
export const toUnlockDate = (time: number | null | undefined) =>
  time ? new Date(time < 1e12 ? time * 1000 : time) : null;
