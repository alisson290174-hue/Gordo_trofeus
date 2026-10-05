import type { GameShop, UserAchievement } from "@types";
import { syncAndGetUnlockedAchievements } from "./get-unlocked-achievements";
import { registerEvent } from "../register-event";
import { syncRetroAchievements } from "@main/services/retro-achievements/retro-achievements-sync";
import { gamesSublevel, levelKeys } from "@main/level";
import { syncPs3Trophies } from "@main/services/emulators/ps3-trophies";

const getRetroAchievementsAchievements = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop,
  retroAchievementsGameId?: number
): Promise<UserAchievement[] | null> => {
  const result = await syncRetroAchievements({
    objectId,
    shop,
    retroAchievementsGameId,
  });

  if (result.status === "no_mapping") {
    // PS3 has no RetroAchievements: its trophies come from RPCS3's own files.
    const game = await gamesSublevel
      .get(levelKeys.game(shop, objectId))
      .catch(() => null);
    if (game && /playstation\s*3|\bps3\b/i.test(game.platform ?? "")) {
      await syncPs3Trophies(game, false);
    }
    return syncAndGetUnlockedAchievements(objectId, shop);
  }

  return result.achievements;
};

registerEvent(
  "getRetroAchievementsAchievements",
  getRetroAchievementsAchievements
);
