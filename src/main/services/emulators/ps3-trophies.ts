import { toLocalUrl } from "@shared";
import fs from "node:fs";
import path from "node:path";

import type { Game, SteamAchievement, UnlockedAchievement } from "@types";
import { logger } from "../logger";
import { HydraApi } from "../hydra-api";
import { AchievementMemoryStore } from "../achievements/achievement-memory-store";
import { mergeAchievements } from "../achievements/merge-achievements";
import { getEmulatorConfig } from "./emulators-repository";
import {
  parseTropconf,
  parseTropusr,
  PS3_GRADE_PERCENT,
} from "./ps3-trophy-files";

/**
 * PS3 trophies, read from what RPCS3 itself records: the game's trophy set and the player's
 * unlocks (dev_hdd0/home/<user>/trophy/<NPCOMMID>). The list goes to the server once so friends
 * and comparisons see it; unlocks go through the same merge as every other game (pop-up, profile).
 */

/** The game's trophy set ID, from TROPDIR on the disc folder or the installed PKG. */
const findNpCommId = (rpcs3Dir: string, discPath: string): string | null => {
  const gameDirs: string[] = [];
  if (discPath.toLowerCase().endsWith(".pkg")) {
    const titleId = /([A-Z]{4}\d{5})/.exec(path.basename(discPath))?.[1];
    if (titleId)
      gameDirs.push(path.join(rpcs3Dir, "dev_hdd0", "game", titleId));
  } else {
    gameDirs.push(discPath, path.join(discPath, "PS3_GAME"));
  }
  for (const dir of gameDirs) {
    try {
      const ids = fs
        .readdirSync(path.join(dir, "TROPDIR"))
        .filter((name) => /^NPWR\d{5}_\d{2}$/.test(name));
      if (ids.length > 0) return ids[0];
    } catch {
      // not this layout
    }
  }
  return null;
};

/** RPCS3 user folders holding this trophy set (normally just 00000001). */
const findTrophyDir = (rpcs3Dir: string, npCommId: string): string | null => {
  const home = path.join(rpcs3Dir, "dev_hdd0", "home");
  try {
    for (const user of fs.readdirSync(home)) {
      const dir = path.join(home, user, "trophy", npCommId);
      if (fs.existsSync(path.join(dir, "TROPCONF.SFM"))) return dir;
    }
  } catch {
    // RPCS3 never ran a game yet
  }
  return null;
};

const uploadedCatalogues = new Set<string>();

export const syncPs3Trophies = async (
  game: Game,
  publishNotification: boolean
): Promise<boolean> => {
  try {
    const config = await getEmulatorConfig("ps3");
    const discPath = game.selectedDiscPath ?? game.discs?.[0]?.path ?? null;
    if (!config.executablePath || !discPath) return false;
    const rpcs3Dir = path.dirname(config.executablePath);
    const npCommId = findNpCommId(rpcs3Dir, discPath);
    const trophyDir = npCommId ? findTrophyDir(rpcs3Dir, npCommId) : null;
    if (!trophyDir) return false; // the game creates it on its first boot in RPCS3

    const { trophies } = parseTropconf(
      fs.readFileSync(path.join(trophyDir, "TROPCONF.SFM"), "utf8")
    );
    if (trophies.length === 0) return false;
    const usr = path.join(trophyDir, "TROPUSR.DAT");
    const unlockedById = fs.existsSync(usr)
      ? parseTropusr(fs.readFileSync(usr))
      : new Map();

    const catalogue: SteamAchievement[] = trophies.map((trophy) => {
      const icon = path.join(
        trophyDir,
        `TROP${trophy.id.padStart(3, "0")}.PNG`
      );
      return {
        name: trophy.id,
        displayName: trophy.displayName,
        description: trophy.description,
        icon: toLocalUrl(icon),
        icongray: toLocalUrl(icon),
        hidden: trophy.hidden,
        globalUnlockPercent: PS3_GRADE_PERCENT[trophy.grade],
      };
    });

    const cached = AchievementMemoryStore.get(game.shop, game.objectId);
    AchievementMemoryStore.set(game.shop, game.objectId, {
      ...cached,
      achievements: catalogue,
      unlockedAchievements: cached?.unlockedAchievements ?? [],
    });

    const key = `${game.objectId}:${trophies.length}`;
    if (!uploadedCatalogues.has(key)) {
      await HydraApi.put(
        `/profile/games/launchbox/${game.objectId}/ps3-trophies`,
        {
          trophies: trophies.map((t) => ({
            name: t.id,
            displayName: t.displayName,
            description: t.description,
            hidden: t.hidden,
            grade: t.grade,
          })),
        }
      )
        .then(() => uploadedCatalogues.add(key))
        .catch((error) =>
          logger.warn("[ps3-trophies] catalogue upload failed", String(error))
        );
    }

    const unlocked: UnlockedAchievement[] = trophies
      .filter((t) => unlockedById.has(Number(t.id)))
      .map((t) => ({
        name: t.id,
        unlockTime: unlockedById.get(Number(t.id)) ?? Date.now(),
      }));
    await mergeAchievements(game, unlocked, publishNotification);
    logger.info("[ps3-trophies] synced", {
      objectId: game.objectId,
      total: trophies.length,
      unlocked: unlocked.length,
    });
    return true;
  } catch (error) {
    logger.warn("[ps3-trophies] sync failed", {
      objectId: game.objectId,
      error: String(error),
    });
    return false;
  }
};
