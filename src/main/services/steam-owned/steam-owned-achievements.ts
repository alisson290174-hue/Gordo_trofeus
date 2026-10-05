import { chunk } from "lodash-es";
import type { UnlockedAchievement } from "@types";
import { gamesSublevel, levelKeys } from "@main/level";
import { HydraApi } from "../hydra-api";
import { logger } from "../logger";
import { AchievementWatcherManager } from "../achievements/achievement-watcher-manager";
import { mergeAchievements } from "../achievements/merge-achievements";
import { mergeWithRemoteGames } from "../library-sync/merge-with-remote-games";

/**
 * Trophies for games bought on Steam. Steam keeps those achievements on its servers (not in files
 * the watcher can read), so our server asks Steam for the signed-in user's own unlocks and they go
 * through the same merge as every other source — same tiers, platinum and profile sync.
 * A game is only asked again when Steam's "last played" changes.
 */
export interface SteamPlayedGame {
  appId: string;
  playtimeMinutes: number;
  lastPlayedAt: number | null;
}

interface SteamAchievementsResponse {
  visible: boolean;
  games: Record<string, UnlockedAchievement[]>;
}

const SERVER_BATCH = 25;
const PRE_SEARCH_WAIT_MS = 3 * 60 * 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Remote sync of achievements only runs after the watcher's first pass — wait for it. */
async function waitForAchievementPreSearch() {
  const deadline = Date.now() + PRE_SEARCH_WAIT_MS;
  while (
    !AchievementWatcherManager.hasFinishedPreSearch &&
    Date.now() < deadline
  ) {
    await sleep(2000);
  }
}

let running: Promise<number> | null = null;

export function syncSteamOwnedAchievements(
  played: SteamPlayedGame[]
): Promise<number> {
  running ??= (async () => {
    const pending: { appId: string; syncedFor: number }[] = [];

    for (const steamGame of played) {
      if (steamGame.playtimeMinutes <= 0) continue;
      const game = await gamesSublevel
        .get(levelKeys.game("steam", steamGame.appId))
        .catch(() => null);
      if (!game || game.isDeleted) continue;
      const syncedFor = steamGame.lastPlayedAt ?? 0;
      if (game.steamAchievementsCheckedFor === syncedFor) continue;
      pending.push({ appId: steamGame.appId, syncedFor });
    }

    if (pending.length === 0) return 0;

    // Games new to the library still need their profile entry before achievements can sync.
    const withoutRemote: string[] = [];
    for (const { appId } of pending) {
      const game = await gamesSublevel
        .get(levelKeys.game("steam", appId))
        .catch(() => null);
      if (game && !game.remoteId) withoutRemote.push(appId);
    }
    if (withoutRemote.length > 0) {
      for (const appIds of chunk(withoutRemote, 30)) {
        await HydraApi.post(
          "/profile/games/batch",
          appIds.map((objectId) => ({
            objectId,
            shop: "steam",
            playTimeInMilliseconds: 0,
            lastTimePlayed: null,
            isFavorite: false,
            isPinned: false,
          }))
        ).catch(() => {});
      }
      await mergeWithRemoteGames().catch(() => {});
    }

    await waitForAchievementPreSearch();

    let unlockedTotal = 0;
    for (const batch of chunk(pending, SERVER_BATCH)) {
      const data = await HydraApi.post<SteamAchievementsResponse>(
        "/profile/steam/achievements",
        {
          appIds: batch.map((item) => item.appId),
        }
      );

      if (!data.visible) {
        logger.info(
          "[steam-achievements] game details are private on the Steam profile"
        );
        break;
      }

      for (const { appId, syncedFor } of batch) {
        const key = levelKeys.game("steam", appId);
        const game = await gamesSublevel.get(key).catch(() => null);
        if (!game) continue;

        const unlocks = data.games[appId] ?? [];
        let merged = true;
        if (unlocks.length > 0) {
          // No pop-up or screenshot: these were unlocked earlier, inside Steam.
          unlockedTotal += await mergeAchievements(game, unlocks, false).catch(
            (error) => {
              merged = false;
              logger.warn(
                `[steam-achievements] merge failed for ${appId}`,
                error?.message ?? error
              );
              return 0;
            }
          );
        }

        // Only marked done once the unlocks could reach the profile: a game still without its
        // profile entry (remoteId), or whose merge failed, is tried again on the next run.
        const reachedProfile =
          merged &&
          Boolean(game.remoteId) &&
          AchievementWatcherManager.hasFinishedPreSearch;
        const latest = await gamesSublevel.get(key).catch(() => null);
        if (latest && reachedProfile) {
          await gamesSublevel.put(key, {
            ...latest,
            steamAchievementsCheckedFor: syncedFor,
          });
        }
      }
    }

    logger.info(
      `[steam-achievements] checked ${pending.length} game(s), ${unlockedTotal} new achievement(s)`
    );
    return unlockedTotal;
  })().finally(() => {
    running = null;
  });

  return running;
}
