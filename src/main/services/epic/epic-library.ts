import path from "node:path";
import type { Game } from "@types";
import { gamesSublevel, levelKeys } from "@main/level";
import { logger } from "../logger";
import { WindowManager } from "../window-manager";
import { runLegendary } from "./legendary";
import { listEpicGames } from "./epic-account";

/**
 * Puts the games of the connected Epic account into the Opus library (shop "epic",
 * objectId = Epic app name). Art comes from Epic's own metadata; nothing is sent to our server.
 */

interface InstalledEntry {
  app_name: string;
  install_path: string;
  executable: string;
  version?: string;
  install_size?: number;
}

export async function getEpicInstalled(): Promise<Map<string, InstalledEntry>> {
  const { stdout } = await runLegendary(["list-installed", "--json"], {
    timeoutMs: 60_000,
  });
  const entries = JSON.parse(stdout) as InstalledEntry[];
  return new Map(entries.map((entry) => [entry.app_name, entry]));
}

export const epicExecutablePath = (entry: InstalledEntry) =>
  path.join(entry.install_path, entry.executable);

let syncing: Promise<number> | null = null;

/** Adds/updates owned Epic games; games no longer owned are hidden. Returns how many are in the library. */
export function syncEpicLibrary(): Promise<number> {
  syncing ??= (async () => {
    const [owned, installed] = await Promise.all([
      listEpicGames(),
      getEpicInstalled(),
    ]);
    const games = owned.filter((game) => !game.isDlc);
    const ownedKeys = new Set<string>();

    for (const epicGame of games) {
      const key = levelKeys.game("epic", epicGame.appName);
      ownedKeys.add(key);
      const existing = await gamesSublevel.get(key).catch(() => null);
      const install = installed.get(epicGame.appName);

      const next: Game = {
        ...existing,
        title: existing?.title || epicGame.title,
        objectId: epicGame.appName,
        shop: "epic",
        iconUrl: existing?.iconUrl ?? null,
        libraryHeroImageUrl:
          epicGame.wideUrl ?? existing?.libraryHeroImageUrl ?? null,
        coverImageUrl: epicGame.coverUrl ?? existing?.coverImageUrl ?? null,
        logoImageUrl: existing?.logoImageUrl ?? null,
        remoteId: null,
        isDeleted: existing?.removedByUser === true,
        playTimeInMilliseconds: existing?.playTimeInMilliseconds ?? 0,
        lastTimePlayed: existing?.lastTimePlayed ?? null,
        addedToLibraryAt: existing?.addedToLibraryAt ?? new Date(),
        platform: existing?.platform ?? null,
        executablePath: install ? epicExecutablePath(install) : null,
        installedSizeInBytes:
          install?.install_size ?? existing?.installedSizeInBytes ?? null,
      } as Game;

      await gamesSublevel.put(key, next);
    }

    // Games that left the account (refunds, expired free weekends) disappear from the library.
    for (const [key, game] of await gamesSublevel.iterator().all()) {
      if (game?.shop === "epic" && !game.isDeleted && !ownedKeys.has(key)) {
        await gamesSublevel.put(key, { ...game, isDeleted: true });
      }
    }

    logger.info(`[epic] library synced: ${games.length} game(s)`);
    WindowManager.sendToAppWindows("on-library-batch-complete");
    return games.length;
  })().finally(() => {
    syncing = null;
  });

  return syncing;
}
