import { gamesSublevel } from "@main/level";
import { emulators, logger, retroarch } from "@main/services";
import { platformToSystem } from "@main/helpers";
import { platformToRetroArchPlatform } from "../../../shared/retroarch-platform";
import {
  fetchOnlineRomTranslations,
  type PatchableGame,
} from "@main/services/emulators/rom-translations";
import type { EmulatorSystem } from "@types";

import { runLaunchboxImport } from "./import-launchbox-roms";
import { startTrackedRetroArchImport } from "../retroarch/import-retroarch-roms";

/** Consoles whose translations ship as ROM/ISO patches (3DS and Switch use mod folders). */
export const PATCH_SYSTEMS: readonly EmulatorSystem[] = ["ps1", "ps2", "psp", "dolphin"];

const libraryGames = async (keep: (platform: string | null | undefined) => boolean): Promise<PatchableGame[]> => {
  const games: PatchableGame[] = [];
  for await (const game of gamesSublevel.values()) {
    if (game.isDeleted || game.shop !== "launchbox" || !keep(game.platform)) continue;
    const romPath = game.selectedDiscPath ?? game.discs?.[0]?.path ?? null;
    if (romPath) games.push({ title: game.title, platform: game.platform, romPath });
  }
  return games;
};

/** Reimports a console so the new "PT-BR" copies show up as games. */
const reimportEmulator = async (system: EmulatorSystem) => {
  const config = await emulators.getEmulatorConfig(system);
  await runLaunchboxImport(
    system,
    config.romFolders.map((f) => ({ path: f.path, scanSubfolders: f.scanSubfolders })),
    "pt-BR",
    { cancelled: false }
  );
};

const reimportRetroArch = async () => {
  const config = await retroarch.getRetroArchConfig();
  await startTrackedRetroArchImport(
    config.romFolders.map((f) => ({ path: f.path, scanSubfolders: f.scanSubfolders })),
    "pt-BR"
  ).done;
};

/** After a PS1/PS2/PSP/Dolphin sync: download and apply any known PT-BR patch, then reimport. */
export const autoTranslateEmulator = async (system: EmulatorSystem) => {
  if (!PATCH_SYSTEMS.includes(system)) return;
  try {
    const created = await fetchOnlineRomTranslations(await libraryGames((p) => platformToSystem(p) === system));
    if (created > 0) await reimportEmulator(system);
  } catch (error) {
    logger.warn("[rom-translation] auto pass failed", { system, error: String(error) });
  }
};

/** Same for RetroArch consoles (N64, DS, GBA, SNES, NES…). */
export const autoTranslateRetroArch = async () => {
  try {
    const created = await fetchOnlineRomTranslations(await libraryGames((p) => platformToRetroArchPlatform(p) !== null));
    if (created > 0) await reimportRetroArch();
  } catch (error) {
    logger.warn("[rom-translation] auto pass failed (RetroArch)", { error: String(error) });
  }
};

export const reimportAfterManualPatch = async (platform: string | null | undefined) => {
  const system = platformToSystem(platform);
  if (system && PATCH_SYSTEMS.includes(system)) return reimportEmulator(system);
  if (platformToRetroArchPlatform(platform)) return reimportRetroArch();
};
