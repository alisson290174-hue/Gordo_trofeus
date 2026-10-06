import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

import { gamesSublevel } from "@main/level";
import { logger } from "../logger";
import { WindowManager } from "../window-manager";
import {
  findFanart,
  isWeakHero,
  type FanartIndex,
} from "./classic-fanart-rules";

let index: FanartIndex | null = null;

const indexPath = () =>
  app.isPackaged
    ? path.join(process.resourcesPath, "classic-fanart-index.json")
    : path.join(
        __dirname,
        "..",
        "..",
        "resources",
        "classic-fanart-index.json"
      );

const loadIndex = (): FanartIndex => {
  if (index) return index;
  try {
    index = JSON.parse(fs.readFileSync(indexPath(), "utf8")) as FanartIndex;
  } catch (error) {
    logger.warn("[fanart] index not available", error);
    index = {};
  }
  return index;
};

/**
 * Hero for an emulated game: the current one when it is already a proper wide picture, else the
 * LaunchBox fanart for the game (when the index knows it), else the current one.
 */
export const pickClassicHero = (game: {
  platform?: string | null;
  title: string;
  libraryHeroImageUrl?: string | null;
  coverImageUrl?: string | null;
}): string | null => {
  const current = game.libraryHeroImageUrl ?? null;
  if (!isWeakHero(current, game.coverImageUrl)) return current;
  return findFanart(loadIndex(), game.platform, game.title) ?? current;
};

/**
 * Once after startup: every emulated game whose background was a small box scan / 500px picture
 * gets the LaunchBox fanart (1920px to 4K). Art the user picked (custom hero) is never touched.
 */
export const backfillClassicFanart = async () => {
  let changed = 0;
  try {
    for await (const [key, game] of gamesSublevel.iterator()) {
      if (game.shop !== "launchbox" || game.isDeleted) continue;
      if (game.customHeroImageUrl) continue;
      const hero = pickClassicHero(game);
      if (!hero || hero === game.libraryHeroImageUrl) continue;
      await gamesSublevel.put(key, { ...game, libraryHeroImageUrl: hero });
      changed += 1;
    }
  } catch (error) {
    logger.warn("[fanart] backfill failed", error);
  }
  if (changed) {
    logger.info(`[fanart] ${changed} game background(s) upgraded`);
    WindowManager.sendToAppWindows("on-library-batch-complete");
  }
  return changed;
};
