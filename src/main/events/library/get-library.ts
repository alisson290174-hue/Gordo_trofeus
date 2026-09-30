import path from "node:path";
import fs from "node:fs";

import type { LibraryGame } from "@types";
import { registerEvent } from "../register-event";
import {
  downloadsSublevel,
  gamesArtworkSelectionSublevel,
  gamesShopAssetsSublevel,
  gamesShopCacheSublevel,
  gamesSublevel,
} from "@main/level";
import { composeAssetsWithArtwork, displayGameTitle } from "@shared";
import {
  resolveAchievementCount,
  resolveUnlockedAchievementCount,
} from "@main/services/achievements/achievement-memory-store";

export const lookupCachedPlatform = async (
  gameKey: string
): Promise<string | null> => {
  const prefix = `${gameKey}:`;
  try {
    const entries = await gamesShopCacheSublevel.iterator().all();
    for (const [key, value] of entries) {
      if (
        typeof key === "string" &&
        key.startsWith(prefix) &&
        value?.platform
      ) {
        return value.platform;
      }
    }
  } catch {
    return null;
  }
  return null;
};

const getLibrary = async (): Promise<LibraryGame[]> => {
  return gamesSublevel
    .iterator()
    .all()
    .then((results) => {
      return Promise.all(
        results
          .filter(([_key, game]) => game.isDeleted === false)
          .map(async ([key, game]) => {
            const download = await downloadsSublevel.get(key);
            const gameAssets = await gamesShopAssetsSublevel.get(key);
            const artworkSelection =
              await gamesArtworkSelectionSublevel.get(key);
            const composedAssets = composeAssetsWithArtwork(
              gameAssets ?? null,
              artworkSelection
            );
            const unlockedAchievementCount = resolveUnlockedAchievementCount(
              game.shop,
              game.objectId,
              game.unlockedAchievementCount
            );

            // Verify installer still exists, clear if deleted externally
            let installerSizeInBytes = game.installerSizeInBytes;
            if (installerSizeInBytes && download?.folderName) {
              const installerPath = path.join(
                download.downloadPath,
                download.folderName
              );

              if (!fs.existsSync(installerPath)) {
                installerSizeInBytes = null;
                gamesSublevel.put(key, { ...game, installerSizeInBytes: null });
              }
            }

            if (
              game.shop === "launchbox" &&
              (!game.platform || game.platform === null)
            ) {
              const cachedPlatform = await lookupCachedPlatform(key);
              if (cachedPlatform) {
                game.platform = cachedPlatform;
                gamesSublevel.put(key, game).catch(() => {});
              }
            }

            // Verify installed folder still exists, clear if deleted externally
            let installedSizeInBytes = game.installedSizeInBytes;
            if (installedSizeInBytes && game.executablePath) {
              const executableDir = path.dirname(game.executablePath);

              if (!fs.existsSync(executableDir)) {
                installedSizeInBytes = null;
                gamesSublevel.put(key, {
                  ...game,
                  installerSizeInBytes,
                  installedSizeInBytes: null,
                });
              }
            }

            return {
              id: key,
              ...game,
              installerSizeInBytes,
              installedSizeInBytes,
              download: download ?? null,
              unlockedAchievementCount,
              achievementCount: resolveAchievementCount(
                game.shop,
                game.objectId,
                game.achievementCount
              ),
              // Spread composed assets last to ensure all image URLs are properly set
              ...composedAssets,
              // PS2/classics covers are backfilled onto the game record's libraryHeroImageUrl and
              // survive profile syncs that reset the shop-assets to null. Feed them into the cover
              // fields every card reads (grid uses coverImageUrl/libraryImageUrl, large uses hero),
              // so covers show in every view regardless of the assets record.
              // Since the PS2 index backfill the hero is real fanart, so the box art lives in
              // game.coverImageUrl; the hero only doubles as cover for records without one.
              ...(game.shop === "launchbox" &&
              (game.coverImageUrl || game.libraryHeroImageUrl)
                ? {
                    coverImageUrl:
                      composedAssets?.coverImageUrl ??
                      game.coverImageUrl ??
                      game.libraryHeroImageUrl,
                    libraryImageUrl:
                      composedAssets?.libraryImageUrl ??
                      game.coverImageUrl ??
                      game.libraryHeroImageUrl,
                    libraryHeroImageUrl:
                      composedAssets?.libraryHeroImageUrl ??
                      game.libraryHeroImageUrl,
                  }
                : {}),
              // ROM dump tags ("(U) [SLUS-21879]", "(www.…)") never reach the UI.
              title: displayGameTitle(composedAssets?.title || game.title, game.shop),
              platform: game.platform ?? null,
              // Preserve custom image URLs from game if they exist
              customIconUrl: game.customIconUrl,
              customLogoImageUrl: game.customLogoImageUrl,
              customHeroImageUrl: game.customHeroImageUrl,
              customCoverImageUrl: game.customCoverImageUrl,
            };
          })
      );
    });
};

registerEvent("getLibrary", getLibrary);
