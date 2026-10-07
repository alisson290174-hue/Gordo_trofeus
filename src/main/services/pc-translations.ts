import fs from "node:fs";
import path from "node:path";

import { EMULATOR_SYSTEMS } from "@shared";
import type { EmulatorSystem } from "@types";
import { getEmulatorConfig } from "./emulators/emulators-repository";
import { getEmulatorsBaseDir } from "./emulators/emulators-base-dir";
import { normaliseFanartTitle } from "./emulators/classic-fanart-rules";

/**
 * PC game translations kept for later (downloaded from Central de Traduções): one folder per game
 * under "<emulators folder>\Traduções\PC". The folder is looked for in the Opus emulators folder
 * and in every folder above a configured emulator (D:\EMULADORES\… → D:\EMULADORES).
 */
const SUBFOLDERS = [
  ["Traduções", "PC"],
  ["Traducoes", "PC"],
];

let rootCache: { at: number; root: string | null } | null = null;

const findRoot = async (): Promise<string | null> => {
  if (rootCache && Date.now() - rootCache.at < 60_000) return rootCache.root;
  const bases = new Set<string>([await getEmulatorsBaseDir()]);
  for (const system of EMULATOR_SYSTEMS as EmulatorSystem[]) {
    const exe = (await getEmulatorConfig(system).catch(() => null))
      ?.executablePath;
    let dir = exe ? path.dirname(exe) : null;
    while (dir && path.dirname(dir) !== dir) {
      bases.add(dir);
      dir = path.dirname(dir);
    }
  }
  let root: string | null = null;
  for (const base of bases) {
    for (const parts of SUBFOLDERS) {
      const candidate = path.join(base, ...parts);
      if (fs.existsSync(candidate)) {
        root = candidate;
        break;
      }
    }
    if (root) break;
  }
  rootCache = { at: Date.now(), root };
  return root;
};

const EDITION =
  / (vr|definitive|complete|goty|game of year|remastered|enhanced|deluxe|ultimate|special|gold|anniversary|director s cut|redux|legendary)( edition)?$/;
const baseTitle = (title: string) => {
  let key = normaliseFanartTitle(title);
  for (let i = 0; i < 3; i += 1) key = key.replace(EDITION, "");
  return key;
};

export interface PcTranslation {
  folder: string;
  files: string[];
}

/** The kept translation folder for a PC game (same title, edition words ignored), if any. */
export const findPcTranslation = async (
  title: string
): Promise<PcTranslation | null> => {
  const root = await findRoot();
  if (!root) return null;
  const wanted = normaliseFanartTitle(title);
  const wantedBase = baseTitle(title);
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const name = normaliseFanartTitle(entry.name);
    if (name !== wanted && baseTitle(entry.name) !== wantedBase) continue;
    const folder = path.join(root, entry.name);
    const files = fs
      .readdirSync(folder)
      .filter((file) => !file.startsWith("."))
      .sort();
    return files.length ? { folder, files } : null;
  }
  return null;
};
