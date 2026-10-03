import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Product code ("CTR-P-AREE") of a 3DS dump, read from the plaintext NCCH header: a .3ds/.cci is
 * an NCSD image whose first partition is an NCCH; a .cxi is an NCCH on its own. The product code
 * sits at NCCH + 0x150 and stays the same across rescans, so it's the game's stable identifier.
 * Decryption isn't needed — these header fields are never encrypted.
 */
const MEDIA_UNIT = 0x200;
const PRODUCT_CODE_RE = /^(?:CTR|KTR)-[A-Z0-9]-[A-Z0-9]{4}$/;

const readAt = async (handle: fs.FileHandle, offset: number, length: number) => {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, offset);
  return buffer.subarray(0, bytesRead);
};

const productCodeAt = async (handle: fs.FileHandle, ncchOffset: number) => {
  const header = await readAt(handle, ncchOffset, 0x200);
  if (header.length < 0x160 || header.toString("latin1", 0x100, 0x104) !== "NCCH") return null;
  const code = header.toString("latin1", 0x150, 0x160).replace(/\0+$/, "").trim();
  return PRODUCT_CODE_RE.test(code) ? code : null;
};

export const extract3dsProductCode = async (filePath: string): Promise<string | null> => {
  const extension = path.extname(filePath).toLowerCase();
  if (![".3ds", ".cci", ".cxi"].includes(extension)) return null;

  const handle = await fs.open(filePath, "r");
  try {
    const ncsd = await readAt(handle, 0, 0x200);
    if (ncsd.length >= 0x128 && ncsd.toString("latin1", 0x100, 0x104) === "NCSD") {
      const partitionOffset = ncsd.readUInt32LE(0x120) * MEDIA_UNIT;
      return await productCodeAt(handle, partitionOffset);
    }
    return await productCodeAt(handle, 0);
  } catch {
    return null;
  } finally {
    await handle.close();
  }
};
