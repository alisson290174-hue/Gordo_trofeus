import { useEffect, useState } from "react";
import type { UserStats } from "@types";
import type {
  TrophySummary,
  TrophySummaryGame,
  TrophyCounts,
} from "@renderer/helpers/ps5-game";

const cache = new Map<string, Promise<TrophySummary | null>>();

const fetchSummary = (userId: string): Promise<TrophySummary | null> => {
  const cached = cache.get(userId);
  if (cached) return cached;

  const request = window.electron.hydraApi
    .get<{ counts: TrophyCounts; games: TrophySummaryGame[] }>(
      `/users/${userId}/trophy-summary`,
      { needsAuth: false }
    )
    .then((response) => ({
      counts: response.counts,
      games: response.games ?? [],
      hasTiers: true,
    }))
    .catch(async () => {
      // Server without the new route yet: fall back to the old totals (no tier split).
      const stats = await window.electron.hydraApi
        .get<UserStats>(`/users/${userId}/stats`, { needsAuth: false })
        .catch(() => null);
      if (!stats) {
        cache.delete(userId);
        return null;
      }
      const platinum = stats.platinumCount ?? 0;
      const unlocked = stats.unlockedAchievementSum ?? 0;
      return {
        counts: {
          platinum,
          gold: 0,
          silver: 0,
          bronze: 0,
          total: unlocked + platinum,
        },
        games: [],
        hasTiers: false,
      };
    });

  cache.set(userId, request);
  // Keep it fresh for the next visit.
  request.finally(() => setTimeout(() => cache.delete(userId), 60_000));
  return request;
};

export function useTrophySummary(userId: string | null | undefined) {
  const [summary, setSummary] = useState<TrophySummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!userId) {
      setSummary(null);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    fetchSummary(userId).then((result) => {
      if (cancelled) return;
      setSummary(result);
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  return { summary, isLoading };
}
