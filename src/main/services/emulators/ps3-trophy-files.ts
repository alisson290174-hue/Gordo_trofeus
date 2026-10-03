/**
 * Pure readers for the trophy files RPCS3 keeps per user in
 * dev_hdd0/home/<user>/trophy/<NPCOMMID>/ (no Electron imports, unit-tested):
 *  - TROPCONF.SFM: the game's trophy list (XML), with each trophy's grade (P/G/S/B).
 *  - TROPUSR.DAT: big-endian tables; type-6 entries hold each trophy's state and unlock time.
 */

export type Ps3Grade = "P" | "G" | "S" | "B";

export interface Ps3Trophy {
  id: string;
  displayName: string;
  description: string;
  hidden: boolean;
  grade: Ps3Grade;
}

const decodeXml = (value: string) =>
  value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();

export const parseTropconf = (xml: string): { title: string | null; trophies: Ps3Trophy[] } => {
  const title = /<title-name>([\s\S]*?)<\/title-name>/.exec(xml)?.[1] ?? null;
  const trophies: Ps3Trophy[] = [];
  for (const match of xml.matchAll(/<trophy\s([^>]*)>([\s\S]*?)<\/trophy>/g)) {
    const attrs = match[1];
    const id = /\bid="(\d{1,3})"/.exec(attrs)?.[1];
    const grade = /\bttype="([PGSB])"/.exec(attrs)?.[1] as Ps3Grade | undefined;
    if (!id || !grade) continue;
    trophies.push({
      id,
      displayName: decodeXml(/<name>([\s\S]*?)<\/name>/.exec(match[2])?.[1] ?? ""),
      description: decodeXml(/<detail>([\s\S]*?)<\/detail>/.exec(match[2])?.[1] ?? ""),
      hidden: /\bhidden="yes"/.test(attrs),
      grade,
    });
  }
  return { title: title ? decodeXml(title) : null, trophies };
};

const TROPUSR_MAGIC = 0x818f54ad;
const HEADER_SIZE = 0x30;
const TABLE_HEADER_SIZE = 0x20;
/** CellRtcTick (µs since 0001-01-01) of the Unix epoch. */
const UNIX_EPOCH_TICKS = 62135596800000000n;

/** Unlocked trophies (by numeric id) → unlock time in ms (null when RPCS3 stored no time). */
export const parseTropusr = (data: Buffer): Map<number, number | null> => {
  const unlocked = new Map<number, number | null>();
  if (data.length < HEADER_SIZE || data.readUInt32BE(0) !== TROPUSR_MAGIC) return unlocked;
  const tables = data.readUInt32BE(8);
  for (let t = 0; t < tables && HEADER_SIZE + (t + 1) * TABLE_HEADER_SIZE <= data.length; t += 1) {
    const header = HEADER_SIZE + t * TABLE_HEADER_SIZE;
    const type = data.readUInt32BE(header);
    const entrySize = data.readUInt32BE(header + 4);
    const count = data.readUInt32BE(header + 12);
    const offset = Number(data.readBigUInt64BE(header + 16));
    if (type !== 6 || entrySize < 0x30) continue;
    for (let i = 0; i < count; i += 1) {
      // Each entry: 16-byte header (type, size, id, unk) then the payload.
      const entry = offset + i * (entrySize + 0x10);
      if (entry + 0x10 + 0x18 > data.length) break;
      const trophyId = data.readUInt32BE(entry + 0x10);
      const state = data.readUInt32BE(entry + 0x14);
      if (state !== 1) continue;
      const ticks = data.readBigUInt64BE(entry + 0x20);
      unlocked.set(trophyId, ticks > UNIX_EPOCH_TICKS ? Number((ticks - UNIX_EPOCH_TICKS) / 1000n) : null);
    }
  }
  return unlocked;
};

/** Opus tiers come from rarity; each PS3 grade gets a rarity inside its tier. */
export const PS3_GRADE_PERCENT: Record<Ps3Grade, number> = { P: 1, G: 5, S: 25, B: 60 };
