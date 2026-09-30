import type { Game, ShopAssets } from "@types";

import { gamesSublevel, gamesShopAssetsSublevel } from "@main/level";
import { logger } from "@main/services/logger";
import { WindowManager } from "@main/services/window-manager";
import {
  fetchShopDetailsForSkus,
  normalizeSku,
} from "@main/services/emulators/launchbox-shop-details";
import { platformToSystem } from "./platform-to-system";

/**
 * PS2 games imported from ROM files carry the file name as title ("Killzone (BR-EUR) (T1.2)
 * (www.romsportugues.com)") and the box art doubling as background. The server's PS2 index
 * (PCSX2 GameIndex + LaunchBox Games DB) knows the real name, fanart, clear logo and cover for the
 * disc serial — this pulls it for the whole library on boot, no rescan needed.
 */

/** A title that still looks like a ROM file name, not something the user typed. */
const looksLikeFileName = (game: Game): boolean => {
  const title = game.title?.trim() ?? "";
  if (!title) return true;
  if (/www\.|\(|\[|\.iso$|\.bin$|\.chd$/i.test(title)) return true;
  if (/^rom-sku-/i.test(title)) return true;
  return (game.discs ?? []).some((disc) => {
    const base = (disc.fileName ?? "").replace(/\.[^.]+$/, "");
    return title === disc.label || title === base;
  });
};

const isXlenoreCover = (url: string | null | undefined) =>
  Boolean(url?.includes("xlenore/ps2-covers"));

export const backfillPs2Metadata = async (): Promise<void> => {
  let entries: [string, Game][];
  try {
    entries = await gamesSublevel.iterator().all();
  } catch (err) {
    logger.warn("[ps2-metadata] could not read games", err);
    return;
  }

  const ps2Games = entries.filter(
    ([, game]) =>
      game &&
      !game.isDeleted &&
      game.shop === "launchbox" &&
      platformToSystem(game.platform) === "ps2" &&
      game.discs?.some((disc) => disc.sku)
  );
  if (ps2Games.length === 0) return;

  const skus = [
    ...new Set(
      ps2Games.map(([, game]) => game.discs!.find((disc) => disc.sku)!.sku!)
    ),
  ];
  const lookup = await fetchShopDetailsForSkus(skus);
  if (lookup.size === 0) return;

  let updated = 0;

  for (const [key, game] of ps2Games) {
    const serial = game.discs!.find((disc) => disc.sku)!.sku!;
    const entry = lookup.get(normalizeSku(serial));
    const assets = entry?.data?.assets;
    if (!entry?.data || !assets) continue;

    const title = looksLikeFileName(game) ? entry.data.title : game.title;
    const hero = assets.libraryHeroImageUrl;
    const cover = assets.libraryImageUrl;

    const next: Game = {
      ...game,
      title,
      // Real fanart replaces the box art that was standing in as background.
      libraryHeroImageUrl:
        !game.libraryHeroImageUrl || isXlenoreCover(game.libraryHeroImageUrl)
          ? // No fanart: fall back to the resolved cover (the xlenore one may not exist).
            (hero ?? cover ?? game.libraryHeroImageUrl)
          : game.libraryHeroImageUrl,
      logoImageUrl: game.logoImageUrl || assets.logoImageUrl,
      coverImageUrl: cover ?? game.coverImageUrl ?? null,
    };

    const changed =
      next.title !== game.title ||
      next.libraryHeroImageUrl !== game.libraryHeroImageUrl ||
      next.logoImageUrl !== game.logoImageUrl ||
      next.coverImageUrl !== game.coverImageUrl;
    if (!changed) continue;

    await gamesSublevel.put(key, next).catch(() => {});

    const current = (await gamesShopAssetsSublevel
      .get(key)
      .catch(() => null)) as (ShopAssets & { updatedAt?: number }) | null;
    await gamesShopAssetsSublevel
      .put(key, {
        objectId: game.objectId,
        shop: "launchbox",
        title,
        iconUrl: current?.iconUrl ?? null,
        libraryHeroImageUrl: next.libraryHeroImageUrl,
        libraryImageUrl: next.coverImageUrl ?? null,
        logoImageUrl: next.logoImageUrl,
        logoPosition: current?.logoPosition ?? null,
        coverImageUrl: next.coverImageUrl ?? null,
        downloadSources: current?.downloadSources ?? [],
        updatedAt: Date.now(),
      })
      .catch((err) => logger.warn("[ps2-metadata] put assets failed", key, err));

    updated += 1;
  }

  if (updated > 0) {
    logger.log(`[ps2-metadata] updated ${updated} PS2 game(s)`);
    WindowManager.sendToAppWindows("on-library-batch-complete");
  }
};
