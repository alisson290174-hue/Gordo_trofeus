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
  return path.join(qtEmulatorDataDir(executablePath, "eden"), "load", titleId, "Tradução PT-BR");
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
  const { system, executablePath, gameTitleId, sourcePath } = params;
  if (system !== "3ds" && system !== "switch") return { ok: false, reason: "unsupported_system" };
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

    const pick = pickModRoot(findModRoots(files), gameTitleId);
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
