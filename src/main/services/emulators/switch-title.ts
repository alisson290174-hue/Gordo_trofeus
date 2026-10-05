import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Nintendo Switch dumps (.nsp/.xci) are identified by their 16-hex-digit Title ID. Base games end
 * in "000", updates in "800", DLC in anything else (e.g. base 01008F6008C5E000 → update
 * 01008F6008C5E800, DLC 01008F6008C5F001). Only base games become library entries.
 */
export type SwitchContentKind = "base" | "update" | "dlc";

const TITLE_ID_RE = /\b(01[0-9A-F]{14})\b/i;

export const titleIdFromName = (fileName: string): string | null =>
  TITLE_ID_RE.exec(fileName.replace(/[[\]()]/g, " "))?.[1].toUpperCase() ??
  null;

export const contentKindOfTitleId = (titleId: string): SwitchContentKind => {
  const id = titleId.toUpperCase();
  if (id.endsWith("800")) return "update";
  return id.endsWith("000") ? "base" : "dlc";
};

/** Best guess from the file name: its Title ID when present, otherwise the usual dump tags. */
export const contentKindFromName = (fileName: string): SwitchContentKind => {
  const id = titleIdFromName(fileName);
  if (id) {
    const kind = contentKindOfTitleId(id);
    // Some dumps carry the update's ID in their name; "[v0]" still means the base game.
    return kind === "update" && /\[v0\]/i.test(fileName) ? "base" : kind;
  }
  if (/\b(?:update|upd)\b/i.test(fileName)) return "update";
  if (/\bdlc\b/i.test(fileName)) return "dlc";
  return "base";
};

/**
 * Title ID of an NSP whose name doesn't carry one. NSPs are PFS0 archives with a plaintext file
 * table; the ticket is named after its rights ID, whose first 16 hex digits are the Title ID.
 */
export const readNspTitleId = async (
  filePath: string
): Promise<string | null> => {
  if (path.extname(filePath).toLowerCase() !== ".nsp") return null;
  const handle = await fs.open(filePath, "r");
  try {
    const header = Buffer.alloc(16);
    await handle.read(header, 0, 16, 0);
    if (header.toString("latin1", 0, 4) !== "PFS0") return null;
    const fileCount = header.readUInt32LE(4);
    const stringTableSize = header.readUInt32LE(8);
    if (fileCount === 0 || fileCount > 4096 || stringTableSize > 1024 * 1024)
      return null;

    const table = Buffer.alloc(fileCount * 24 + stringTableSize);
    await handle.read(table, 0, table.length, 16);
    const strings = table.subarray(fileCount * 24);
    for (let i = 0; i < fileCount; i++) {
      const nameOffset = table.readUInt32LE(i * 24 + 16);
      const end = strings.indexOf(0, nameOffset);
      const name = strings.toString(
        "latin1",
        nameOffset,
        end === -1 ? undefined : end
      );
      const match = /^(01[0-9a-f]{14})[0-9a-f]{16}\.tik$/i.exec(name);
      if (match) return match[1].toUpperCase();
    }
    return null;
  } finally {
    await handle.close();
  }
};

export const extractSwitchTitleId = async (
  filePath: string
): Promise<string | null> =>
  titleIdFromName(path.basename(filePath)) ??
  (await readNspTitleId(filePath).catch(() => null));
