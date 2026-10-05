import { shell } from "electron";
import type { Game } from "@types";
import { gamesSublevel, levelKeys } from "@main/level";
import { HydraApi } from "../hydra-api";
import { logger } from "../logger";
import { WindowManager } from "../window-manager";
import { getSteamAppInstallDirectories } from "../steam-integration/steam-installation";
import { syncSteamOwnedAchievements } from "./steam-owned-achievements";

/**
 * Steam account games in the Opus library. The list comes from our server (Steam ID from the
 * Steam sign-in + the server's Web API key); "installed" comes from Steam's own appmanifest files
 * on this PC. Installing and playing go through the Steam client (steam:// links) — Steam doesn't
 * allow downloading its games any other way.
 */
interface OwnedGamesResponse {
  visible: boolean;
  games: {
    appId: string;
    title: string;
    playtimeMinutes: number;
    lastPlayedAt: number | null;
  }[];
}

export interface SteamOwnedSyncResult {
  visible: boolean;
  total: number;
  installed: number;
}

const isAppId = (value: string) => /^\d{1,10}$/.test(value);

let syncing: Promise<SteamOwnedSyncResult> | null = null;

export function syncSteamOwnedLibrary(): Promise<SteamOwnedSyncResult> {
  syncing ??= (async () => {
    const data = await HydraApi.get<OwnedGamesResponse>(
      "/profile/steam/owned-games"
    );
    if (!data.visible) {
      logger.info(
        "[steam-owned] game details are private on the Steam profile"
      );
      return { visible: false, total: 0, installed: 0 };
    }

    const games = data.games.filter((game) => isAppId(game.appId));
    const installDirs = await getSteamAppInstallDirectories(
      games.map((game) => game.appId)
    );
    const owned = new Set<string>();

    for (const steamGame of games) {
      const key = levelKeys.game("steam", steamGame.appId);
      owned.add(key);
      const existing = await gamesSublevel.get(key).catch(() => null);

      const next: Game = {
        ...existing,
        title: existing?.title || steamGame.title,
        objectId: steamGame.appId,
        shop: "steam",
        iconUrl: existing?.iconUrl ?? null,
        libraryHeroImageUrl: existing?.libraryHeroImageUrl ?? null,
        logoImageUrl: existing?.logoImageUrl ?? null,
        remoteId: existing?.remoteId ?? null,
        isDeleted: false,
        playTimeInMilliseconds: existing?.playTimeInMilliseconds ?? 0,
        lastTimePlayed: existing?.lastTimePlayed ?? null,
        addedToLibraryAt: existing?.addedToLibraryAt ?? new Date(),
        platform: existing?.platform ?? null,
        hasActiveSteamImport: true,
        steamPlayTimeInMilliseconds: steamGame.playtimeMinutes * 60_000,
        steamInstalled: installDirs.has(steamGame.appId),
      } as Game;

      await gamesSublevel.put(key, next);
    }

    // No longer on the account → back to a plain catalogue entry (kept if it had its own copy).
    for (const [key, game] of await gamesSublevel.iterator().all()) {
      if (
        game?.shop === "steam" &&
        game.hasActiveSteamImport &&
        !owned.has(key)
      ) {
        await gamesSublevel.put(key, {
          ...game,
          hasActiveSteamImport: false,
          steamInstalled: false,
        });
      }
    }

    logger.info(
      `[steam-owned] synced ${games.length} game(s), ${installDirs.size} installed via Steam`
    );
    WindowManager.sendToAppWindows("on-library-batch-complete");
    // Trophies for the games played on Steam — in the background, the library is ready already.
    void syncSteamOwnedAchievements(games).catch((error) =>
      logger.warn("[steam-achievements] sync skipped", error?.message ?? error)
    );
    return { visible: true, total: games.length, installed: installDirs.size };
  })().finally(() => {
    syncing = null;
  });

  return syncing;
}

/**
 * Periodic check while the app is open: picks up achievements from games just played on Steam
 * (only games whose "last played" changed are asked again; the server caches the list 10 min).
 */
export async function refreshSteamOwnedAchievements() {
  const data = await HydraApi.get<OwnedGamesResponse>(
    "/profile/steam/owned-games"
  );
  if (!data.visible) return 0;
  return syncSteamOwnedAchievements(
    data.games.filter((game) => isAppId(game.appId))
  );
}

/** Opens Steam's own install dialog for the game. */
export async function installThroughSteam(appId: string) {
  if (!isAppId(appId)) throw new Error("invalid Steam app id");
  await shell.openExternal(`steam://install/${appId}`);
}

/** Starts a Steam-installed game through the Steam client. */
export async function launchThroughSteam(appId: string) {
  if (!isAppId(appId)) throw new Error("invalid Steam app id");
  await shell.openExternal(`steam://rungameid/${appId}`);
}
