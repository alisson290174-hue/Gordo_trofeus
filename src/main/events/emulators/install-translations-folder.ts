import fs from "node:fs";
import path from "node:path";

import { registerEvent } from "../register-event";
import { gamesSublevel } from "@main/level";
import { emulators, logger } from "@main/services";
import { platformToSystem } from "@main/helpers";
import { qtEmulatorDataDir } from "@main/services/emulators/controller-autoconfig";
import {
  hasInstalledMod,
  installTranslationsFromFolder,
  type FolderTranslationGame,
} from "@main/services/emulators/translation-installer";
import { fetchOnlineTranslations } from "@main/services/emulators/online-translations";
import { app } from "electron";
import type { EmulatorSystem } from "@types";

/** Title IDs of the console's games in the library (Switch: from the serial, 3DS: from the file). */
const libraryGames = async (
  system: EmulatorSystem
): Promise<FolderTranslationGame[]> => {
  const games: FolderTranslationGame[] = [];
  for await (const game of gamesSublevel.values()) {
    if (
      game.isDeleted ||
      game.shop !== "launchbox" ||
      platformToSystem(game.platform) !== system
    )
      continue;
    const disc = game.selectedDiscPath ?? game.discs?.[0]?.path ?? null;
    let titleId: string | null = null;
    if (system === "3ds" && disc)
      titleId = (await emulators.read3dsHeader(disc))?.titleId ?? null;
    else
      titleId =
        /[0-9a-f]{16}/i.exec(game.discs?.[0]?.sku ?? "")?.[0] ??
        /[0-9a-f]{16}/i.exec(game.objectId)?.[0] ??
        null;
    if (titleId)
      games.push({ titleId: titleId.toUpperCase(), title: game.title });
  }
  return games;
};

const run = async (system: EmulatorSystem, folder: string) => {
  const config = await emulators.getEmulatorConfig(system);
  const games = await libraryGames(system);
  // Eden makes a load/<TitleID> folder for every game it has scanned, so those IDs are the user's
  // games too, even when a dump's ID couldn't be read (encrypted XCI). They match by ID only.
  if (system === "switch" && config.executablePath) {
    const loadDir = path.join(
      qtEmulatorDataDir(config.executablePath, "eden"),
      "load"
    );
    const known = new Set(games.map((g) => g.titleId));
    for (const name of await fs.promises
      .readdir(loadDir)
      .catch(() => [] as string[])) {
      const id = name.toUpperCase();
      if (/^[0-9A-F]{16}$/.test(id) && id.endsWith("000") && !known.has(id))
        games.push({ titleId: id, title: "" });
    }
  }
  return installTranslationsFromFolder({
    system,
    executablePath: config.executablePath,
    folder,
    games,
  });
};

const TRANSLATION_FOLDER_NAMES = [
  "traducoes",
  "traduções",
  "traducao",
  "tradução",
  "translations",
];

/**
 * After a 3DS/Switch scan: a "traducoes" folder inside or next to a ROM folder is installed by
 * itself, so keeping translations beside the games is all the user has to do.
 */
export const autoInstallTranslations = async (
  system: EmulatorSystem,
  romFolders: string[]
) => {
  if (system !== "3ds" && system !== "switch") return;
  const seen = new Set<string>();
  let saveFolder: string | null = null;
  for (const romFolder of romFolders) {
    for (const base of [romFolder, path.dirname(romFolder)]) {
      for (const name of TRANSLATION_FOLDER_NAMES) {
        const candidate = path.join(base, name);
        if (seen.has(candidate.toLowerCase()) || !fs.existsSync(candidate))
          continue;
        seen.add(candidate.toLowerCase());
        saveFolder ??= candidate;
        await run(system, candidate).catch((error) =>
          logger.error("[translation] auto install failed", error)
        );
      }
    }
  }

  // Then the online repository, for the games still without a translation.
  const config = await emulators.getEmulatorConfig(system);
  if (!config.executablePath) return;
  const games = await libraryGames(system);
  await fetchOnlineTranslations({
    system,
    executablePath: config.executablePath,
    games: games.map((game) => ({
      ...game,
      hasTranslation: hasInstalledMod(
        system,
        config.executablePath as string,
        game.titleId
      ),
    })),
    saveFolder:
      saveFolder ?? path.join(app.getPath("userData"), "translations", system),
  }).catch((error) => logger.error("[translation] online pass failed", error));
};

registerEvent(
  "installTranslationsFromFolder",
  (_event, system: EmulatorSystem, folder: string) => {
    if ((system !== "3ds" && system !== "switch") || typeof folder !== "string")
      return [];
    return run(system, folder);
  }
);

// "Baixar traduções online": every console at once (mods for 3DS/Switch, patched copies for the rest).
registerEvent("downloadAllTranslationsOnline", async () => {
  const { autoTranslateEmulator, autoTranslateRetroArch, PATCH_SYSTEMS } =
    await import("./rom-translation-hooks");
  for (const system of ["3ds", "switch"] as const) {
    const config = await emulators.getEmulatorConfig(system);
    await autoInstallTranslations(
      system,
      config.romFolders.map((folder) => folder.path)
    );
  }
  for (const system of PATCH_SYSTEMS) await autoTranslateEmulator(system);
  await autoTranslateRetroArch();
  return true;
});
