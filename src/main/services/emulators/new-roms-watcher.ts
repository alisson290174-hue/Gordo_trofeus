import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

import { EMULATOR_SYSTEMS, RETROARCH_ARCHIVE_EXTENSIONS } from "@shared";
import { gamesSublevel } from "@main/level";
import type { EmulatorSystem } from "@types";
import { logger } from "../logger";
import { WindowManager } from "../window-manager";
import { getEmulatorConfig } from "./emulators-repository";
import { KNOWN_BINARIES } from "./known-binaries";

/**
 * Games copied into a linked ROM folder used to show up only after "Reescanear". This looks at
 * every console's folders (standalone emulators and RetroArch) and quietly imports the ones with
 * files it has not seen before — same covers and metadata as a manual scan. Games the user
 * removed from the library are not brought back.
 */

const seenFile = () =>
  path.join(app.getPath("userData"), "rom-watch-seen.json");

const readSeen = (): Record<string, string[]> => {
  try {
    return JSON.parse(fs.readFileSync(seenFile(), "utf8"));
  } catch {
    return {};
  }
};

const writeSeen = (seen: Record<string, string[]>) => {
  try {
    fs.writeFileSync(seenFile(), JSON.stringify(seen));
  } catch (error) {
    logger.warn("[rom-watch] could not save the seen list", error);
  }
};

const listFiles = (
  folder: string,
  extensions: string[],
  maxDepth: number,
  depth = 0
): string[] => {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(folder, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory())
      return depth < maxDepth
        ? listFiles(full, extensions, maxDepth, depth + 1)
        : [];
    const lower = entry.name.toLowerCase();
    return extensions.some((ext) => lower.endsWith(ext)) ? [full] : [];
  });
};

const knownDiscPaths = async () => {
  const known = new Set<string>();
  for await (const game of gamesSublevel.values()) {
    for (const disc of game.discs ?? []) known.add(disc.path.toLowerCase());
  }
  return known;
};

interface Folder {
  path: string;
  scanSubfolders: boolean;
}

/** Folders holding files neither in the library nor seen by an earlier pass. */
const foldersWithNewFiles = (
  folders: Folder[],
  extensions: string[],
  known: Set<string>,
  seen: Set<string>
) => {
  const fresh: Folder[] = [];
  const files: string[] = [];
  for (const folder of folders) {
    const found = listFiles(
      folder.path,
      extensions,
      folder.scanSubfolders ? 4 : 0
    ).filter((file) => {
      const key = file.toLowerCase();
      return !known.has(key) && !seen.has(key);
    });
    if (found.length > 0) {
      fresh.push(folder);
      files.push(...found);
    }
  }
  return { fresh, files };
};

let running = false;

export const importNewRoms = async () => {
  if (running) return 0;
  running = true;
  try {
    const { withRemovedGamesKept, runLaunchboxImport } =
      await import("@main/events/emulators/import-launchbox-roms");
    const seen = readSeen();
    const known = await knownDiscPaths();
    let imported = 0;

    // PS4 games are folders, handled by repair-emulators (ps4FoldersWithNewGames).
    for (const system of EMULATOR_SYSTEMS as EmulatorSystem[]) {
      if (system === "ps4") continue;
      const config = await getEmulatorConfig(system).catch(() => null);
      if (!config?.romFolders?.length) continue;

      const extensions = KNOWN_BINARIES[system].romExtensions.map((ext) =>
        (ext.startsWith(".") ? ext : `.${ext}`).toLowerCase()
      );
      const seenSet = new Set(seen[system] ?? []);
      const { fresh, files } = foldersWithNewFiles(
        config.romFolders,
        extensions,
        known,
        seenSet
      );
      if (fresh.length === 0) continue;

      logger.info(
        `[rom-watch] ${system}: ${files.length} new file(s), importing ${fresh.length} folder(s)`
      );
      await withRemovedGamesKept(() =>
        runLaunchboxImport(system, fresh, "pt", { cancelled: false })
      ).catch((error) =>
        logger.warn(`[rom-watch] ${system} import failed`, error)
      );
      // Whatever the import did with them (game, extra disc, data file), they are known now.
      seen[system] = [...seenSet, ...files.map((file) => file.toLowerCase())];
      imported += files.length;
    }

    imported += await importNewRetroArchRoms(seen, known, withRemovedGamesKept);

    writeSeen(seen);
    if (imported > 0)
      WindowManager.sendToAppWindows("on-library-batch-complete");
    return imported;
  } finally {
    running = false;
  }
};

async function importNewRetroArchRoms(
  seen: Record<string, string[]>,
  known: Set<string>,
  withRemovedGamesKept: <T>(run: () => Promise<T>) => Promise<T>
) {
  const { getRetroArchConfig } =
    await import("@main/services/retroarch/retroarch-repository");
  const { ALL_RETROARCH_ROM_EXTENSIONS } =
    await import("@main/services/retroarch/retroarch-cores");
  const config = await getRetroArchConfig().catch(() => null);
  if (!config?.executablePath || !config.romFolders?.length) return 0;

  const extensions = [
    ...ALL_RETROARCH_ROM_EXTENSIONS,
    ...RETROARCH_ARCHIVE_EXTENSIONS,
  ].map((ext) => (ext.startsWith(".") ? ext : `.${ext}`).toLowerCase());
  const seenSet = new Set(seen.retroarch ?? []);
  const { fresh, files } = foldersWithNewFiles(
    config.romFolders,
    extensions,
    known,
    seenSet
  );
  if (fresh.length === 0) return 0;

  logger.info(
    `[rom-watch] retroarch: ${files.length} new file(s), importing ${fresh.length} folder(s)`
  );
  const { startTrackedRetroArchImport } =
    await import("@main/events/retroarch/import-retroarch-roms");
  await withRemovedGamesKept(
    () => startTrackedRetroArchImport(fresh, "pt").done
  ).catch((error) => logger.warn("[rom-watch] retroarch import failed", error));
  seen.retroarch = [...seenSet, ...files.map((file) => file.toLowerCase())];
  return files.length;
}

/** First pass a minute after start-up (after the emulator repair), then every 15 minutes. */
export const scheduleNewRomsWatcher = () => {
  const run = () =>
    void importNewRoms().catch((error) =>
      logger.warn("[rom-watch] pass skipped", error?.message ?? error)
    );
  setTimeout(run, 60_000);
  setInterval(run, 15 * 60 * 1000);
};
