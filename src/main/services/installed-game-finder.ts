import fs from "node:fs";
import { execFile } from "node:child_process";
import type { Game } from "@types";
import { displayGameTitle } from "@shared";
import { downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { updateGameExecutablePath } from "@main/helpers/update-executable-path";
import { logger } from "./logger";
import { WindowManager } from "./window-manager";
import {
  findEntryForGame,
  pickGameExecutable,
  type UninstallEntry,
} from "./installed-game-finder-core";

/**
 * Finds where a downloaded game got installed. Real installers (GOG, Inno Setup — used by most
 * repacks —, NSIS, MSI) register the program under Windows' "Installed apps" (the Uninstall keys)
 * with its name and folder. Once an entry whose name matches the game shows up, the game's
 * executable is picked from that folder and saved, so "Jogar" works without setting it by hand.
 */

const UNINSTALL_ROOTS = [
  "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*",
  "HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*",
  "HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*",
];

// Fixed script (no user input) — UTF-8 output so accented names and paths survive.
const READ_SCRIPT = `[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-ItemProperty ${UNINSTALL_ROOTS.map((r) => `'${r}'`).join(",")} -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName } | Select-Object PSPath,DisplayName,InstallLocation,DisplayIcon | ConvertTo-Json -Compress`;

export async function readUninstallEntries(): Promise<UninstallEntry[]> {
  if (process.platform !== "win32") return [];
  const output = await new Promise<string>((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", READ_SCRIPT],
      { windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 30_000 },
      (error, stdout) => resolve(error ? "" : stdout)
    );
  });
  if (!output.trim()) return [];
  try {
    const parsed = JSON.parse(output) as
      Record<string, string | null> | Record<string, string | null>[];
    return (Array.isArray(parsed) ? parsed : [parsed]).map((row) => ({
      key: String(row.PSPath ?? ""),
      name: String(row.DisplayName ?? "").trim(),
      location: row.InstallLocation ? String(row.InstallLocation).trim() : null,
      icon: row.DisplayIcon ? String(row.DisplayIcon).trim() : null,
    }));
  } catch {
    return [];
  }
}

async function saveExecutable(
  game: Game,
  executablePath: string,
  source: string
) {
  const key = levelKeys.game(game.shop, game.objectId);
  const latest = await gamesSublevel.get(key).catch(() => null);
  if (
    !latest ||
    (latest.executablePath && fs.existsSync(latest.executablePath))
  )
    return false;
  await gamesSublevel.put(
    key,
    updateGameExecutablePath(latest, executablePath)
  );
  logger.info(`[installed-game-finder] ${key} → ${executablePath} (${source})`);
  WindowManager.sendToAppWindows("on-library-batch-complete");
  return true;
}

const POLL_MS = 15_000;
const WATCH_FOR_MS = 2 * 60 * 60 * 1000;
const watching = new Map<string, NodeJS.Timeout>();

/**
 * Called right after "Instalar" starts an installer: remembers what was already registered and
 * keeps checking until a new matching entry appears (or two hours pass).
 */
export async function watchGameInstallation(game: Game) {
  if (process.platform !== "win32") return;
  const key = levelKeys.game(game.shop, game.objectId);
  if (watching.has(key)) return;

  const title = displayGameTitle(game.title, game.shop);
  const before = new Set(
    (await readUninstallEntries()).map((entry) => entry.key)
  );
  const startedAt = Date.now();

  const tick = async () => {
    watching.delete(key);
    const entries = await readUninstallEntries();
    const fresh = entries.filter((entry) => !before.has(entry.key));
    const entry = findEntryForGame(title, fresh);
    const exe = entry ? pickGameExecutable(title, entry) : null;
    if (exe) {
      await saveExecutable(game, exe, `installed as "${entry!.name}"`);
      return;
    }
    if (Date.now() - startedAt < WATCH_FOR_MS)
      watching.set(key, setTimeout(tick, POLL_MS));
  };

  watching.set(key, setTimeout(tick, POLL_MS));
}

/**
 * On startup: games whose download finished but that still have no executable are matched against
 * what's installed now — covers installs that finished while Opus was closed.
 */
export async function findInstalledDownloadedGames() {
  if (process.platform !== "win32") return 0;
  const downloads = await downloadsSublevel.values().all();
  const done = downloads.filter((download) => download.status === "complete");
  if (done.length === 0) return 0;

  let entries: UninstallEntry[] | null = null;
  let found = 0;
  for (const download of done) {
    const game = await gamesSublevel
      .get(levelKeys.game(download.shop, download.objectId))
      .catch(() => null);
    if (!game || game.isDeleted) continue;
    if (game.executablePath && fs.existsSync(game.executablePath)) continue;

    entries ??= await readUninstallEntries();
    const title = displayGameTitle(game.title, game.shop);
    const entry = findEntryForGame(title, entries);
    const exe = entry ? pickGameExecutable(title, entry) : null;
    if (
      exe &&
      (await saveExecutable(game, exe, `found installed as "${entry!.name}"`))
    )
      found += 1;
  }
  return found;
}
