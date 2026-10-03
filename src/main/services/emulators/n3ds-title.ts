import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Header facts of a 3DS dump, read from the plaintext NCCH header: a .3ds/.cci is an NCSD image
 * whose first partition is an NCCH; a .cxi/.app is an NCCH on its own; a .cia is an installable
 * archive whose first content is the NCCH. The product code ("CTR-P-AREE") sits at NCCH + 0x150
 * and stays the same across rescans, so it's the game's stable identifier. These header fields
 * are never encrypted, which also lets us tell an encrypted dump apart without any keys.
 */
const MEDIA_UNIT = 0x200;
const PRODUCT_CODE_RE = /^(?:CTR|KTR)-[A-Z0-9]-[A-Z0-9]{4}$/;
/** NCCH flags[7] bit: the content is stored decrypted. */
const NCCH_NO_CRYPTO = 0x04;

const HEADER_EXTENSIONS = new Set([".3ds", ".cci", ".cxi", ".app", ".cia"]);

export interface N3dsHeader {
  productCode: string | null;
  /** Program ID ("0004000000055d00"), the folder name Azahar installs the title under. */
  titleId: string | null;
  /** Azahar refuses encrypted titles, so these can't be played until decrypted. */
  encrypted: boolean;
}

const readAt = async (handle: fs.FileHandle, offset: number, length: number) => {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, offset);
  return buffer.subarray(0, bytesRead);
};

const ncchAt = async (
  handle: fs.FileHandle,
  ncchOffset: number
): Promise<N3dsHeader | null> => {
  const header = await readAt(handle, ncchOffset, 0x200);
  if (header.length < 0x190 || header.toString("latin1", 0x100, 0x104) !== "NCCH") return null;
  const code = header.toString("latin1", 0x150, 0x160).replace(/\0+$/, "").trim();
  const programId = header.readBigUInt64LE(0x118);
  return {
    productCode: PRODUCT_CODE_RE.test(code) ? code : null,
    titleId: programId > 0n ? programId.toString(16).padStart(16, "0") : null,
    encrypted: (header[0x18f] & NCCH_NO_CRYPTO) === 0,
  };
};

const align64 = (value: number) => Math.ceil(value / 64) * 64;

/** Offset of the first content (the game's NCCH) inside a CIA. */
const ciaContentOffset = async (handle: fs.FileHandle): Promise<number | null> => {
  const header = await readAt(handle, 0, 0x20);
  if (header.length < 0x20) return null;
  const headerSize = header.readUInt32LE(0x00);
  if (headerSize !== 0x2020) return null;
  return (
    align64(headerSize) +
    align64(header.readUInt32LE(0x08)) + // certificate chain
    align64(header.readUInt32LE(0x0c)) + // ticket
    align64(header.readUInt32LE(0x10)) // TMD
  );
};

export const read3dsHeader = async (filePath: string): Promise<N3dsHeader | null> => {
  const extension = path.extname(filePath).toLowerCase();
  if (!HEADER_EXTENSIONS.has(extension)) return null;

  const handle = await fs.open(filePath, "r");
  try {
    if (extension === ".cia") {
      const contentOffset = await ciaContentOffset(handle);
      if (contentOffset === null) return null;
      // A CIA whose content is encrypted with the title key hides even the NCCH magic.
      return (await ncchAt(handle, contentOffset)) ?? { productCode: null, titleId: null, encrypted: true };
    }
    const ncsd = await readAt(handle, 0, 0x200);
    if (ncsd.length >= 0x128 && ncsd.toString("latin1", 0x100, 0x104) === "NCSD") {
      return await ncchAt(handle, ncsd.readUInt32LE(0x120) * MEDIA_UNIT);
    }
    return await ncchAt(handle, 0);
  } catch {
    return null;
  } finally {
    await handle.close();
  }
};

export const extract3dsProductCode = async (filePath: string): Promise<string | null> =>
  (await read3dsHeader(filePath))?.productCode ?? null;

/** True only when the header proves the dump is encrypted; unknown formats count as playable. */
export const is3dsEncrypted = async (filePath: string): Promise<boolean> =>
  (await read3dsHeader(filePath))?.encrypted ?? false;

const SD_ID = "0".repeat(32);

/** Azahar's data folder: a "user" folder next to the executable (portable) or %APPDATA%\Azahar. */
const azaharUserDirs = (executablePath: string): string[] => {
  const dirs = [path.join(path.dirname(executablePath), "user")];
  if (process.env.APPDATA) {
    dirs.push(path.join(process.env.APPDATA, "Azahar"), path.join(process.env.APPDATA, "Citra"));
  }
  return dirs;
};

/**
 * The bootable .app of a title already installed into Azahar's emulated SD card, so a .cia
 * installed once opens straight into the game instead of asking to install again.
 */
export const findInstalled3dsTitle = async (
  executablePath: string,
  titleId: string
): Promise<string | null> => {
  if (!/^[0-9a-f]{16}$/.test(titleId)) return null;
  for (const userDir of azaharUserDirs(executablePath)) {
    const contentDir = path.join(
      userDir, "sdmc", "Nintendo 3DS", SD_ID, SD_ID, "title",
      titleId.slice(0, 8), titleId.slice(8), "content"
    );
    const apps = await fs.readdir(contentDir).catch(() => [] as string[]);
    const app = apps.filter((name) => /^[0-9a-f]{8}\.app$/i.test(name)).sort()[0];
    if (app) return path.join(contentDir, app);
  }
  return null;
};
