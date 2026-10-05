import { getPlatformBadge } from "../../helpers/platform-badge";

// "pc" / "steam_library" stay for the profile filters; the library page uses the store split.
export type LibraryCategory =
  | "all"
  | "pc"
  | "steam_library"
  | "classics"
  | "steam"
  | "epic"
  | "torrent"
  /** One emulated console, by platform-badge tone ("console:ps2"). */
  | `console:${string}`;

export const CONSOLE_CATEGORY_PREFIX = "console:";

export const isConsoleCategory = (
  category: string
): category is `console:${string}` =>
  category.startsWith(CONSOLE_CATEGORY_PREFIX);

/** Filters shown on the library page, in order. */
export const LIBRARY_PAGE_CATEGORIES: LibraryCategory[] = [
  "all",
  "steam",
  "epic",
  "torrent",
  "classics",
];

export interface LibraryCategoryGame {
  shop: string;
  platform?: string | null;
  hasActiveSteamImport?: boolean;
}

export interface ProfileLibraryFilter {
  shops: string[];
  steamLibrary: boolean;
}

export const isSteamLibraryGame = (game: LibraryCategoryGame) =>
  game.hasActiveSteamImport === true;

export const shouldShowSteamLibraryBadge = (
  game: LibraryCategoryGame,
  hideSteamLibraryBadges = false
) => !hideSteamLibraryBadges && isSteamLibraryGame(game);

export const shouldShowProfileSteamLibraryBadge = (
  game: LibraryCategoryGame,
  isOwnProfile: boolean,
  hideSteamLibraryBadges = false
) => isOwnProfile && shouldShowSteamLibraryBadge(game, hideSteamLibraryBadges);

export const filterLibraryGamesByCategory = <T extends LibraryCategoryGame>(
  games: T[],
  category: LibraryCategory
): T[] => {
  if (category === "pc") {
    return games.filter((game) => game.shop !== "launchbox");
  }

  if (category === "steam_library") {
    return games.filter(isSteamLibraryGame);
  }

  if (category === "classics") {
    return games.filter((game) => game.shop === "launchbox");
  }

  if (isConsoleCategory(category)) {
    const tone = category.slice(CONSOLE_CATEGORY_PREFIX.length);
    return games.filter(
      (game) =>
        game.shop === "launchbox" && getPlatformBadge(game).tone === tone
    );
  }

  // Games owned on the Steam account (imported), installed through the Steam client.
  if (category === "steam") {
    return games.filter(isSteamLibraryGame);
  }

  if (category === "epic") {
    return games.filter((game) => game.shop === "epic");
  }

  // Everything added from the catalogue (torrents / repacks) or by executable.
  if (category === "torrent") {
    return games.filter(
      (game) =>
        (game.shop === "steam" && !isSteamLibraryGame(game)) ||
        game.shop === "custom"
    );
  }

  return games;
};

export const getProfileLibraryFilter = (
  platform: LibraryCategory
): ProfileLibraryFilter => {
  if (platform === "classics") {
    return { shops: ["launchbox"], steamLibrary: false };
  }

  if (platform === "steam_library") {
    return { shops: ["steam"], steamLibrary: true };
  }

  if (platform === "pc") {
    return { shops: ["steam"], steamLibrary: false };
  }

  return { shops: ["steam", "launchbox"], steamLibrary: false };
};

export const appendProfileLibraryFilterParams = (
  params: URLSearchParams,
  filter: ProfileLibraryFilter
) => {
  filter.shops.forEach((shop) => params.append("shop", shop));
  if (filter.steamLibrary) params.set("steamLibrary", "true");
};
