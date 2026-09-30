import type { Game } from "@types";
import { isLocalOnlyShop } from "@shared";
import { gamesSublevel } from "@main/level";
import { getGameAssets } from "@main/events/catalogue/get-game-assets";
import { logger } from "@main/services/logger";
import { WindowManager } from "@main/services/window-manager";

/**
 * Repairs library games that were added while the catalogue was still sparse: those records were
 * saved with `title` (and often icon/hero/logo) undefined, which surfaces as a game called
 * "undefined" in the library, the profile, and — worst of all — in achievement notifications.
 *
 * The Steam assets endpoint resolves title + art on demand for any appid, so this backfills the
 * missing fields once per boot. It only touches records that are actually missing a title, never
 * overwrites art the user customised, and fails soft per game so one bad lookup can't stall boot.
 */
export const backfillMissingGameMetadata = async () => {
  let entries: [string, Game][];
  try {
    entries = await gamesSublevel.iterator().all();
  } catch (err) {
    logger.warn("[backfill] Failed to read games for metadata backfill", err);
    return;
  }

  let repaired = 0;

  for (const [key, game] of entries) {
    if (!game || game.isDeleted || isLocalOnlyShop(game.shop)) continue;
    // A record added before the catalogue knew this game has no title — that's the one thing we fix.
    if (game.title) continue;

    try {
      const assets = await getGameAssets(game.objectId, game.shop, {
        forceFresh: true,
      });
      if (!assets?.title) continue;

      await gamesSublevel.put(key, {
        ...game,
        title: assets.title,
        iconUrl: game.iconUrl ?? assets.iconUrl ?? null,
        libraryHeroImageUrl:
          game.libraryHeroImageUrl ?? assets.libraryHeroImageUrl ?? null,
        logoImageUrl: game.logoImageUrl ?? assets.logoImageUrl ?? null,
      });
      repaired += 1;
    } catch (err) {
      logger.warn("[backfill] Failed to backfill metadata for", key, err);
    }
  }

  if (repaired > 0) {
    logger.log(`[backfill] Repaired metadata for ${repaired} library game(s)`);
    WindowManager.sendToAppWindows("on-library-batch-complete");
  }
};
