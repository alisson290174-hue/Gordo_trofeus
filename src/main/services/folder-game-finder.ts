import axios from "axios";
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { t } from "i18next";

import { db, gamesSublevel, levelKeys } from "@main/level";
import type { UserPreferences } from "@types";
import {
  cleanFolderTitle,
  IGNORED_FOLDER,
  isConfidentTitleMatch,
  searchTermsFor,
} from "./folder-game-finder-core";
import { pickGameExecutable } from "./installed-game-finder-core";
import { logger } from "./logger";
import { LocalNotificationManager } from "./notifications/local-notifications";
import { WindowManager } from "./window-manager";

/**
 * Finds PC games installed outside any store (the ones the user downloads himself): every
 * sub-folder of a watched folder is a game. The folder name is cleaned up, matched against the
 * Steam store and, when the match is confident, the game joins the library as a Steam game —
 * so it gets the same cover, background, logo and trophies as every other one.
 */

interface FolderVerdict {
  appid: number | null;
  checkedAt: number;
}

const RECHECK_UNMATCHED_MS = 7 * 24 * 60 * 60 * 1000;
const STEAM_SEARCH_URL = "https://store.steampowered.com/api/storesearch/";

const cacheFile = () => path.join(app.getPath("userData"), "folder-games.json");

const readCache = (): Record<string, FolderVerdict> => {
  try {
    return JSON.parse(fs.readFileSync(cacheFile(), "utf8"));
  } catch {
    return {};
  }
};

const writeCache = (cache: Record<string, FolderVerdict>) => {
  try {
    fs.writeFileSync(cacheFile(), JSON.stringify(cache));
  } catch (error) {
    logger.warn("[folder-games] could not save the cache", error);
  }
};

const normalizeFolder = (value: string) =>
  path
    .resolve(value)
    .replace(/[\\/]+$/, "")
    .toLowerCase();

const isWithin = (child: string, parent: string) =>
  child === parent || child.startsWith(`${parent}${path.sep}`);

const getPreferences = () =>
  db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);

const USER_FOLDERS = ["downloads", "desktop", "documents"].map((name) => {
  try {
    return normalizeFolder(app.getPath(name as "downloads"));
  } catch {
    return "";
  }
});

/**
 * Folders that hold more than one game folder of the library — where the user keeps his games.
 * Store folders (Steam, Epic, Xbox, Program Files) and personal folders (Downloads…) are left out:
 * stores are synced on their own, and personal folders are full of things that are not games.
 */
const deriveGameFolders = (executablePaths: string[]) => {
  const counts = new Map<string, number>();
  const spelling = new Map<string, string>();
  for (const executablePath of executablePaths) {
    const normalized = normalizeFolder(executablePath);
    if (
      /steamapps|xboxgames|program files|epic games|\\emuladores\\/.test(
        normalized
      )
    )
      continue;
    // drive\games-root\game-folder\...\game.exe → drive\games-root
    const parts = normalized.split(path.sep);
    if (parts.length < 4) continue;
    const root = parts.slice(0, 2).join(path.sep);
    // Never a personal folder, nor a folder that contains them (C:\Users) or the system.
    if (
      /^[a-z]:\\(users|windows|programdata)$/.test(root) ||
      USER_FOLDERS.some(
        (folder) => folder && (isWithin(root, folder) || isWithin(folder, root))
      )
    )
      continue;
    counts.set(root, (counts.get(root) ?? 0) + 1);
    // Shown in Settings: keep the folder as it is written on disk, not lower-cased.
    spelling.set(
      root,
      path.resolve(executablePath).split(path.sep).slice(0, 2).join(path.sep)
    );
  }
  return [...counts]
    .filter(([, count]) => count >= 2)
    .map(([root]) => spelling.get(root) ?? root);
};

export const getGameFolders = async () => {
  const preferences = await getPreferences();
  if (preferences?.gameFolders?.length) return preferences.gameFolders;

  const executablePaths: string[] = [];
  for await (const game of gamesSublevel.values()) {
    if (game.executablePath) executablePaths.push(game.executablePath);
  }
  const defaults = [String.raw`C:\Games`, String.raw`D:\Games`].filter((dir) =>
    fs.existsSync(dir)
  );
  return [...new Set([...deriveGameFolders(executablePaths), ...defaults])];
};

const searchSteam = async (title: string) => {
  const response = await axios.get<{
    items?: { id: number; name: string; type: string }[];
  }>(STEAM_SEARCH_URL, {
    params: { term: title, cc: "us", l: "english" },
    timeout: 10_000,
  });
  return (response.data.items ?? []).filter((item) => item.type === "app");
};

export interface FolderGameAdded {
  title: string;
  executablePath: string;
  iconUrl: string | null;
}

let running: Promise<FolderGameAdded[]> | null = null;

/** Looks for new game folders and adds the ones it recognises; returns the games added. */
export const findNewFolderGames = (extraFolders: string[] = []) => {
  running ??= scan(extraFolders).finally(() => {
    running = null;
  });
  return running;
};

async function scan(extraFolders: string[]): Promise<FolderGameAdded[]> {
  const preferences = await getPreferences();
  const ignored = new Set(
    (preferences?.ignoredGameFolders ?? []).map(normalizeFolder)
  );

  // Folders already holding a library game — including removed ones, which must not come back.
  const takenFolders: string[] = [];
  const knownSteamGames = new Map<string, { isDeleted: boolean }>();
  for await (const [key, game] of gamesSublevel.iterator()) {
    if (game.executablePath)
      takenFolders.push(normalizeFolder(path.dirname(game.executablePath)));
    if (game.shop === "steam") knownSteamGames.set(key, game);
  }

  const cache = readCache();
  const added: FolderGameAdded[] = [];

  const roots = [...new Set([...(await getGameFolders()), ...extraFolders])];
  for (const root of roots) {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || IGNORED_FOLDER.test(entry.name)) continue;
      const folder = path.join(root, entry.name);
      const normalized = normalizeFolder(folder);
      if (ignored.has(normalized)) continue;
      if (takenFolders.some((taken) => isWithin(taken, normalized))) continue;

      // Folders Steam had no confident match for are asked again only once a week.
      const verdict = cache[normalized];
      if (
        verdict?.appid === null &&
        Date.now() - verdict.checkedAt < RECHECK_UNMATCHED_MS
      )
        continue;

      const folderTitle = cleanFolderTitle(entry.name);
      let match: { id: number; name: string } | undefined;
      try {
        for (const term of searchTermsFor(folderTitle)) {
          const results = await searchSteam(term);
          match = results.find((item) =>
            isConfidentTitleMatch(folderTitle, item.name)
          );
          if (match) break;
        }
      } catch (error) {
        logger.warn(
          `[folder-games] Steam search failed for "${folderTitle}"`,
          error
        );
        continue;
      }

      cache[normalized] = { appid: match?.id ?? null, checkedAt: Date.now() };
      if (!match) {
        logger.info(
          `[folder-games] no confident match for ${folder} ("${folderTitle}")`
        );
        continue;
      }

      const existing = knownSteamGames.get(
        levelKeys.game("steam", String(match.id))
      );
      if (existing?.isDeleted) {
        logger.info(
          `[folder-games] ${match.name} was removed by the user; not adding back`
        );
        continue;
      }

      const executablePath = pickGameExecutable(match.name, {
        key: "",
        name: match.name,
        location: folder,
        icon: null,
      });
      if (!executablePath) {
        logger.info(`[folder-games] ${match.name}: no executable in ${folder}`);
        continue;
      }

      const { addGameOutsideLibrary } =
        await import("@main/events/library/scan-installed-games");
      const result = await addGameOutsideLibrary(
        String(match.id),
        executablePath
      );
      if (result) {
        added.push(result);
        takenFolders.push(normalizeFolder(path.dirname(executablePath)));
        logger.info(`[folder-games] added ${result.title}: ${executablePath}`);
      }
    }
  }

  writeCache(cache);

  if (added.length > 0) {
    WindowManager.sendToAppWindows("on-library-batch-complete");
    await LocalNotificationManager.createNotification(
      "SCAN_GAMES_COMPLETE",
      t("folder_games_added_title", {
        ns: "notifications",
        count: added.length,
      }),
      added.map((game) => game.title).join(", "),
      { url: "/library" }
    ).catch(() => {});
  }

  return added;
}

/** Runs at startup (after the library settles) and every 15 minutes. */
export const scheduleFolderGameFinder = () => {
  const run = () =>
    void findNewFolderGames().catch((error) =>
      logger.warn("[folder-games] scan skipped", error?.message ?? error)
    );
  setTimeout(run, 45_000);
  setInterval(run, 15 * 60 * 1000);
};
