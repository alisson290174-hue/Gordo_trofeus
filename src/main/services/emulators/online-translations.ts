import fs from "node:fs";
import { net } from "electron";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

import type { EmulatorSystem } from "@types";
import { logger } from "../logger";
import { sha256File } from "../verified-download";
import { installTranslation, type FolderTranslationGame } from "./translation-installer";
import { matchGameByName } from "./translation-rules";

/**
 * Brazilian fan translations published by João13 Traduções on Hugging Face. Every file there has
 * its SHA-256 in the repository index, so a download is installed only when it matches — the same
 * fail-closed rule Balói uses for emulator downloads. Only these repositories are ever contacted.
 */
const SOURCES: Partial<Record<EmulatorSystem, { repo: string; dir: string }>> = {
  switch: { repo: "Joao13TraducoesDublagens/Traducao-NS", dir: "" },
  "3ds": { repo: "Joao13TraducoesDublagens/Traducoes", dir: "3DS" },
};

const MAX_BYTES = 2 * 1024 * 1024 * 1024;

interface RepoFile {
  path: string;
  size: number;
  sha256: string;
}

const listRepo = async (repo: string, dir: string): Promise<RepoFile[]> => {
  const url = `https://huggingface.co/api/models/${repo}/tree/main${dir ? `/${encodeURIComponent(dir)}` : ""}`;
  // Chromium's network stack (Windows certificate store), like the rest of the app's downloads.
  const response = await net.fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) return [];
  const items = (await response.json()) as { path: string; size?: number; lfs?: { oid?: string } }[];
  return items
    .filter((item) => /\.(rar|zip|7z)$/i.test(item.path) && /^[0-9a-f]{64}$/i.test(item.lfs?.oid ?? ""))
    .map((item) => ({ path: item.path, size: item.size ?? 0, sha256: (item.lfs?.oid as string).toLowerCase() }));
};

const download = async (repo: string, file: RepoFile, target: string) => {
  const url = `https://huggingface.co/${repo}/resolve/main/${file.path.split("/").map(encodeURIComponent).join("/")}`;
  const response = await net.fetch(url, { redirect: "follow", signal: AbortSignal.timeout(30 * 60_000) });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
  const partial = `${target}.part`;
  await pipeline(Readable.fromWeb(response.body as never), fs.createWriteStream(partial));
  if ((await sha256File(partial)) !== file.sha256) {
    await fs.promises.rm(partial, { force: true });
    throw new Error("SHA-256 mismatch");
  }
  await fs.promises.rename(partial, target);
};

export interface OnlineTranslationResult {
  game: string;
  file: string;
  status: "installed" | "failed";
  reason?: string;
}

/**
 * For each game without a translation, looks for one in the known repository (matched by title),
 * downloads it into `saveFolder`, checks its hash and installs it. Games already translated, or
 * with no match, are skipped.
 */
export const fetchOnlineTranslations = async (params: {
  system: EmulatorSystem;
  executablePath: string | null;
  games: (FolderTranslationGame & { hasTranslation: boolean })[];
  saveFolder: string;
}): Promise<OnlineTranslationResult[]> => {
  const source = SOURCES[params.system];
  if (!source || !params.executablePath) return [];
  const pending = params.games.filter((game) => !game.hasTranslation && game.title);
  if (pending.length === 0) return [];

  const files = await listRepo(source.repo, source.dir).catch((error) => {
    logger.warn("[translation] could not list the online repository", error);
    return [] as RepoFile[];
  });
  const results: OnlineTranslationResult[] = [];
  for (const game of pending) {
    // Every word of the game's title must be in the file name, and vice versa (see matchGameByName).
    const file = files.find((candidate) => matchGameByName(path.basename(candidate.path), [game]));
    if (!file || file.size > MAX_BYTES) continue;
    const target = path.join(params.saveFolder, path.basename(file.path));
    try {
      await fs.promises.mkdir(params.saveFolder, { recursive: true });
      if (!fs.existsSync(target) || (await sha256File(target)) !== file.sha256) {
        await download(source.repo, file, target);
      }
      const result = await installTranslation({
        system: params.system,
        executablePath: params.executablePath,
        gameTitleId: game.titleId,
        sourcePath: target,
      });
      results.push(
        result.ok
          ? { game: game.title, file: path.basename(file.path), status: "installed" }
          : { game: game.title, file: path.basename(file.path), status: "failed", reason: result.reason }
      );
    } catch (error) {
      logger.warn("[translation] online download failed", { game: game.title, error });
      results.push({ game: game.title, file: path.basename(file.path), status: "failed", reason: String(error) });
    }
  }
  logger.info("[translation] online", { system: params.system, results });
  return results;
};
