import fs from "node:fs";
import path from "node:path";

import { EMULATOR_SYSTEMS } from "@shared";
import type { EmulatorSystem, Game } from "@types";
import { gamesShopAssetsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { logger } from "../logger";
import { KNOWN_BINARIES } from "./known-binaries";
import { detectEmulatorWithDownloads } from "./detect-emulator-with-downloads";
import { getEmulatorConfig, updateEmulatorConfig } from "./emulators-repository";

/**
 * An emulator whose saved executable no longer exists (folder moved, renamed or swapped for a
 * fork, e.g. D:\EMULADORES\shadPS4 → D:\EMULADORES\shadPS4-eltutz-GOW3) is found again in the
 * emulators folder, so its games keep opening without a trip to the settings.
 */
export const repairMissingEmulatorPaths = async (): Promise<EmulatorSystem[]> => {
  const repaired: EmulatorSystem[] = [];
  for (const system of EMULATOR_SYSTEMS as EmulatorSystem[]) {
    const config = await getEmulatorConfig(system).catch(() => null);
    const current = config?.executablePath;
    if (!current || fs.existsSync(current)) continue;
    const found = await detectEmulatorWithDownloads(KNOWN_BINARIES[system]).catch(
      () => null
    );
    if (!found || !fs.existsSync(found.executablePath)) {
      logger.warn(`[emulators] ${system}: ${current} is gone and no other copy was found`);
      continue;
    }
    await updateEmulatorConfig(system, (previous) => ({
      ...previous,
      executablePath: found.executablePath,
      detectedVersion: found.detectedVersion ?? previous.detectedVersion,
      detectedAt: Date.now(),
    }));
    repaired.push(system);
    logger.info(`[emulators] ${system}: ${current} is gone, now ${found.executablePath}`);
  }
  return repaired;
};

/** PS4 game folders (with sce_sys, not "-UPDATE"/"addcont") in the linked folders. */
const ps4GameDirs = (root: string, deep: boolean): string[] => {
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.isDirectory() && e.name.toLowerCase() === "sce_sys")) {
      if (!/-(update|patch)$/i.test(path.basename(dir))) found.push(dir);
      return;
    }
    if (depth >= (deep ? 3 : 1)) return;
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.toLowerCase() !== "addcont")
        walk(path.join(dir, entry.name), depth + 1);
    }
  };
  walk(root, 0);
  return found;
};

/**
 * PS4 games are extracted by hand into the linked folder and nothing re-reads it on its own;
 * the folders that hold a game not in the library yet are returned for a quiet import.
 */
export const ps4FoldersWithNewGames = async () => {
  const config = await getEmulatorConfig("ps4").catch(() => null);
  if (!config?.executablePath || !fs.existsSync(config.executablePath)) return [];
  const known = new Set<string>();
  for await (const [, game] of gamesSublevel.iterator()) {
    if (game.shop !== "launchbox" || game.isDeleted) continue;
    for (const disc of game.discs ?? [])
      known.add(path.dirname(disc.path).toLowerCase());
  }
  return config.romFolders.filter((folder) =>
    ps4GameDirs(folder.path, folder.scanSubfolders).some(
      (dir) => !known.has(dir.toLowerCase())
    )
  );
};

/** PS4 games imported before box art existed show their square icon0 as cover: swap in the case. */
export const backfillPs4Covers = async () => {
  const { findClassicBox } = await import("./classic-fanart");
  const isIcon = (url?: string | null) => !url || /icon0\.png$/i.test(url);
  const pending: [string, Game, string][] = [];
  for await (const [key, game] of gamesSublevel.iterator()) {
    if (game.shop !== "launchbox" || game.isDeleted || game.customCoverImageUrl) continue;
    if (!/playstation\s*4|ps4/i.test(game.platform ?? "")) continue;
    if (!isIcon(game.coverImageUrl)) continue;
    const box = findClassicBox("ps4", game.title)[0];
    if (box) pending.push([key, game, box]);
  }
  for (const [key, game, box] of pending) {
    await gamesSublevel.put(key, { ...game, coverImageUrl: box });
    // The library prefers the cached shop art, which still points at the icon.
    const assetsKey = levelKeys.game("launchbox", game.objectId);
    const assets = await gamesShopAssetsSublevel.get(assetsKey).catch(() => null);
    if (assets && isIcon(assets.libraryImageUrl))
      await gamesShopAssetsSublevel.put(assetsKey, { ...assets, libraryImageUrl: box });
    logger.info(`[emulators] ps4: box art for ${game.title}`);
  }
  return pending.length;
};
