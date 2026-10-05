import type {
  GameShop,
  SteamAchievement,
  UnlockedAchievement,
  UserAchievement,
  UserPreferences,
} from "@types";
import { UserNotLoggedInError } from "@shared";

import {
  db,
  gamesShopCacheSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import { HydraApi } from "../hydra-api";
import { logger } from "../logger";
import { getGameAchievementData } from "../achievements/get-game-achievement-data";
import {
  RetroAchievementsClient,
  type RetroAchievementsGameInfoAndUserProgress,
} from "./retro-achievements-client";
import { AchievementMemoryStore } from "../achievements/achievement-memory-store";
import { AchievementSouvenirStore } from "../achievements/achievement-souvenir-store";
import { getAchievementSouvenirs } from "../achievements/get-achievement-souvenirs";
import { computeRaHash, RA_CONSOLE, raConsoleForPlatform } from "./rom-hash";

const toMillis = (date?: string) => {
  if (!date) return null;
  const time = new Date(`${date.replace(" ", "T")}Z`).getTime();
  return Number.isNaN(time) ? null : time;
};

const sortAchievements = (a: UserAchievement, b: UserAchievement) => {
  if (a.unlocked && !b.unlocked) return -1;
  if (!a.unlocked && b.unlocked) return 1;
  if (a.unlocked && b.unlocked) {
    return b.unlockTime! - a.unlockTime!;
  }
  return Number(a.hidden) - Number(b.hidden);
};

const buildRetroAchievement = (
  achievementData: SteamAchievement,
  unlockedByName: Map<string, UnlockedAchievement>,
  souvenirs: Map<string, string>
): UserAchievement => {
  const unlocked = unlockedByName.get(achievementData.name.toUpperCase());

  return {
    ...achievementData,
    unlocked: Boolean(unlocked),
    unlockTime: unlocked?.unlockTime ?? null,
    hardcoreUnlockTime: unlocked?.hardcoreUnlockTime ?? null,
    imageUrl: unlocked
      ? (souvenirs.get(achievementData.name.toUpperCase()) ?? null)
      : null,
    source: "retroachievements" as const,
  };
};

const buildAchievementsFromCache = async (
  objectId: string,
  shop: GameShop
): Promise<UserAchievement[]> => {
  const cached = AchievementMemoryStore.get(shop, objectId);

  if (!cached) return [];

  const unlockedByName = new Map<string, UnlockedAchievement>();
  for (const unlocked of cached.unlockedAchievements ?? []) {
    unlockedByName.set(unlocked.name.toUpperCase(), unlocked);
  }

  const souvenirs = await getAchievementSouvenirs(objectId, shop);

  return (cached.achievements ?? [])
    .map((achievementData) =>
      buildRetroAchievement(achievementData, unlockedByName, souvenirs)
    )
    .sort(sortAchievements);
};

export const resolveRetroAchievementsGameId = async (
  objectId: string,
  shop: GameShop,
  retroAchievementsGameId?: number
) => {
  if (typeof retroAchievementsGameId === "number") {
    return retroAchievementsGameId;
  }

  const language = await db
    .get<string, string>(levelKeys.language, {
      valueEncoding: "utf8",
    })
    .then((value) => value || "en")
    .catch(() => "en");

  const cachedShopDetails = await gamesShopCacheSublevel
    .get(levelKeys.gameShopCacheItem(shop, objectId, language))
    .catch(() => null);

  if (typeof cachedShopDetails?.retroAchievementsGameId === "number") {
    return cachedShopDetails.retroAchievementsGameId;
  }

  const cachedEntries = await gamesShopCacheSublevel.iterator().all();
  for (const [key, details] of cachedEntries) {
    if (
      key.startsWith(`${shop}:${objectId}:`) &&
      typeof details?.retroAchievementsGameId === "number"
    ) {
      return details.retroAchievementsGameId;
    }
  }

  const game = await HydraApi.get<{
    retroAchievementsGameId: number | null;
  } | null>(`/games/${shop}/${objectId}`, null, { needsAuth: false }).catch(
    () => null
  );

  return game?.retroAchievementsGameId ?? resolveByDiscHash(objectId, shop);
};

// Disc hashes already sent this session (hit or miss), so reopening a game page never re-hashes.
const discHashAttempts = new Map<string, Promise<number | null>>();

/**
 * PS1/PS2 discs and cartridges (SNES, NES, N64, GB/GBC/GBA): hash the game like the emulator's
 * rcheevos does and let the server match it against RetroAchievements' official list. Original dumps match; patched discs (translations, Bomba Patch…) have their own
 * hash and simply have no RetroAchievements set.
 */
const resolveByDiscHash = (objectId: string, shop: GameShop) => {
  if (shop !== "launchbox") return null;
  const key = `${shop}:${objectId}`;
  let attempt = discHashAttempts.get(key);
  if (!attempt) {
    attempt = (async () => {
      const game = await gamesSublevel
        .get(levelKeys.game(shop, objectId))
        .catch(() => null);
      const discPath =
        game?.selectedDiscPath ??
        game?.discs?.[0]?.path ??
        game?.executablePath;
      const raConsole = raConsoleForPlatform(game?.platform);
      if (!discPath || !raConsole) return null;

      const hash = await computeRaHash(raConsole, discPath).catch((error) => {
        logger.warn("[retroachievements] could not hash disc", {
          discPath,
          error: String(error),
        });
        return null;
      });
      if (!hash) return null;

      const result = await HydraApi.post<{
        retroAchievementsGameId: number | null;
      }>("/profile/retroachievements/resolve", {
        shop,
        objectId,
        hash,
        consoleId: RA_CONSOLE[raConsole],
      }).catch((error) => {
        logger.warn("[retroachievements] resolve failed", String(error));
        discHashAttempts.delete(key); // transient (offline, not connected yet): retry later
        return null;
      });
      logger.info("[retroachievements] disc hash resolved", {
        objectId,
        hash,
        raGameId: result?.retroAchievementsGameId ?? null,
      });
      return result?.retroAchievementsGameId ?? null;
    })();
    discHashAttempts.set(key, attempt);
  }
  return attempt;
};

interface SyncRetroAchievementsParams {
  objectId: string;
  shop: GameShop;
  retroAchievementsGameId?: number;
  /**
   * Unlocks earned at/after this time (ms) pop the trophy notification. Set while a game is being
   * played, so a first sync never announces old trophies.
   */
  notifySince?: number;
}

type RetroAchievementsSyncStatus =
  | "success"
  | "missing_credentials"
  | "no_mapping"
  | "catalogue_unavailable"
  | "progress_unavailable";

interface RetroAchievementsSyncResult {
  achievements: UserAchievement[];
  didChange: boolean;
  status: RetroAchievementsSyncStatus;
}

const buildRetroAchievementsView = (
  catalogue: SteamAchievement[],
  unlockedByName: Map<string, UnlockedAchievement>,
  souvenirs: Map<string, string>
) => {
  return catalogue
    .map((achievementData) =>
      buildRetroAchievement(achievementData, unlockedByName, souvenirs)
    )
    .sort(sortAchievements);
};

export const syncRetroAchievements = async ({
  objectId,
  shop,
  retroAchievementsGameId,
  notifySince,
}: SyncRetroAchievementsParams): Promise<RetroAchievementsSyncResult> => {
  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    { valueEncoding: "json" }
  );

  const webApiKey = userPreferences?.retroAchievementsWebApiKey;
  const username = userPreferences?.retroAchievementsUsername;

  if (!webApiKey || !username) {
    return {
      achievements: await buildAchievementsFromCache(objectId, shop),
      didChange: false,
      status: "missing_credentials",
    };
  }

  const gameId = await resolveRetroAchievementsGameId(
    objectId,
    shop,
    retroAchievementsGameId
  );

  if (!gameId) {
    return {
      achievements: await buildAchievementsFromCache(objectId, shop),
      didChange: false,
      status: "no_mapping",
    };
  }

  let catalogue: SteamAchievement[];
  let catalogueStatus: RetroAchievementsSyncResult["status"] = "success";
  try {
    catalogue = await getGameAchievementData(objectId, shop, false);
  } catch (err) {
    logger.error("Failed to fetch RetroAchievements catalogue", err);
    return {
      achievements: await buildAchievementsFromCache(objectId, shop),
      didChange: false,
      status: "catalogue_unavailable",
    };
  }

  if (catalogue.length === 0) {
    const cachedAchievements = AchievementMemoryStore.get(shop, objectId);
    if ((cachedAchievements?.achievements?.length ?? 0) === 0) {
      catalogueStatus = "catalogue_unavailable";
    }
  }

  let data: RetroAchievementsGameInfoAndUserProgress;
  try {
    data = await RetroAchievementsClient.getGameInfoAndUserProgress({
      username,
      webApiKey,
      raGameId: gameId,
    });
  } catch (err) {
    logger.error("Failed to fetch RetroAchievements progress", err);
    return {
      achievements: await buildAchievementsFromCache(objectId, shop),
      didChange: false,
      status: "progress_unavailable",
    };
  }

  const remoteAchievements = Object.values(data.Achievements ?? {});

  const cachedAchievements = AchievementMemoryStore.get(shop, objectId);
  const unlockedByName = new Map<string, UnlockedAchievement>();
  for (const unlocked of cachedAchievements?.unlockedAchievements ?? []) {
    unlockedByName.set(unlocked.name.toUpperCase(), unlocked);
  }

  let newUnlockCount = 0;
  let didChange = false;
  const freshUnlocks: UnlockedAchievement[] = [];

  for (const achievement of remoteAchievements) {
    const name = String(achievement.ID);
    const key = name.toUpperCase();
    const unlockTime = toMillis(
      achievement.DateEarned ?? achievement.DateEarnedHardcore
    );
    const hardcoreUnlockTime = toMillis(achievement.DateEarnedHardcore);
    const existing = unlockedByName.get(key);

    if (unlockTime != null && !existing) {
      unlockedByName.set(key, { name, unlockTime, hardcoreUnlockTime });
      newUnlockCount += 1;
      didChange = true;
      if (notifySince != null && unlockTime >= notifySince) {
        freshUnlocks.push({ name, unlockTime, hardcoreUnlockTime });
      }
      continue;
    }

    if (!existing) continue;

    if (existing.unlockTime !== unlockTime && unlockTime != null) {
      unlockedByName.set(key, {
        ...existing,
        unlockTime,
      });
      didChange = true;
    }

    if (
      hardcoreUnlockTime != null &&
      unlockedByName.get(key)?.hardcoreUnlockTime !== hardcoreUnlockTime
    ) {
      unlockedByName.set(key, {
        ...unlockedByName.get(key)!,
        hardcoreUnlockTime,
      });
      didChange = true;
    }
  }

  // Trophies earned during this session: same popup + Windows toast as every other source. Done
  // before the memory store is updated, so mergeAchievements still sees them as new.
  if (freshUnlocks.length > 0) {
    const game = await gamesSublevel
      .get(levelKeys.game(shop, objectId))
      .catch(() => null);
    if (game) {
      const { mergeAchievements } =
        await import("../achievements/merge-achievements");
      await mergeAchievements(game, freshUnlocks, true).catch((error) =>
        logger.error("Failed to announce RetroAchievements unlocks", error)
      );
    }
  }

  AchievementSouvenirStore.invalidate(shop, objectId);

  const souvenirs = await getAchievementSouvenirs(objectId, shop);
  const achievements = buildRetroAchievementsView(
    catalogue,
    unlockedByName,
    souvenirs
  );

  AchievementMemoryStore.set(shop, objectId, {
    achievements: catalogue,
    unlockedAchievements: Array.from(unlockedByName.values()),
    language: cachedAchievements?.language,
    catalogueValidator: cachedAchievements?.catalogueValidator,
  });

  logger.info("RetroAchievements progress fetched", {
    objectId,
    shop,
    gameId,
    remoteCount: remoteAchievements.length,
    newUnlockCount,
  });

  if (newUnlockCount > 0) {
    HydraApi.post(
      `/profile/games/${shop}/${objectId}/retroachievements/sync`
    ).catch((err) => {
      if (err instanceof UserNotLoggedInError) return;

      logger.error("Failed to enqueue RetroAchievements sync", err);
    });
  }

  return {
    achievements,
    didChange,
    status: catalogueStatus,
  };
};
