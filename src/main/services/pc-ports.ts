import fs from "node:fs";
import path from "node:path";

import { EMULATOR_SYSTEMS } from "@shared";
import type { EmulatorSystem, Game } from "@types";
import { gamesSublevel, levelKeys } from "@main/level";
import { addCustomGame } from "@main/helpers/add-custom-game";
import { logger } from "./logger";
import { WindowManager } from "./window-manager";
import { getEmulatorConfig } from "./emulators/emulators-repository";
import { getEmulatorsBaseDir } from "./emulators/emulators-base-dir";
import {
  findClassicBox,
  findClassicFanart,
} from "./emulators/classic-fanart";

/**
 * Native PC ports of console games ("<emulators folder>\Ports\<game>": Bloodborne's port, Ship of
 * Harkinian…) join the library on their own, tagged platform "port" so they get their own tab
 * ("PORT" badge) instead of mixing with Steam/Epic games. Art comes from the console original.
 */

interface KnownPort {
  match: RegExp;
  title: string;
  /** Preferred launchers, in order (the port's own "play" script first). */
  launchers: string[];
  art: { platform: string; title: string };
}

const KNOWN_PORTS: KnownPort[] = [
  {
    match: /bloodborne/i,
    title: "Bloodborne",
    launchers: ["Jogar_Bloodborne.bat", "launch_gui.bat", "run.bat"],
    art: { platform: "ps4", title: "Bloodborne" },
  },
  {
    match: /harkinian/i,
    title: "Ship of Harkinian",
    launchers: ["soh.exe"],
    art: { platform: "n64", title: "The Legend of Zelda: Ocarina of Time" },
  },
];

const PORT_FOLDER_NAMES = ["Ports", "Port"];

/** "<base>\Ports" next to the emulators (same places the PC translations are looked for). */
const findPortRoots = async () => {
  const bases = new Set<string>([await getEmulatorsBaseDir()]);
  for (const system of EMULATOR_SYSTEMS as EmulatorSystem[]) {
    const exe = (await getEmulatorConfig(system).catch(() => null))?.executablePath;
    let dir = exe ? path.dirname(exe) : null;
    while (dir && path.dirname(dir) !== dir) {
      bases.add(dir);
      dir = path.dirname(dir);
    }
  }
  const roots = new Set<string>();
  for (const base of bases)
    for (const name of PORT_FOLDER_NAMES) {
      const candidate = path.join(base, name);
      try {
        if (fs.statSync(candidate).isDirectory()) roots.add(path.normalize(candidate));
      } catch {
        // Not there.
      }
    }
  return [...roots];
};

/** The file that starts the port: a known launcher, else "Jogar*.bat", else the only .exe. */
const findLauncher = (dir: string, known?: KnownPort) => {
  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const byLower = new Map(files.map((f) => [f.toLowerCase(), f]));
  for (const name of known?.launchers ?? []) {
    const hit = byLower.get(name.toLowerCase());
    if (hit) return path.join(dir, hit);
  }
  const play = files.find((f) => /^jogar.*\.(bat|cmd)$/i.test(f));
  if (play) return path.join(dir, play);
  const exes = files.filter((f) => /\.exe$/i.test(f) && !/unins|setup|crash|update/i.test(f));
  return exes.length === 1 ? path.join(dir, exes[0]) : null;
};

const portTitle = (folder: string, known?: KnownPort) =>
  known?.title ?? folder.replace(/\s*\((port|pc)[^)]*\)\s*/gi, " ").trim();

/** Case art from the console original (LaunchBox), background from its fanart. */
const portArt = (title: string, known?: KnownPort) => {
  const platform = known?.art.platform ?? null;
  const artTitle = known?.art.title ?? title;
  if (!platform) return { cover: null, hero: null };
  return {
    cover: findClassicBox(platform, artTitle)[0] ?? null,
    hero: findClassicFanart(platform, artTitle)[0] ?? null,
  };
};

const withArt = (game: Game, art: { cover: string | null; hero: string | null }): Game => ({
  ...game,
  platform: "port",
  customCoverImageUrl: game.customCoverImageUrl ?? art.cover ?? null,
  customHeroImageUrl: game.customHeroImageUrl ?? art.hero ?? null,
});

export const importPcPorts = async () => {
  const roots = await findPortRoots();
  if (roots.length === 0) return 0;

  const found: { launcher: string; title: string; known?: KnownPort }[] = [];
  for (const root of roots) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
      const known = KNOWN_PORTS.find((port) => port.match.test(entry.name));
      const launcher = findLauncher(path.join(root, entry.name), known);
      if (!launcher) continue;
      found.push({ launcher, title: portTitle(entry.name, known), known });
    }
  }
  if (found.length === 0) return 0;

  const library = await gamesSublevel.iterator().all();
  let changed = 0;
  for (const port of found) {
    const art = portArt(port.title, port.known);
    const existing = library.find(
      ([, game]) =>
        game.executablePath?.toLowerCase() === port.launcher.toLowerCase()
    );
    try {
      // A port the user removed stays removed.
      if (existing?.[1].isDeleted) continue;
      if (existing) {
        // Already in the library (added by hand or a previous run): only tag it and fill missing art.
        const [key, game] = existing;
        if (game.shop !== "custom") continue;
        const next = withArt(game, art);
        if (
          next.platform === game.platform &&
          next.customCoverImageUrl === game.customCoverImageUrl &&
          next.customHeroImageUrl === game.customHeroImageUrl
        )
          continue;
        await gamesSublevel.put(key, next);
        changed++;
        logger.info(`[ports] Tagged ${game.title} as a PC port`);
        continue;
      }
      const created = await addCustomGame(port.title, port.launcher);
      await gamesSublevel.put(
        levelKeys.game("custom", created.objectId),
        withArt(created, art)
      );
      changed++;
      logger.info(`[ports] Added ${port.title} (${port.launcher})`);
    } catch (error) {
      logger.warn(`[ports] Could not add ${port.title}`, error);
    }
  }

  if (changed > 0) WindowManager.sendToAppWindows("on-library-batch-complete");
  return changed;
};
