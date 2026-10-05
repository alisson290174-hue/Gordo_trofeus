import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger";
import { gamesSublevel, levelKeys } from "@main/level";
import { addCustomGame } from "@main/helpers/add-custom-game";
import { findAndApplyGameArtwork } from "./game-artwork-finder";
import { WindowManager } from "./window-manager";
import {
  parseAppUserModelId,
  parseMicrosoftGameConfig,
} from "./xbox-games-core";

export { computePublisherId, parseAppUserModelId } from "./xbox-games-core";

/**
 * Games installed by the Xbox app (Game Pass / Microsoft Store) live in "<drive>:\XboxGames\<game>"
 * with a normal executable inside "Content". They are found by the installed-games scan like any
 * other folder; to play, they start through Windows (shell:AppsFolder), as the Start menu does,
 * because store games may refuse to run when their .exe is opened directly.
 */

const XBOX_FOLDER_NAME = "XboxGames";
const MANIFEST_FILE = "appxmanifest.xml";
const MAX_PARENT_LEVELS = 8;
/** The package an executable belongs to, when it sits inside an XboxGames folder. */
export const findXboxAppUserModelId = (executablePath: string) => {
  if (process.platform !== "win32" || !executablePath) return null;
  const segments = path.resolve(executablePath).split(path.sep);
  if (
    !segments.some(
      (segment) => segment.toLowerCase() === XBOX_FOLDER_NAME.toLowerCase()
    )
  )
    return null;

  let directory = path.dirname(path.resolve(executablePath));
  for (let level = 0; level < MAX_PARENT_LEVELS; level++) {
    const manifestPath = path.join(directory, MANIFEST_FILE);
    if (fs.existsSync(manifestPath)) {
      try {
        return parseAppUserModelId(fs.readFileSync(manifestPath, "utf8"));
      } catch (error) {
        logger.warn("[Xbox] Could not read the package manifest", error);
        return null;
      }
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return null;
};

/** "<drive>:\XboxGames" on every drive that has one (where the Xbox app installs games). */
export const getXboxGamesDirectories = () => {
  if (process.platform !== "win32") return [];
  const directories: string[] = [];
  for (let code = 67; code <= 90; code++) {
    const directory = `${String.fromCodePoint(code)}:\\${XBOX_FOLDER_NAME}`;
    try {
      if (fs.statSync(directory).isDirectory()) directories.push(directory);
    } catch {
      // No such drive / folder.
    }
  }
  return directories;
};

/** Starts a store game the way the Start menu does. */
export const launchXboxGame = (appUserModelId: string) => {
  const child = spawn("explorer.exe", [`shell:AppsFolder\\${appUserModelId}`], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.on("error", (error) =>
    logger.error("[Xbox] Failed to start the game", error)
  );
  child.unref();
  logger.info(`[Xbox] Started ${appUserModelId}`);
};

const CONFIG_FILE = "MicrosoftGame.config";

interface StartApp {
  Name: string;
  AppID: string;
}

/** Start menu names ("DRAGON QUEST XI S: …") keyed by package name; empty when unavailable. */
const readStartMenuNames = () =>
  new Promise<Map<string, string>>((resolve) => {
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-StartApps | Select-Object Name, AppID | ConvertTo-Json -Compress",
      ],
      { windowsHide: true, timeout: 20_000, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => {
        const names = new Map<string, string>();
        if (error) {
          logger.warn("[Xbox] Could not read Start menu names", error);
          resolve(names);
          return;
        }
        try {
          const parsed = JSON.parse(stdout) as StartApp | StartApp[];
          for (const app of Array.isArray(parsed) ? parsed : [parsed]) {
            const packageName = app.AppID?.split("_")[0];
            if (packageName && app.Name) names.set(packageName, app.Name);
          }
        } catch {
          // Unexpected output: fall back to the config names.
        }
        resolve(names);
      }
    );
  });

const findConfig = (gameDirectory: string) =>
  [
    path.join(gameDirectory, "Content", CONFIG_FILE),
    path.join(gameDirectory, CONFIG_FILE),
  ]
    .map((candidate) => {
      // The file name's case varies ("MicrosoftGame.Config").
      const directory = path.dirname(candidate);
      try {
        const match = fs
          .readdirSync(directory)
          .find((entry) => entry.toLowerCase() === CONFIG_FILE.toLowerCase());
        return match ? path.join(directory, match) : null;
      } catch {
        return null;
      }
    })
    .find(Boolean) ?? null;

/**
 * Adds the Xbox app games installed on this PC to the library (only new ones; a game the user
 * removed stays removed), with Steam art found by name. Windows only, runs in the background.
 */
export const importXboxGames = async () => {
  const roots = getXboxGamesDirectories();
  if (roots.length === 0) return 0;

  const found: {
    executablePath: string;
    identityName: string;
    fallbackTitle: string;
  }[] = [];
  for (const root of roots) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const configPath = findConfig(path.join(root, entry.name));
      if (!configPath) continue;
      const config = parseMicrosoftGameConfig(
        fs.readFileSync(configPath, "utf8")
      );
      if (!config) continue;
      const executablePath = path.join(
        path.dirname(configPath),
        config.executable
      );
      if (!fs.existsSync(executablePath)) continue;
      found.push({
        executablePath,
        identityName: config.identityName,
        fallbackTitle: config.displayName ?? entry.name,
      });
    }
  }
  if (found.length === 0) return 0;

  const libraryGames = await gamesSublevel.values().all();
  const known = new Set(
    libraryGames
      .map((game) => game.executablePath?.toLowerCase())
      .filter(Boolean)
  );

  // Xbox games still without art (the lookup missed before) get another try.
  for (const game of libraryGames) {
    if (game.platform !== "xbox" || game.isDeleted || game.customCoverImageUrl)
      continue;
    await findAndApplyGameArtwork(game.shop, game.objectId).catch(() => null);
  }

  const fresh = found.filter(
    (game) => !known.has(game.executablePath.toLowerCase())
  );
  if (fresh.length === 0) return 0;

  const names = await readStartMenuNames();
  let added = 0;
  for (const game of fresh) {
    const title = names.get(game.identityName) ?? game.fallbackTitle;
    try {
      const created = await addCustomGame(title, game.executablePath);
      // Tagged so the library shows it as an Xbox game (green "XBOX" badge).
      await gamesSublevel.put(levelKeys.game("custom", created.objectId), {
        ...created,
        platform: "xbox",
      });
      added++;
      logger.info(`[Xbox] Added ${title} (${game.executablePath})`);
      await findAndApplyGameArtwork("custom", created.objectId).catch((error) =>
        logger.warn(`[Xbox] No art for ${title}`, error)
      );
    } catch (error) {
      logger.warn(`[Xbox] Could not add ${title}`, error);
    }
  }

  if (added > 0) WindowManager.sendToAppWindows("on-library-batch-complete");
  return added;
};
