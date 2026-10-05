import { useEffect, useMemo, useState } from "react";
import type { LibraryGame, UserAchievement } from "@types";
import { getTrophyProgress } from "@renderer/helpers/ps5-game";
import {
  countTiers,
  type AchievementTier,
  type TierCounts,
} from "@renderer/pages/game-details/ps5/ps5-details";

// PSN trophy point values; a level every 600 points keeps early levels moving.
const TIER_POINTS: Record<AchievementTier, number> = {
  platinum: 300,
  gold: 90,
  silver: 30,
  bronze: 15,
};
const POINTS_PER_LEVEL = 600;
const FETCH_CONCURRENCY = 3;

/** Achievement lists already fetched this session (shared by the normal and Big Picture trophy screens). */
export const achievementCache = new Map<string, UserAchievement[]>();

export const keyOf = (game: { shop: string; objectId: string }) =>
  `${game.shop}:${game.objectId}`;

export interface TrophyTotals {
  earned: Record<AchievementTier, number>;
  all: number;
  level: number;
  levelProgress: number;
}

/**
 * Trophy lists for every game with achievements: the `priorityKey` game first, the rest a few at a
 * time in the background, applied in batches (one re-render every ~300 ms, not one per game).
 */
export function useTrophyData(
  library: LibraryGame[],
  priorityKey: string | null = null
) {
  const [achievementsByGame, setAchievementsByGame] = useState<
    Record<string, UserAchievement[]>
  >(() => Object.fromEntries(achievementCache));

  const games = useMemo(
    () =>
      library.filter(
        (game) => !game.isDeleted && (game.achievementCount ?? 0) > 0
      ),
    [library]
  );

  useEffect(() => {
    let cancelled = false;
    // Games with something unlocked first: they are the only ones that move the totals.
    const pending = games
      .filter((game) => !achievementCache.has(keyOf(game)))
      .sort(
        (a, b) =>
          Number(getTrophyProgress(b).unlocked > 0) -
          Number(getTrophyProgress(a).unlocked > 0)
      );
    if (pending.length === 0) return;
    const priority = pending.findIndex((game) => keyOf(game) === priorityKey);
    if (priority > 0) pending.unshift(...pending.splice(priority, 1));

    let buffer: Record<string, UserAchievement[]> = {};
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      flushTimer = null;
      if (cancelled || Object.keys(buffer).length === 0) return;
      const batch = buffer;
      buffer = {};
      setAchievementsByGame((prev) => ({ ...prev, ...batch }));
    };
    const store = (
      key: string,
      list: UserAchievement[],
      immediate: boolean
    ) => {
      achievementCache.set(key, list);
      buffer[key] = list;
      if (immediate) flush();
      else flushTimer ??= setTimeout(flush, 300);
    };

    const worker = async () => {
      while (!cancelled && pending.length) {
        const game = pending.shift()!;
        const key = keyOf(game);
        const list = await window.electron
          .getUnlockedAchievements(game.objectId, game.shop)
          .catch(() => [] as UserAchievement[]);
        if (cancelled) return;
        store(key, list ?? [], key === priorityKey);
      }
    };

    for (let i = 0; i < FETCH_CONCURRENCY; i++) void worker();

    return () => {
      cancelled = true;
      if (flushTimer) clearTimeout(flushTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [games]);

  const countsByGame = useMemo(() => {
    const result: Record<string, TierCounts> = {};
    for (const game of games) {
      const list = achievementsByGame[keyOf(game)];
      if (list?.length) result[keyOf(game)] = countTiers(list);
    }
    return result;
  }, [games, achievementsByGame]);

  const totals = useMemo<TrophyTotals>(() => {
    const earned = { platinum: 0, gold: 0, silver: 0, bronze: 0 };
    for (const game of games) {
      const counts = countsByGame[keyOf(game)];
      if (counts) {
        earned.gold += counts.earned.gold;
        earned.silver += counts.earned.silver;
        earned.bronze += counts.earned.bronze;
        earned.platinum += counts.earned.platinum;
      } else if (getTrophyProgress(game).isPlatinum) {
        earned.platinum += 1;
      }
    }

    const points = (Object.keys(earned) as AchievementTier[]).reduce(
      (sum, tier) => sum + earned[tier] * TIER_POINTS[tier],
      0
    );

    return {
      earned,
      all: earned.platinum + earned.gold + earned.silver + earned.bronze,
      level: Math.floor(points / POINTS_PER_LEVEL) + 1,
      levelProgress: (points % POINTS_PER_LEVEL) / POINTS_PER_LEVEL,
    };
  }, [games, countsByGame]);

  const percentOf = (game: LibraryGame) =>
    countsByGame[keyOf(game)]?.percent ?? getTrophyProgress(game).percent;
  const isPlatinumGame = (game: LibraryGame) =>
    countsByGame[keyOf(game)]?.isPlatinum ?? getTrophyProgress(game).isPlatinum;

  return {
    games,
    achievementsByGame,
    setAchievementsByGame,
    countsByGame,
    totals,
    percentOf,
    isPlatinumGame,
  };
}
