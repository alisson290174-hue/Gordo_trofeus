import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * RetroAchievements identifies a PS2 disc by the same hash PCSX2 computes (rcheevos `rc_hash_ps2`):
 * MD5 of the boot executable's name (from SYSTEM.CNF `BOOT2 = cdrom0:\SLUS_123.45;1`) followed by
 * the executable's bytes (capped at 64 MiB, at least one full sector).
 *
 * Supports plain 2048-byte images (.iso) and raw 2352-byte CD images (.bin, or a .cue pointing at
 * one). Compressed formats (.chd/.cso) return null — they need random access we don't do here.
 */
const SECTOR = 2048;
const MAX_HASH_BYTES = 64 * 1024 * 1024;

interface SectorReader {
  read(lba: number, length?: number): Promise<Buffer>;
  close(): Promise<void>;
}

const RAW_SYNC = Buffer.from([0x00, ...Array(10).fill(0xff), 0x00]);

async function openSectorReader(filePath: string): Promise<SectorReader> {
  const handle = await fs.open(filePath, "r");
  const head = Buffer.alloc(16);
  await handle.read(head, 0, 16, 0);

  // Raw CD sectors start with a sync pattern; byte 15 is the mode (1 → data at 16, 2 → at 24).
  const raw = head.subarray(0, 12).equals(RAW_SYNC);
  const sectorSize = raw ? 2352 : SECTOR;
  const dataOffset = raw ? (head[15] === 2 ? 24 : 16) : 0;

  return {
    async read(lba, length = SECTOR) {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, lba * sectorSize + dataOffset);
      return buffer.subarray(0, bytesRead);
    },
    close: () => handle.close(),
  };
}

interface DirEntry {
  lba: number;
  size: number;
  isDir: boolean;
}

async function readDirectory(reader: SectorReader, dir: DirEntry) {
  const entries = new Map<string, DirEntry>();
  const sectors = Math.ceil(dir.size / SECTOR);
  for (let s = 0; s < sectors; s++) {
    const sector = await reader.read(dir.lba + s);
    let offset = 0;
    while (offset < sector.length) {
      const length = sector[offset];
      if (length === 0) break; // records never span sectors; the rest is padding
      const nameLength = sector[offset + 32];
      const rawName = sector.toString("latin1", offset + 33, offset + 33 + nameLength);
      if (nameLength > 1 || (rawName !== "\0" && rawName !== "\x01")) {
        entries.set(rawName.replace(/;\d+$/, "").replace(/\.$/, "").toUpperCase(), {
          lba: sector.readUInt32LE(offset + 2),
          size: sector.readUInt32LE(offset + 10),
          isDir: (sector[offset + 25] & 0x02) !== 0,
        });
      }
      offset += length;
    }
  }
  return entries;
}

async function findFile(reader: SectorReader, root: DirEntry, filePath: string) {
  let current: DirEntry | undefined = root;
  for (const part of filePath.split(/[\\/]+/).filter(Boolean)) {
    if (!current?.isDir) return null;
    current = (await readDirectory(reader, current)).get(part.toUpperCase());
  }
  return current && !current.isDir ? current : null;
}

/** `BOOT2 = cdrom0:\SLUS_212.68;1` → `SLUS_212.68` (subfolders kept, as rcheevos does). */
export function parseBootExecutable(systemCnf: string): string | null {
  for (const line of systemCnf.split(/\r?\n/)) {
    const match = /^\s*BOOT2\s*=\s*(?:cdrom0:)?\\?([^\s;]+)/i.exec(line);
    if (match) return match[1];
  }
  return null;
}

async function resolveCueTarget(cuePath: string) {
  const cue = await fs.readFile(cuePath, "utf8");
  const match = /FILE\s+"([^"]+)"/i.exec(cue) ?? /FILE\s+(\S+)/i.exec(cue);
  return match ? path.resolve(path.dirname(cuePath), match[1]) : null;
}

export async function computePs2DiscHash(discPath: string): Promise<string | null> {
  const extension = path.extname(discPath).toLowerCase();
  if (![".iso", ".bin", ".img", ".cue"].includes(extension)) return null;

  const imagePath = extension === ".cue" ? await resolveCueTarget(discPath) : discPath;
  if (!imagePath) return null;

  const reader = await openSectorReader(imagePath);
  try {
    const pvd = await reader.read(16);
    if (pvd[0] !== 1 || pvd.toString("latin1", 1, 6) !== "CD001") return null;
    const root: DirEntry = {
      lba: pvd.readUInt32LE(156 + 2),
      size: pvd.readUInt32LE(156 + 10),
      isDir: true,
    };

    const systemCnf = await findFile(reader, root, "SYSTEM.CNF");
    if (!systemCnf) return null;
    const bootName = parseBootExecutable(
      (await reader.read(systemCnf.lba, Math.min(systemCnf.size, SECTOR - 1))).toString("latin1")
    );
    if (!bootName) return null;

    const executable = await findFile(reader, root, bootName);
    if (!executable) return null;

    const md5 = createHash("md5").update(bootName, "latin1");
    // rcheevos always hashes the first full sector, then the remaining bytes of the file.
    let remaining = Math.min(executable.size, MAX_HASH_BYTES);
    let lba = executable.lba;
    let chunk = await reader.read(lba, SECTOR);
    if (chunk.length < SECTOR) return null;
    for (;;) {
      md5.update(chunk);
      if (remaining <= chunk.length) break;
      remaining -= chunk.length;
      lba += 1;
      chunk = await reader.read(lba, Math.min(remaining, SECTOR));
      if (chunk.length === 0) break;
    }
    return md5.digest("hex");
  } finally {
    await reader.close();
  }
}
