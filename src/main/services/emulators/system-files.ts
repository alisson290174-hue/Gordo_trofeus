import fs from "node:fs";
import path from "node:path";

import type { EmulatorSystem } from "@types";
import { logger } from "../logger";
import { isEmulatorBiosInstalled } from "./bios-detection";
import { qtEmulatorDataDir } from "./controller-autoconfig";
import { getEmulatorConfig, updateEmulatorConfig } from "./emulators-repository";

/**
 * Files Opus can't download (Sony BIOS, Nintendo keys and firmware) but can FIND: people keep
 * them next to their games. When a game folder is linked, the folder, its parent and a couple of
 * levels below are searched and whatever an emulator is missing gets set up — nothing that's
 * already configured is touched.
 */

const MAX_ENTRIES = 4000;
const PS1_BIOS_SIZE = 512 * 1024;
const PS2_BIOS_SIZE = 4 * 1024 * 1024;
const PRIORITY_DIR = /bios|keys|firmware|system/i;

const walk = (roots: string[], maxDepth: number): string[] => {
  const files: string[] = [];
  const seen = new Set<string>();
  const visit = (dir: string, depth: number) => {
    if (files.length >= MAX_ENTRIES || seen.has(dir.toLowerCase())) return;
    seen.add(dir.toLowerCase());
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    // "Bios", "keys", "Firmware…" first: a parent full of ROMs would otherwise use up the budget.
    const priority = (entry: fs.Dirent) => (entry.isDirectory() && PRIORITY_DIR.test(entry.name) ? 0 : 1);
    entries.sort((a, b) => priority(a) - priority(b));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && depth < maxDepth) visit(full, depth + 1);
      else if (entry.isFile()) files.push(full);
      if (files.length >= MAX_ENTRIES) return;
    }
  };
  for (const root of roots) visit(root, 0);
  return files;
};

const searchRoots = (romFolders: string[]) =>
  Array.from(new Set(romFolders.flatMap((folder) => [folder, path.dirname(folder)])));

const contains = (file: string, needle: string, maxBytes: number) => {
  try {
    const handle = fs.openSync(file, "r");
    const buf = Buffer.alloc(maxBytes);
    const read = fs.readSync(handle, buf, 0, maxBytes, 0);
    fs.closeSync(handle);
    return buf.subarray(0, read).includes(needle, 0, "latin1");
  } catch {
    return false;
  }
};

/** Pure size + signature checks for a BIOS dump. */
const isPs1Bios = (file: string) =>
  /\.bin$/i.test(file) && fs.statSync(file).size === PS1_BIOS_SIZE && contains(file, "Sony Computer Entertainment", 0x400);
const isPs2Bios = (file: string) =>
  /\.(bin|rom0)$/i.test(file) && fs.statSync(file).size === PS2_BIOS_SIZE && contains(file, "ROMVER", 0x4000);

const provisionBios = async (system: "ps1" | "ps2", romFolders: string[]) => {
  const config = await getEmulatorConfig(system);
  if (await isEmulatorBiosInstalled(system, config.executablePath, config.biosPath)) return false;
  const check = system === "ps1" ? isPs1Bios : isPs2Bios;
  const bios = walk(searchRoots(romFolders), 3).find((file) => {
    try {
      return check(file);
    } catch {
      return false;
    }
  });
  if (!bios) return false;
  const biosDir = path.dirname(bios);
  await updateEmulatorConfig(system, (current) => ({ ...current, biosPath: biosDir }));
  logger.info("[system-files] BIOS found next to the games", { system, biosDir });
  return true;
};

const provisionSwitch = async (romFolders: string[]) => {
  const config = await getEmulatorConfig("switch");
  if (!config.executablePath) return false;
  const eden = qtEmulatorDataDir(config.executablePath, "eden");
  const keysDir = path.join(eden, "keys");
  const firmwareDir = path.join(eden, "nand", "system", "Contents", "registered");
  const needKeys = !fs.existsSync(path.join(keysDir, "prod.keys"));
  const needFirmware = !(fs.existsSync(firmwareDir) && fs.readdirSync(firmwareDir).some((n) => n.endsWith(".nca")));
  if (!needKeys && !needFirmware) return false;

  const files = walk(searchRoots(romFolders), 3);
  let changed = false;
  if (needKeys) {
    const prod = files.find((file) => path.basename(file).toLowerCase() === "prod.keys");
    if (prod) {
      fs.mkdirSync(keysDir, { recursive: true });
      fs.copyFileSync(prod, path.join(keysDir, "prod.keys"));
      const title = path.join(path.dirname(prod), "title.keys");
      if (fs.existsSync(title)) fs.copyFileSync(title, path.join(keysDir, "title.keys"));
      changed = true;
    }
  }
  if (needFirmware) {
    // A firmware dump is a folder of .nca files (with *.cnmt.nca metadata among them).
    const byDir = new Map<string, string[]>();
    for (const file of files) {
      if (!file.toLowerCase().endsWith(".nca")) continue;
      const list = byDir.get(path.dirname(file)) ?? [];
      list.push(file);
      byDir.set(path.dirname(file), list);
    }
    const firmware = [...byDir.values()].find(
      (list) => list.length >= 50 && list.some((file) => file.toLowerCase().endsWith(".cnmt.nca"))
    );
    if (firmware) {
      fs.mkdirSync(firmwareDir, { recursive: true });
      for (const file of firmware) fs.copyFileSync(file, path.join(firmwareDir, path.basename(file)));
      changed = true;
    }
  }
  if (changed) logger.info("[system-files] Switch keys/firmware set up from the games folder", { needKeys, needFirmware });
  return changed;
};

export const provisionSystemFiles = async (system: EmulatorSystem, romFolders: string[]) => {
  try {
    if (system === "ps1" || system === "ps2") return await provisionBios(system, romFolders);
    if (system === "switch") return await provisionSwitch(romFolders);
  } catch (error) {
    logger.warn("[system-files] could not set up system files", { system, error: String(error) });
  }
  return false;
};
