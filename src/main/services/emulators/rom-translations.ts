import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { app, net } from "electron";

import { SevenZip } from "../7zip";
import { logger } from "../logger";
import { sha256File } from "../verified-download";
import { applyRomPatch, RomPatchError, type PatchError } from "./rom-patcher";
import { findExecutables, KNOWN_TRANSLATION_PASSWORDS, matchGameByName } from "./translation-rules";

/**
 * Translations that ship as patches (BPS/xdelta) for cartridge and disc games — N64, DS, GBA, SNES,
 * PSP, PS1, PS2, GameCube, Wii. The patch is applied to a COPY of the user's game, saved next to it
 * as "<name> PT-BR.<ext>": the original stays untouched (and keeps its RetroAchievements trophies).
 */

export interface PatchableGame {
  title: string;
  platform: string | null | undefined;
  romPath: string;
}

export type RomTranslationResult =
  | { ok: true; outputPath: string }
  | { ok: false; reason: PatchError | "no_patch" | "executable_inside" | "unreadable" | "already_translated" };

const PATCH_RE = /\.(bps|xdelta|vcdiff)$/i;

/** "D:\N64\Super Mario 64 (USA).z64" → "D:\N64\Super Mario 64 PT-BR.z64". */
export const translatedCopyPath = (romPath: string) => {
  const ext = path.extname(romPath);
  const base = path.basename(romPath, ext).replace(/\s*\([^)]*\)/g, "").trim();
  return path.join(path.dirname(romPath), `${base} PT-BR${ext}`);
};

const isTranslatedName = (filePath: string) => /\bPT-?BR\b|\(BR\)|traduzid/i.test(path.basename(filePath));

const listFiles = (dir: string, base = dir): string[] => {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else if (entry.isFile()) out.push(path.relative(base, full));
  }
  return out;
};

/** Applies the patch inside an archive (.rar/.zip/.7z) or a bare patch file to one game. */
export const applyTranslationArchive = async (game: PatchableGame, sourcePath: string): Promise<RomTranslationResult> => {
  if (isTranslatedName(game.romPath)) return { ok: false, reason: "already_translated" };
  const outputPath = translatedCopyPath(game.romPath);
  const work = path.join(os.tmpdir(), `baloi-patch-${randomUUID()}`);
  try {
    let patches: string[] = [];
    if (PATCH_RE.test(sourcePath)) {
      patches = [sourcePath];
    } else {
      await SevenZip.extractFile({ filePath: sourcePath, outputPath: work, passwords: KNOWN_TRANSLATION_PASSWORDS });
      const files = listFiles(work);
      // A patcher .exe/.bat is never run; the patch file next to it is all Opus needs.
      if (findExecutables(files).some((file) => !/\.(bat|cmd)$/i.test(file))) {
        return { ok: false, reason: "executable_inside" };
      }
      patches = files.filter((file) => PATCH_RE.test(file)).map((file) => path.join(work, file));
    }
    if (patches.length === 0) return { ok: false, reason: "no_patch" };

    // Several patches (e.g. Ocarina of Time + Master Quest): the one named like the game first.
    patches.sort((a, b) => Number(Boolean(matchGameByName(path.basename(b), [game]))) - Number(Boolean(matchGameByName(path.basename(a), [game]))));
    let lastError: PatchError = "wrong_rom";
    for (const patch of patches) {
      try {
        await applyRomPatch(game.romPath, patch, outputPath);
        logger.info("[rom-translation] applied", { game: game.title, outputPath });
        return { ok: true, outputPath };
      } catch (error) {
        lastError = error instanceof RomPatchError ? error.reason : "corrupt_patch";
      }
    }
    return { ok: false, reason: lastError };
  } catch (error) {
    logger.warn("[rom-translation] failed", { game: game.title, error: String(error) });
    return { ok: false, reason: "unreadable" };
  } finally {
    await fs.promises.rm(work, { recursive: true, force: true }).catch(() => {});
  }
};

// ---- Online: João13 Traduções on Hugging Face (hash-checked) --------------------------------------

const REPOS: { test: RegExp; repo: string; dir: string }[] = [
  { test: /nintendo 64/i, repo: "Traducao-N64", dir: "" },
  { test: /nintendo ds/i, repo: "Traducao-NDS", dir: "" },
  { test: /game\s*boy advance/i, repo: "GBA", dir: "" },
  { test: /playstation portable/i, repo: "Traducao-PSP", dir: "" },
  { test: /^playstation$/i, repo: "Traducao-PS1", dir: "" },
  { test: /playstation 2/i, repo: "Traducao-PS2", dir: "" },
  { test: /wii/i, repo: "Traducao-Wii", dir: "" },
  { test: /gamecube/i, repo: "Traducoes", dir: "GC" },
  { test: /super nintendo/i, repo: "Traducoes", dir: "SNES" },
  { test: /entertainment system/i, repo: "Traducoes", dir: "NES" },
];
const OWNER = "Joao13TraducoesDublagens";
const MAX_BYTES = 2 * 1024 * 1024 * 1024;

interface RepoFile {
  path: string;
  size: number;
  sha256: string;
}

const listings = new Map<string, Promise<RepoFile[]>>();
const listRepo = (repo: string, dir: string) => {
  const key = `${repo}/${dir}`;
  let listing = listings.get(key);
  if (!listing) {
    listing = (async () => {
      const url = `https://huggingface.co/api/models/${OWNER}/${repo}/tree/main${dir ? `/${encodeURIComponent(dir)}` : ""}`;
      const response = await net.fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) return [];
      const items = (await response.json()) as { path: string; size?: number; lfs?: { oid?: string } }[];
      return items
        .filter((item) => /\.(rar|zip|7z)$/i.test(item.path) && /^[0-9a-f]{64}$/i.test(item.lfs?.oid ?? ""))
        .map((item) => ({ path: item.path, size: item.size ?? 0, sha256: (item.lfs?.oid as string).toLowerCase() }));
    })().catch(() => {
      listings.delete(key);
      return [];
    });
    listings.set(key, listing);
  }
  return listing;
};

const download = async (repo: string, file: RepoFile, target: string) => {
  const url = `https://huggingface.co/${OWNER}/${repo}/resolve/main/${file.path.split("/").map(encodeURIComponent).join("/")}`;
  const response = await net.fetch(url, { redirect: "follow", signal: AbortSignal.timeout(60 * 60_000) });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
  const partial = `${target}.part`;
  await pipeline(Readable.fromWeb(response.body as never), fs.createWriteStream(partial));
  if ((await sha256File(partial)) !== file.sha256) {
    await fs.promises.rm(partial, { force: true });
    throw new Error("SHA-256 mismatch");
  }
  await fs.promises.rename(partial, target);
};

/**
 * For each game with no "PT-BR" copy yet, finds its translation by name in the console's repo,
 * downloads it (hash-checked) and applies it. Returns how many translated copies were created.
 */
export type OnlineRomTranslationOutcome =
  | { status: "installed"; outputPath: string }
  | { status: "already" | "unsupported" | "not_found" }
  | { status: "failed"; reason: string };

/** One game: look up its translation online, download (hash-checked) and apply it. */
export const findOnlineRomTranslation = async (game: PatchableGame): Promise<OnlineRomTranslationOutcome> => {
  if (isTranslatedName(game.romPath) || fs.existsSync(translatedCopyPath(game.romPath))) return { status: "already" };
  const source = REPOS.find((candidate) => candidate.test.test(game.platform ?? ""));
  if (!source) return { status: "unsupported" };
  const files = await listRepo(source.repo, source.dir);
  const file = files.find((candidate) => matchGameByName(path.basename(candidate.path), [game]));
  if (!file || file.size > MAX_BYTES) return { status: "not_found" };
  const target = path.join(app.getPath("userData"), "translations", source.repo, path.basename(file.path));
  try {
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    if (!fs.existsSync(target) || (await sha256File(target)) !== file.sha256) await download(source.repo, file, target);
    const result = await applyTranslationArchive(game, target);
    if (result.ok) return { status: "installed", outputPath: result.outputPath };
    logger.info("[rom-translation] online patch not applied", { game: game.title, reason: result.reason });
    return { status: "failed", reason: result.reason };
  } catch (error) {
    logger.warn("[rom-translation] online download failed", { game: game.title, error: String(error) });
    return { status: "failed", reason: String(error) };
  }
};

export const fetchOnlineRomTranslations = async (games: PatchableGame[]): Promise<number> => {
  let created = 0;
  for (const game of games) {
    if ((await findOnlineRomTranslation(game)).status === "installed") created += 1;
  }
  return created;
};
