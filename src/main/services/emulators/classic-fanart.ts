import { app, net } from "electron";
import fs from "node:fs";
import path from "node:path";

import type { Game } from "@types";
import { gamesSublevel } from "@main/level";
import { logger } from "../logger";
import { WindowManager } from "../window-manager";
import {
  findFanart,
  isSharpHeroSize,
  isWeakHero,
  readImageSize,
  type FanartIndex,
} from "./classic-fanart-rules";

type Size = { width: number; height: number };

let index: FanartIndex | null = null;
let boxIndex: FanartIndex | null = null;

const resourcePath = (file: string) =>
  app.isPackaged
    ? path.join(process.resourcesPath, file)
    : path.join(__dirname, "..", "..", "resources", file);

const readIndex = (file: string): FanartIndex => {
  try {
    return JSON.parse(
      fs.readFileSync(resourcePath(file), "utf8")
    ) as FanartIndex;
  } catch (error) {
    logger.warn(`[fanart] ${file} not available`, error);
    return {};
  }
};

const loadIndex = (): FanartIndex =>
  (index ??= readIndex("classic-fanart-index.json"));

/** Box art (LaunchBox "Box - Front", scripts/build-box-index.py) for systems without real covers. */
const loadBoxIndex = (): FanartIndex =>
  (boxIndex ??= readIndex("classic-box-index.json"));

/** The game's case (front) from LaunchBox, best region first; empty when not indexed. */
export const findClassicBox = (
  platform: string | null | undefined,
  title: string
): string[] => findFanart(loadBoxIndex(), platform, title);

/** The first LaunchBox background for a title on a platform (no measuring). */
export const findClassicFanart = (
  platform: string | null | undefined,
  title: string
): string[] => findFanart(loadIndex(), platform, title);

// ---- Measured sizes (kept between runs, so each picture is measured once) ----------------------

const sizesFile = () => path.join(app.getPath("userData"), "hero-sizes.json");
let sizes: Record<string, [number, number]> | null = null;

const loadSizes = () => {
  if (sizes) return sizes;
  try {
    sizes = JSON.parse(fs.readFileSync(sizesFile(), "utf8"));
  } catch {
    sizes = {};
  }
  return sizes!;
};

export const saveSizes = () => {
  try {
    fs.writeFileSync(sizesFile(), JSON.stringify(sizes ?? {}));
  } catch (error) {
    logger.warn("[fanart] could not save measured sizes", error);
  }
};

const FIRST_BYTES = 128 * 1024;

/** Reads only the start of the picture (where its dimensions are). null = could not tell. */
export const measure = async (url: string): Promise<Size | null> => {
  const known = loadSizes()[url];
  if (known) return known[0] ? { width: known[0], height: known[1] } : null;
  // Aborting (instead of cancelling the stream, which could hang) stops the download once the
  // header is in, and caps a stalled request at 10 s.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await net.fetch(url, {
      headers: { Range: `bytes=0-${FIRST_BYTES - 1}` },
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      // A missing picture (404) is remembered; a network hiccup is retried next time.
      if (response.status >= 400 && response.status < 500)
        loadSizes()[url] = [0, 0];
      return null;
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (total < FIRST_BYTES) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        chunks.push(value);
        total += value.length;
      }
    } catch {
      // Aborted by the timer: use what arrived (the size is in the first bytes).
    }
    controller.abort();
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const size = readImageSize(bytes);
    loadSizes()[url] = size ? [size.width, size.height] : [0, 0];
    return size;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

// ---- Picking --------------------------------------------------------------------------------------

const STEAM_CDN = "https://cdn.cloudflare.steamstatic.com/steam/apps/";

/** The background Opus shows today when the user didn't pick one (same order as getHeroArt). */
const currentHero = (game: Game) =>
  game.libraryHeroImageUrl ??
  (game.shop === "steam" && /^\d+$/.test(game.objectId)
    ? `${STEAM_CDN}${game.objectId}/library_hero.jpg`
    : null);

const fanartPlatform = (game: Game) =>
  game.shop === "launchbox" ? game.platform : "pc";

/**
 * Hero for an emulated game being imported: the current one when it is already a proper wide
 * picture, else the first LaunchBox background (the startup pass measures and refines it).
 */
export const pickClassicHero = (game: {
  platform?: string | null;
  title: string;
  libraryHeroImageUrl?: string | null;
  coverImageUrl?: string | null;
}): string | null => {
  const current = game.libraryHeroImageUrl ?? null;
  if (!isWeakHero(current, game.coverImageUrl)) return current;
  return findFanart(loadIndex(), game.platform, game.title)[0] ?? current;
};

/**
 * The best background for one game: its current one when it measures sharp, else the first
 * sharp LaunchBox background, else the largest one that beats the current picture.
 */
const bestHero = async (game: Game): Promise<string | null> => {
  const current = currentHero(game);
  const currentSize =
    current && !current.startsWith("local:") ? await measure(current) : null;
  if (current?.startsWith("local:")) return null;
  // eShop banners are sharp but may carry promo bands ("Demo Available"): a sharp LaunchBox
  // background replaces them; a weaker one doesn't.
  const isEshopBanner =
    !!current && /api\.nlib\.cc\/nx\/[0-9a-f]+\/banner/i.test(current);
  if (currentSize && isSharpHeroSize(currentSize) && !isEshopBanner)
    return null;

  const candidates = findFanart(
    loadIndex(),
    fanartPlatform(game),
    game.title
  ).filter((url) => url !== current);
  let best: { url: string; area: number } | null = null;
  for (const url of candidates) {
    const size = await measure(url);
    if (!size) continue;
    if (isSharpHeroSize(size)) return url;
    const area = size.width * size.height;
    if (size.width / size.height >= 1.3 && (!best || area > best.area))
      best = { url, area };
  }
  if (isEshopBanner) return null;
  const currentArea = currentSize ? currentSize.width * currentSize.height : 0;
  return best && best.area > currentArea ? best.url : null;
};

/**
 * Once after startup: every game (emulated or PC, installed or not) whose background is small,
 * not wide or missing gets the best LaunchBox background. Pictures the user picked (custom hero)
 * are never touched; each picture is measured once and remembered.
 */
export const backfillClassicFanart = async () => {
  const pending: [string, Game][] = [];
  for await (const [key, game] of gamesSublevel.iterator()) {
    if (game.isDeleted || game.customHeroImageUrl) continue;
    pending.push([key, game]);
  }

  logger.info(`[fanart] checking ${pending.length} game background(s)`);
  const startedAt = Date.now();
  let changed = 0;
  let next = 0;
  const worker = async () => {
    while (next < pending.length) {
      const [key, game] = pending[next++];
      // Measured sizes survive an interrupted run.
      if (next % 50 === 0) saveSizes();
      try {
        const hero = await bestHero(game);
        if (!hero) continue;
        const latest = await gamesSublevel.get(key);
        if (!latest || latest.customHeroImageUrl) continue;
        await gamesSublevel.put(key, { ...latest, libraryHeroImageUrl: hero });
        changed += 1;
      } catch (error) {
        logger.warn(`[fanart] ${game.title}`, error);
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  saveSizes();

  logger.info(
    `[fanart] done in ${Math.round((Date.now() - startedAt) / 1000)} s: ${changed} upgraded`
  );
  if (changed) {
    WindowManager.sendToAppWindows("on-library-batch-complete");
  }
  return changed;
};
