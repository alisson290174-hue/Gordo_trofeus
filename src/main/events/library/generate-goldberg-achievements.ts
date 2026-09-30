import fs from "node:fs";
import path from "node:path";

import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import { logger } from "@main/services/logger";
import { getGameAchievementData } from "@main/services/achievements/get-game-achievement-data";
import { resolveGameExecutablePath } from "@main/services/achievements/resolve-game-executable-path";
import type { GameShop, SteamAchievement } from "@types";

export type GenerateGoldbergResult =
  | { ok: true; count: number; path: string }
  | {
      ok: false;
      reason: "not_steam" | "unknown_game" | "no_executable" | "no_schema" | "write_failed";
    };

/**
 * Writes a Goldberg-format `steam_settings/achievements.json` next to a game's executable, built
 * from the Steam achievement schema our server already caches. Games running a Goldberg-based
 * emulator (Voices38, Hypervisor, plain Goldberg) that shipped without this file will start
 * recording achievements once it exists — the community's documented fix for the "crack não grava"
 * case (e.g. Clair Obscur). It only writes public achievement metadata; it never touches DRM/DLLs.
 */
const goldbergAchievement = (a: SteamAchievement) => ({
  name: a.name,
  displayName: a.displayName,
  description: a.description ?? "",
  hidden: a.hidden ? "1" : "0",
  icon: a.icon ?? "",
  icongray: a.icongray ?? a.icon ?? "",
});

const generateGoldbergAchievements = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop
): Promise<GenerateGoldbergResult> => {
  if (shop !== "steam") return { ok: false, reason: "not_steam" };

  const game = await gamesSublevel
    .get(levelKeys.game(shop, objectId))
    .catch(() => null);
  if (!game) return { ok: false, reason: "unknown_game" };

  const executablePath = resolveGameExecutablePath(game);
  if (!executablePath || !fs.existsSync(executablePath)) {
    return { ok: false, reason: "no_executable" };
  }

  const achievements = await getGameAchievementData(objectId, shop, false).catch(
    () => [] as SteamAchievement[]
  );
  if (!achievements.length) return { ok: false, reason: "no_schema" };

  const steamSettingsDir = path.join(
    path.dirname(executablePath),
    "steam_settings"
  );
  const targetFile = path.join(steamSettingsDir, "achievements.json");

  try {
    fs.mkdirSync(steamSettingsDir, { recursive: true });

    // Preserve an existing file once, so a manual/game-shipped config isn't lost on first run.
    if (fs.existsSync(targetFile) && !fs.existsSync(`${targetFile}.bak`)) {
      fs.copyFileSync(targetFile, `${targetFile}.bak`);
    }

    fs.writeFileSync(
      targetFile,
      JSON.stringify(achievements.map(goldbergAchievement), null, 2),
      "utf-8"
    );

    logger.log(
      `[goldberg] wrote ${achievements.length} achievements to ${targetFile}`
    );
    return { ok: true, count: achievements.length, path: steamSettingsDir };
  } catch (error) {
    logger.error("[goldberg] failed to write achievements.json", error);
    return { ok: false, reason: "write_failed" };
  }
};

registerEvent("generateGoldbergAchievements", generateGoldbergAchievements);
