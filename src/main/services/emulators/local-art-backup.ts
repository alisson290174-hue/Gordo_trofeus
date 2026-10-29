import fs from "node:fs";
import path from "node:path";

import type { Game } from "@types";
import { gamesSublevel } from "@main/level";
import { logger } from "../logger";
import { WindowManager } from "../window-manager";
import { getEmulatorsBaseDir } from "./emulators-base-dir";
import { normaliseFanartTitle } from "./classic-fanart-rules";

/**
 * The art backup on the emulators drive (<base>\Artes\<console>\<game>\, made by
 * ClaudeResolve\artes\baixar.py + tiles.py): every game folder has an info.json naming the ROM
 * files it belongs to, plus tile.png — a square picture for the Início strip that never crops the
 * box (official square art, key art + logo, or the whole box over a blurred copy of itself).
 *
 * Boxed classics used to be cropped into the square with fixed per-console frames, which cut the
 * logo off landscape boxes (SNES, N64). The tile from the backup replaces that. Games with no
 * art at all (mods) also get their cover, background and logo from it.
 */

interface ArtFolder {
  dir: string;
  console: string;
}

interface ArtIndex {
  byFile: Map<string, ArtFolder>;
  byTitle: Map<string, ArtFolder>;
  /** PC folders by title: a port's case is the PC one (2:3), not the console original's. */
  byPcTitle: Map<string, ArtFolder>;
}

/** Systems whose Início tile already comes from dedicated square art (eShop icon, PS4 icon0). */
const KEEPS_OWN_TILE = /switch|playstation 4/i;

const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".webp"];

const findArtesDir = async (): Promise<string | null> => {
  const base = await getEmulatorsBaseDir().catch(() => null);
  if (!base) return null;
  for (const dir of [
    path.join(base, "Artes"),
    path.join(base, "..", "Artes"),
  ]) {
    if (fs.existsSync(path.join(dir, "_relatorio.csv"))) return dir;
  }
  return null;
};

const readIndex = (root: string): ArtIndex => {
  const byFile = new Map<string, ArtFolder>();
  const byTitle = new Map<string, ArtFolder>();
  const byPcTitle = new Map<string, ArtFolder>();
  for (const consoleDir of fs.readdirSync(root, { withFileTypes: true })) {
    if (!consoleDir.isDirectory() || consoleDir.name.startsWith("_")) continue;
    const consolePath = path.join(root, consoleDir.name);
    for (const gameDir of fs.readdirSync(consolePath, {
      withFileTypes: true,
    })) {
      if (!gameDir.isDirectory()) continue;
      const dir = path.join(consolePath, gameDir.name);
      try {
        const info = JSON.parse(
          fs.readFileSync(path.join(dir, "info.json"), "utf8")
        ) as {
          titulo?: string;
          launchbox_nome?: string | null;
          arquivos_do_jogo?: string[];
        };
        const folder = { dir, console: consoleDir.name };
        for (const file of info.arquivos_do_jogo ?? [])
          byFile.set(file.toLowerCase(), folder);
        for (const title of [info.titulo, info.launchbox_nome]) {
          const key = title ? normaliseFanartTitle(title) : "";
          if (key && !byTitle.has(key)) byTitle.set(key, folder);
          if (key && consoleDir.name === "PC") byPcTitle.set(key, folder);
        }
      } catch {
        // folder without info.json: not part of the backup
      }
    }
  }
  return { byFile, byTitle, byPcTitle };
};

const gameFiles = (game: Game) =>
  [game.executablePath, ...(game.discs ?? []).map((disc) => disc.path)]
    .filter((file): file is string => Boolean(file))
    .map((file) => path.basename(file).toLowerCase());

/** PC ports named after the port, not the game (their art is the console original's). */
const PORT_TITLES: Record<string, string> = {
  "ship of harkinian": "legend of zelda ocarina of time",
};

const findFolder = (index: ArtIndex, game: Game): ArtFolder | null => {
  for (const file of gameFiles(game)) {
    const folder = index.byFile.get(file);
    if (folder) return folder;
  }
  const title = normaliseFanartTitle(game.title);
  const key = PORT_TITLES[title] ?? title;
  if (game.platform === "port") {
    const pc = index.byPcTitle.get(key);
    if (pc) return pc;
  }
  return index.byTitle.get(key) ?? null;
};

const artFile = (dir: string, name: string) => {
  for (const ext of IMAGE_EXTS) {
    const file = path.join(dir, name + ext);
    // Forward slashes: these URLs also go into CSS url(), where "\E" would be an escape.
    if (fs.existsSync(file)) return `local:${file.replaceAll("\\", "/")}`;
  }
  return null;
};

/** What the backup changes on one game record (null = nothing). */
export const localArtUpdate = (
  game: Game,
  folder: ArtFolder
): Partial<Game> | null => {
  const update: Partial<Game> = {};
  // The case photo, for the per-platform shelves (all cases of a console share one shape).
  const box = artFile(folder.dir, "capa");
  if (box && game.boxArtImageUrl !== box) update.boxArtImageUrl = box;
  const tile = artFile(folder.dir, "tile");
  if (
    tile &&
    !game.customIconUrl &&
    !KEEPS_OWN_TILE.test(game.platform ?? "") &&
    game.tileImageUrl !== tile
  )
    update.tileImageUrl = tile;

  // Games no database knows (mods) have nothing at all: take the whole set.
  if (!game.coverImageUrl && !game.customCoverImageUrl) {
    const cover = artFile(folder.dir, "capa");
    if (cover) update.coverImageUrl = cover;
  }
  if (!game.libraryHeroImageUrl && !game.customHeroImageUrl) {
    const hero = artFile(folder.dir, "fundo");
    if (hero) update.libraryHeroImageUrl = hero;
  }
  if (!game.logoImageUrl && !game.customLogoImageUrl) {
    const logo = artFile(folder.dir, "logo");
    if (logo) update.logoImageUrl = logo;
  }
  return Object.keys(update).length ? update : null;
};

/** Once after startup: emulated games take their Início tile (and missing art) from the backup. */
export const applyLocalArtBackup = async () => {
  const root = await findArtesDir();
  if (!root) return 0;
  const startedAt = Date.now();
  const index = readIndex(root);
  let changed = 0;
  for await (const [key, game] of gamesSublevel.iterator()) {
    const isPort = game.platform === "port";
    if (game.isDeleted || (game.shop !== "launchbox" && !isPort)) continue;
    const folder = findFolder(index, game);
    if (!folder) continue;
    const update = localArtUpdate(game, folder) ?? {};
    // Ports keep the art they were given; only their tile and case come from here.
    if (isPort) {
      delete update.coverImageUrl;
      delete update.libraryHeroImageUrl;
      delete update.logoImageUrl;
      // Their console original's box (set on import) gives way to the PC case of the backup.
      if (
        folder.console === "PC" &&
        game.customCoverImageUrl?.includes("images.launchbox-app.com")
      )
        update.customCoverImageUrl = null;
    }
    if (Object.keys(update).length === 0) continue;
    const latest = await gamesSublevel.get(key);
    if (!latest) continue;
    await gamesSublevel.put(key, { ...latest, ...update });
    changed += 1;
  }
  logger.info(
    `[local-art] ${changed} game(s) updated from ${root} in ${Date.now() - startedAt} ms`
  );
  if (changed) WindowManager.sendToAppWindows("on-library-batch-complete");
  return changed;
};
