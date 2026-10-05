import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { net } from "electron";

import { logger } from "../logger";
import { SevenZip } from "../7zip";
import { qtEmulatorDataDir } from "./controller-autoconfig";
import {
  isSafeModFile,
  matchModPack,
  matchModPackByTitle,
  pickSwitchModFolders,
  withoutBrokenMods,
  titleIdOfPack,
} from "./switch-mods-rules";

/**
 * "Melhorias" for Switch games: 60 FPS, level of detail and no dynamic resolution, from the
 * community collection that tracks every Switch emulator. Each pack holds text patches (.pchtxt)
 * keyed to the game's exact build, so Eden applies only the ones that match the installed
 * version — the rest wait, harmlessly, until the game is updated. Programs inside a pack are
 * never copied.
 */

const REPO = "Fl4sh9174/Switch-Emulator-Ultrawide-FPS-Mods";
const PREFIX = "Opus - ";

export type SwitchModsResult =
  { status: "installed"; mods: string[] } | { status: "not_found" | "failed" };

const edenLoadDir = (executablePath: string) => {
  const dataDir = qtEmulatorDataDir(executablePath, "eden");
  const config = path.join(dataDir, "config", "qt-config.ini");
  const custom = fs.existsSync(config)
    ? /^load_directory=(.+)$/m
        .exec(fs.readFileSync(config, "utf8"))?.[1]
        ?.trim()
    : null;
  return custom || path.join(dataDir, "load");
};

let packListCache: { at: number; files: string[] } | null = null;
const listPacks = async () => {
  if (packListCache && Date.now() - packListCache.at < 60 * 60_000)
    return packListCache.files;
  const response = await net.fetch(
    `https://api.github.com/repos/${REPO}/git/trees/main`,
    {
      headers: {
        "user-agent": "OpusLauncher",
        accept: "application/vnd.github+json",
      },
    }
  );
  if (!response.ok) throw new Error(`mods list ${response.status}`);
  const data = (await response.json()) as {
    tree: { path: string; type: string }[];
  };
  const files = data.tree
    .filter((entry) => entry.type === "blob" && entry.path.endsWith(".zip"))
    .map((entry) => entry.path);
  packListCache = { at: Date.now(), files };
  return files;
};

const walk = (dir: string, base = dir): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full, base) : [path.relative(base, full)];
  });

export const installSwitchMods = async (
  game: { titleId: string | null; title: string },
  executablePath: string
): Promise<SwitchModsResult> => {
  const packs = await listPacks();
  const pack =
    (game.titleId ? matchModPack(packs, game.titleId) : null) ??
    matchModPackByTitle(packs, game.title);
  const titleId = game.titleId ?? (pack ? titleIdOfPack(pack) : null);
  if (!pack || !titleId) return { status: "not_found" };

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "opus-mods-"));
  try {
    const zip = path.join(work, "pack.zip");
    const url = `https://raw.githubusercontent.com/${REPO}/main/${encodeURIComponent(pack)}`;
    const response = await net.fetch(url, {
      headers: { "user-agent": "OpusLauncher" },
    });
    if (!response.ok) return { status: "failed" };
    fs.writeFileSync(zip, Buffer.from(await response.arrayBuffer()));
    const extracted = path.join(work, "x");
    await SevenZip.extractFile({ filePath: zip, outputPath: extracted });

    // Packs either hold the mod folders at the top or one level down.
    const top = fs
      .readdirSync(extracted, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    const root =
      top.length === 1 && pickSwitchModFolders(top).length === 0
        ? path.join(extracted, top[0])
        : extracted;
    const folders = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    const chosen = withoutBrokenMods(titleId, pickSwitchModFolders(folders));
    if (chosen.length === 0) return { status: "not_found" };

    const target = path.join(
      edenLoadDir(executablePath),
      titleId.toUpperCase()
    );
    // Replace what Opus installed before; anything the user added stays.
    if (fs.existsSync(target)) {
      for (const old of fs.readdirSync(target)) {
        if (old.startsWith(PREFIX))
          fs.rmSync(path.join(target, old), { recursive: true, force: true });
      }
    }
    const installed: string[] = [];
    for (const folder of chosen) {
      const source = path.join(root, folder);
      const name = folder
        .replace(/\]\s*\[/g, " - ")
        .replace(/^\[|\]$/g, "")
        .replace(/[<>:"/\\|?*]/g, "")
        .trim();
      let copied = 0;
      for (const relative of walk(source)) {
        if (!isSafeModFile(relative)) continue;
        const destination = path.join(target, `${PREFIX}${name}`, relative);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(path.join(source, relative), destination);
        copied += 1;
      }
      if (copied > 0) installed.push(name);
    }
    logger.info("[switch-mods] installed", { titleId, pack, installed });
    return installed.length > 0
      ? { status: "installed", mods: installed }
      : { status: "not_found" };
  } catch (error) {
    logger.warn("[switch-mods] failed", { titleId, error: String(error) });
    return { status: "failed" };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
};
