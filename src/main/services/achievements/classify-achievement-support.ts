import type { AchievementFile, AchievementSupport, Game } from "@types";

import { gamesSublevel, levelKeys } from "@main/level";
import { achievementsLogger } from "../logger";
import { collectGameAchievementFiles } from "./collect-game-achievement-files";
import { parseAchievementFile } from "./parse-achievement-file";

// Enough playtime to be confident the game actually ran at least once, so an empty achievement
// file means "the crack doesn't record this game" rather than "you haven't played yet".
const PLAYED_THRESHOLD_MS = 3 * 60 * 1000;

/**
 * Classifies what an installed game's crack does with achievements from three signals we already
 * have: whether a crack achievement file exists, whether it contains any unlocked achievements,
 * and how long the game has been played. No new scanning logic — it reuses the 16-cracker file
 * finder and parser the achievement watcher already relies on.
 */
export const classifyAchievementSupportFromFiles = (
  game: Game,
  achievementFiles: AchievementFile[]
): AchievementSupport => {
  if (game.shop !== "steam") return "unknown";

  const hasPlayed = (game.playTimeInMilliseconds ?? 0) >= PLAYED_THRESHOLD_MS;

  if (achievementFiles.length === 0) {
    // No crack achievement source at all: DRM-free once we know it has actually run.
    return hasPlayed ? "unsupported" : "unknown";
  }

  const unlockedCount = achievementFiles.reduce(
    (total, file) =>
      total + parseAchievementFile(file.filePath, file.type).length,
    0
  );

  if (unlockedCount > 0) return "working";

  // A file exists but is empty: the crack has the plumbing. If the game has been played and still
  // nothing was written, the crack doesn't record this game; otherwise it just needs a first run.
  return hasPlayed ? "not_writing" : "supported";
};

/** Collects the game's achievement files then classifies — for callers that don't already have them. */
export const classifyAchievementSupport = async (
  game: Game
): Promise<AchievementSupport> => {
  const files = await collectGameAchievementFiles(game, {
    includeSteamCache: true,
    awaitGameDirectoryLocations: true,
  }).catch(() => [] as AchievementFile[]);

  return classifyAchievementSupportFromFiles(game, files);
};

/** Persists a freshly computed classification onto the game record, only when it changed. */
export const persistAchievementSupport = async (
  game: Game,
  support: AchievementSupport
): Promise<void> => {
  if (game.achievementSupport === support) return;

  const gameKey = levelKeys.game(game.shop, game.objectId);
  const current = await gamesSublevel.get(gameKey).catch(() => null);
  if (!current || current.achievementSupport === support) return;

  await gamesSublevel
    .put(gameKey, { ...current, achievementSupport: support })
    .catch((err) =>
      achievementsLogger.error(
        "Failed to persist achievement support",
        game.objectId,
        err
      )
    );
};
