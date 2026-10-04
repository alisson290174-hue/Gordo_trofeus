import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { computePs1DiscHash, computePs2DiscHash } from "./ps2-disc-hash";

/**
 * RetroAchievements console IDs and how each identifies a game (rcheevos `rc_hash_*`):
 * cartridges hash the ROM bytes (minus copier/iNES headers, N64 in big-endian order),
 * PlayStation discs hash the boot executable.
 */
export const RA_CONSOLE = {
  n64: 2,
  snes: 3,
  gb: 4,
  gba: 5,
  gbc: 6,
  nes: 7,
  ps1: 12,
  ps2: 21,
} as const;

export type RaConsoleKey = keyof typeof RA_CONSOLE;

/** Opus's platform name → RetroAchievements console. */
export const raConsoleForPlatform = (platform: string | null | undefined): RaConsoleKey | null => {
  const p = (platform ?? "").toLowerCase();
  if (/playstation\s*2|\bps2\b/.test(p)) return "ps2";
  if (/playstation\s*(3|4|portable)|\bps[34]\b|\bpsp\b/.test(p)) return null;
  if (/playstation|\bps1\b|\bpsx\b/.test(p)) return "ps1";
  if (/super nintendo|\bsnes\b/.test(p)) return "snes";
  if (/nintendo 64|\bn64\b/.test(p)) return "n64";
  if (/game\s*boy advance|\bgba\b/.test(p)) return "gba";
  if (/game\s*boy color|\bgbc\b/.test(p)) return "gbc";
  if (/game\s*boy|\bgb\b/.test(p)) return "gb";
  if (/nintendo entertainment system|\bnes\b/.test(p)) return "nes";
  return null;
};

const MAX_ROM_BYTES = 64 * 1024 * 1024;

/** N64 dumps come in three byte orders; RetroAchievements hashes the big-endian (.z64) one. */
export const toBigEndianN64 = (rom: Buffer): Buffer => {
  const magic = rom.readUInt32BE(0);
  if (magic === 0x80371240) return rom; // .z64
  const out = Buffer.from(rom);
  if (magic === 0x37804012) {
    // .v64: 16-bit byte-swapped
    for (let i = 0; i + 1 < out.length; i += 2) [out[i], out[i + 1]] = [out[i + 1], out[i]];
  } else if (magic === 0x40123780) {
    // .n64: 32-bit little-endian
    for (let i = 0; i + 3 < out.length; i += 4) {
      [out[i], out[i + 1], out[i + 2], out[i + 3]] = [out[i + 3], out[i + 2], out[i + 1], out[i]];
    }
  }
  return out;
};

/** Pure: the bytes RetroAchievements hashes for a cartridge ROM. */
export const cartridgeHashBytes = (console: RaConsoleKey, rom: Buffer): Buffer => {
  if (console === "snes" && rom.length % 8192 === 512) return rom.subarray(512); // copier header
  if (console === "nes" && rom.subarray(0, 4).toString("latin1") === "NES\x1a") return rom.subarray(16);
  if (console === "n64") return toBigEndianN64(rom);
  return rom;
};

/** RetroAchievements hash of a game file, or null when it can't be read (zip, chd, unknown). */
export const computeRaHash = async (console: RaConsoleKey, filePath: string): Promise<string | null> => {
  if (console === "ps2") return computePs2DiscHash(filePath);
  if (console === "ps1") return computePs1DiscHash(filePath);
  if (/\.(zip|7z|rar|chd)$/i.test(path.extname(filePath))) return null;
  const stat = await fs.stat(filePath);
  if (stat.size === 0 || stat.size > MAX_ROM_BYTES) return null;
  const rom = await fs.readFile(filePath);
  return createHash("md5").update(cartridgeHashBytes(console, rom)).digest("hex");
};
