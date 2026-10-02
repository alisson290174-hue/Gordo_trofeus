import fs from "node:fs";
import path from "node:path";
import type { Game } from "@types";
import { getSteamAppInstallDirectories } from "../steam-integration/steam-installation";

/**
 * Finds the running executable of a Steam-installed game without an executables catalogue: the
 * Steam client records where each game lives (appmanifest installdir), so a process running from
 * inside that folder is the game. Helper processes that also live there are skipped.
 */
const IGNORED_EXECUTABLE =
  /crash|report|unins|setup|redist|vc_?redist|dxsetup|prereq|install|launcher|easyanticheat|eac_|start_protected_game|battleye|be_service|helper|update|cefprocess|webhelper/i;

const CACHE_MS = 5 * 60 * 1000;
let cache: { at: number; key: string; dirs: Map<string, string> } | null = null;

async function installDirectories(appIds: string[]) {
  const key = appIds.slice().sort().join(",");
  if (cache && cache.key === key && Date.now() - cache.at < CACHE_MS) return cache.dirs;
  const dirs = await getSteamAppInstallDirectories(appIds);
  cache = { at: Date.now(), key, dirs };
  return dirs;
}

/**
 * No executable yet — or the one learned earlier inside a Steam library is gone (the game was
 * reinstalled in another library folder), so it has to be learned again.
 */
export const needsSteamExecutable = (game: Game) =>
  !game.executablePath ||
  (isInsideSteamLibrary(game.executablePath) && !fs.existsSync(game.executablePath));

/** Steam-installed games (account games with no executable yet) → running .exe inside their folder. */
export async function matchSteamGamesToRunningProcesses(
  games: Game[],
  processMap: Map<string, Set<string>>
): Promise<Map<Game, string>> {
  const candidates = games.filter(
    (game) => game.shop === "steam" && game.steamInstalled && needsSteamExecutable(game)
  );
  const matches = new Map<Game, string>();
  if (candidates.length === 0) return matches;

  const dirs = await installDirectories(candidates.map((game) => game.objectId));
  if (dirs.size === 0) return matches;

  const runningPaths: string[] = [];
  for (const paths of processMap.values()) {
    for (const processPath of paths) {
      if (path.extname(processPath).toLowerCase() === ".exe") runningPaths.push(processPath);
    }
  }

  for (const game of candidates) {
    const dir = dirs.get(game.objectId);
    if (!dir) continue;
    const prefix = path.resolve(dir).toLowerCase() + path.sep;
    const found = runningPaths.find(
      (processPath) =>
        path.resolve(processPath).toLowerCase().startsWith(prefix) &&
        !IGNORED_EXECUTABLE.test(path.basename(processPath))
    );
    if (found) matches.set(game, found);
  }

  return matches;
}

/** Whether an executable sits inside a Steam library (then the game must start through Steam). */
export const isInsideSteamLibrary = (executablePath?: string | null) =>
  Boolean(executablePath && /[\\/]steamapps[\\/]common[\\/]/i.test(executablePath));
