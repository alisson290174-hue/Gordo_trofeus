import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { EmulatorSystem } from "@types";
import { SevenZip } from "../7zip";
import { logger } from "../logger";
import { qtEmulatorDataDir } from "./controller-autoconfig";
import {
  findExecutables,
  findModRoots,
  KNOWN_TRANSLATION_PASSWORDS,
  matchGameByName,
  pickModRoot,
} from "./translation-rules";

export type TranslationInstallError =
  | "unsupported_system"
  | "emulator_missing"
  | "unreadable"
  | "executable_inside"
  | "no_mod"
  | "wrong_game"
  | "unknown_title";

export type TranslationInstallResult =
  | { ok: true; titleId: string; target: string; fileCount: number }
  | { ok: false; reason: TranslationInstallError };

const ARCHIVE_RE = /\.(zip|7z|rar)$/i;

/** Eden lists each folder in load/<TitleID> as a mod; plain ASCII keeps it safe in any path API. */
export const EDEN_MOD_NAME = "Traducao PT-BR";

const listFiles = async (dir: string, base = dir): Promise<string[]> => {
  const out: string[] = [];
  for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    // Links could point anywhere on the disk; a translation never needs them.
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) out.push(...(await listFiles(full, base)));
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out;
};

const copyTree = async (from: string, to: string): Promise<number> => {
  let count = 0;
  await fs.promises.mkdir(to, { recursive: true });
  for (const entry of await fs.promises.readdir(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) count += await copyTree(source, target);
    else if (entry.isFile()) {
      await fs.promises.copyFile(source, target);
      count += 1;
    }
  }
  return count;
};

/** Where the emulator reads mods for a title (Azahar: load/mods/<id>, Eden: load/<id>/<name>). */
const modTarget = (system: EmulatorSystem, executablePath: string, titleId: string) => {
  if (system === "3ds") {
    return path.join(qtEmulatorDataDir(executablePath, "Azahar"), "load", "mods", titleId);
  }
  return path.join(qtEmulatorDataDir(executablePath, "eden"), "load", titleId, EDEN_MOD_NAME);
};

/**
 * Installs a translation archive (.zip/.7z/.rar) or an already-extracted folder for one game.
 * Archives with anything executable are refused; only the romfs/exefs of the matching title are
 * copied into the emulator's own mods folder, so the game files themselves are never touched.
 */
export const installTranslation = async (params: {
  system: EmulatorSystem;
  executablePath: string | null;
  gameTitleId: string | null;
  sourcePath: string;
}): Promise<TranslationInstallResult> => {
  const { system, executablePath, sourcePath } = params;
  if (system !== "3ds" && system !== "switch") return { ok: false, reason: "unsupported_system" };
  // Switch mods always live under the base game's ID (updates/DLC end in 800/001…).
  const toBase = (id: string) => (system === "switch" ? `${id.slice(0, 13)}000`.toUpperCase() : id);
  const gameTitleId = params.gameTitleId ? toBase(params.gameTitleId) : null;
  if (!executablePath || !fs.existsSync(executablePath)) return { ok: false, reason: "emulator_missing" };

  const isArchive = ARCHIVE_RE.test(sourcePath);
  const workDir = isArchive ? path.join(os.tmpdir(), `baloi-translation-${randomUUID()}`) : sourcePath;
  try {
    if (isArchive) {
      await SevenZip.extractFile({
        filePath: sourcePath,
        outputPath: workDir,
        passwords: KNOWN_TRANSLATION_PASSWORDS,
      });
    } else if (!fs.statSync(sourcePath).isDirectory()) {
      return { ok: false, reason: "unreadable" };
    }

    const files = await listFiles(workDir);
    if (findExecutables(files).length > 0) return { ok: false, reason: "executable_inside" };

    const roots = findModRoots(files).map((root) => ({
      ...root,
      titleId: root.titleId ? toBase(root.titleId) : null,
    }));
    const pick = pickModRoot(roots, gameTitleId);
    if (!pick.ok) return pick;

    const rootDir = path.resolve(workDir, pick.root.root);
    const target = modTarget(system, executablePath, pick.titleId);
    let fileCount = 0;
    for (const part of ["romfs", "exefs"]) {
      const from = path.join(rootDir, part);
      if (fs.existsSync(from)) fileCount += await copyTree(from, path.join(target, part));
    }
    logger.info("[translation] installed", { system, titleId: pick.titleId, target, fileCount });
    return { ok: true, titleId: pick.titleId, target, fileCount };
  } catch (error) {
    logger.error("[translation] install failed", error);
    return { ok: false, reason: "unreadable" };
  } finally {
    if (isArchive) await fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
};

export interface FolderTranslationGame {
  titleId: string;
  title: string;
}

export interface FolderTranslationResult {
  file: string;
  status: "installed" | "already_installed" | "no_game" | "failed";
  game?: string;
  reason?: string;
}

/** A game already has a translation when its mods folder holds anything. */
export const hasInstalledMod = (system: EmulatorSystem, executablePath: string, titleId: string) => {
  const target =
    system === "3ds"
      ? modTarget(system, executablePath, titleId)
      : path.join(qtEmulatorDataDir(executablePath, "eden"), "load", titleId);
  try {
    // "Opus - …" folders are the 60 FPS / cheat enhancements, not a translation.
    return fs.readdirSync(target).some((entry) => !entry.startsWith("Opus - "));
  } catch {
    return false;
  }
};

/**
 * Installs every translation in a folder (the user's "traducoes" folder) for the games in their
 * library: archives with title-ID folders go to that game; untagged ones are matched by file name.
 * Games that already have a translation are left alone, so it's safe to run on every scan.
 */
export const installTranslationsFromFolder = async (params: {
  system: EmulatorSystem;
  executablePath: string | null;
  folder: string;
  games: FolderTranslationGame[];
}): Promise<FolderTranslationResult[]> => {
  const { system, executablePath, folder, games } = params;
  if ((system !== "3ds" && system !== "switch") || !executablePath) return [];
  const entries = await fs.promises.readdir(folder, { withFileTypes: true }).catch(() => []);
  const results: FolderTranslationResult[] = [];
  const done = new Set<string>();

  for (const entry of entries) {
    const file = entry.name;
    if (!entry.isDirectory() && !ARCHIVE_RE.test(file)) continue;
    const sourcePath = path.join(folder, file);

    // Cheap check first: the title ID is usually in the archive's folder names.
    let candidates = games;
    if (ARCHIVE_RE.test(file)) {
      const listed = await SevenZip.listEntries(sourcePath).catch(() => null);
      // Folder names only; an archive whose listing is password-protected falls back to its name.
      const names = (listed ?? []).map((e) => `${e.name}/`);
      const ids = new Set(
        findModRoots(names)
          .map((root) => root.titleId)
          .filter((id): id is string => Boolean(id))
          .map((id) => (system === "switch" ? `${id.slice(0, 13)}000` : id))
      );
      if (ids.size > 0) candidates = games.filter((game) => ids.has(game.titleId.toUpperCase()));
      else {
        const byName = matchGameByName(file, games);
        candidates = byName ? [byName] : [];
      }
    } else {
      const inside = await listFiles(sourcePath).catch(() => [] as string[]);
      const ids = new Set(
        findModRoots(inside)
          .map((root) => root.titleId)
          .filter((id): id is string => Boolean(id))
          .map((id) => (system === "switch" ? `${id.slice(0, 13)}000` : id))
      );
      if (ids.size > 0) candidates = games.filter((game) => ids.has(game.titleId.toUpperCase()));
      else {
        const byName = matchGameByName(file, games);
        candidates = byName ? [byName] : [];
      }
    }

    const game = candidates.find((g) => !done.has(g.titleId.toUpperCase()));
    if (!game) {
      results.push({ file, status: candidates.length > 0 ? "already_installed" : "no_game" });
      continue;
    }
    if (hasInstalledMod(system, executablePath, game.titleId.toUpperCase())) {
      done.add(game.titleId.toUpperCase());
      results.push({ file, status: "already_installed", game: game.title });
      continue;
    }
    const result = await installTranslation({ system, executablePath, gameTitleId: game.titleId, sourcePath });
    if (result.ok) {
      done.add(game.titleId.toUpperCase());
      results.push({ file, status: "installed", game: game.title });
    } else {
      results.push({ file, status: "failed", game: game.title, reason: result.reason });
    }
  }
  logger.info("[translation] folder install", { system, folder, results });
  return results;
};
