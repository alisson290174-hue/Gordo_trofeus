import type { Game, ShopAssets } from "@types";

import { gamesSublevel, gamesShopAssetsSublevel } from "@main/level";
import { logger } from "@main/services/logger";
import { WindowManager } from "@main/services/window-manager";
import { platformToSystem } from "./platform-to-system";

/**
 * Fills in PS2 box art for games already in the library that were imported before covers existed
 * (their records have no cover). Covers come from the community xlenore/ps2-covers repo, matched by
 * the disc serial we already stored — so this needs no rescan: it runs on boot and the covers show
 * on the next launch. New scans already set covers at import time.
 */
const ps2CoverUrl = (serial: string): string =>
  `https://cdn.jsdelivr.net/gh/xlenore/ps2-covers@main/covers/default/${serial}.jpg`;

export const backfillPs2Covers = async (): Promise<void> => {
  let entries: [string, Game][];
  try {
    entries = await gamesSublevel.iterator().all();
  } catch (err) {
    logger.warn("[ps2-covers] could not read games", err);
    return;
  }

  let filled = 0;

  for (const [key, game] of entries) {
    if (!game || game.isDeleted || game.shop !== "launchbox") continue;
    if (platformToSystem(game.platform) !== "ps2") continue;

    const serial = game.discs?.find((disc) => disc.sku)?.sku;
    if (!serial) continue;

    const assets = (await gamesShopAssetsSublevel
      .get(key)
      .catch(() => null)) as (ShopAssets & { updatedAt?: number }) | null;

    // Skip games that already have art (a matched cover or a previous successful backfill).
    if (assets?.libraryImageUrl) continue;

    const cover = ps2CoverUrl(serial);

    await gamesShopAssetsSublevel
      .put(key, {
        objectId: game.objectId,
        shop: "launchbox",
        title: assets?.title ?? game.title,
        iconUrl: assets?.iconUrl ?? null,
        libraryHeroImageUrl: cover,
        libraryImageUrl: cover,
        logoImageUrl: assets?.logoImageUrl ?? null,
        logoPosition: assets?.logoPosition ?? null,
        coverImageUrl: cover,
        downloadSources: assets?.downloadSources ?? [],
        updatedAt: Date.now(),
      })
      .catch((err) => logger.warn("[ps2-covers] put assets failed", key, err));

    if (!game.libraryHeroImageUrl) {
      await gamesSublevel
        .put(key, { ...game, libraryHeroImageUrl: cover })
        .catch(() => {});
    }

    filled += 1;
  }

  if (filled > 0) {
    logger.log(`[ps2-covers] backfilled ${filled} cover(s)`);
    // The library UI loaded before this finished writing — tell it to refetch so the covers show
    // without a manual refresh or restart.
    WindowManager.sendToAppWindows("on-library-batch-complete");
  }
};
