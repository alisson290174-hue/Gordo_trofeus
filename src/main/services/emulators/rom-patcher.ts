import { promises as fs } from "node:fs";

/**
 * Applies fan-translation patches to a copy of the user's ROM, with no external program:
 *  - BPS (beat): N64/SNES/GBA translations. CRC32 of source, target and patch are checked.
 *  - xdelta3 / VCDIFF (RFC 3284): NDS/PSP/GameCube translations. Plain VCDIFF only (no secondary
 *    compression, the xdelta3 default for these files); xdelta's per-window Adler-32 is checked.
 * A patch made for another dump fails its checksum instead of producing a broken game.
 */

export type PatchError = "unsupported_format" | "wrong_rom" | "corrupt_patch";

export class RomPatchError extends Error {
  constructor(
    public readonly reason: PatchError,
    message?: string
  ) {
    super(message ?? reason);
  }
}

// ---- CRC32 / Adler-32 ------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export const crc32 = (data: Uint8Array, start = 0, end = data.length) => {
  let crc = 0xffffffff;
  for (let i = start; i < end; i += 1)
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const adler32 = (data: Uint8Array) => {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i += 1) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
};

// ---- BPS ------------------------------------------------------------------------------------------

export const applyBps = (source: Uint8Array, patch: Uint8Array): Uint8Array => {
  if (
    patch.length < 19 ||
    String.fromCharCode(...patch.subarray(0, 4)) !== "BPS1"
  ) {
    throw new RomPatchError("unsupported_format");
  }
  if (
    crc32(patch, 0, patch.length - 4) !==
    new DataView(patch.buffer, patch.byteOffset).getUint32(
      patch.length - 4,
      true
    )
  ) {
    throw new RomPatchError("corrupt_patch");
  }
  const footer = new DataView(
    patch.buffer,
    patch.byteOffset + patch.length - 12,
    12
  );
  if (crc32(source) !== footer.getUint32(0, true))
    throw new RomPatchError("wrong_rom");

  let offset = 4;
  const number = () => {
    let data = 0;
    let shift = 1;
    for (;;) {
      const x = patch[offset++];
      data += (x & 0x7f) * shift;
      if (x & 0x80) break;
      shift *= 128;
      data += shift;
    }
    return data;
  };
  const sourceSize = number();
  const targetSize = number();
  const metadataSize = number();
  offset += metadataSize;
  if (sourceSize !== source.length) throw new RomPatchError("wrong_rom");

  const target = new Uint8Array(targetSize);
  let outputOffset = 0;
  let sourceRelative = 0;
  let targetRelative = 0;
  const end = patch.length - 12;
  while (offset < end) {
    const action = number();
    const command = action % 4;
    let length = Math.floor(action / 4) + 1;
    if (command === 0) {
      target.set(
        source.subarray(outputOffset, outputOffset + length),
        outputOffset
      );
      outputOffset += length;
    } else if (command === 1) {
      target.set(patch.subarray(offset, offset + length), outputOffset);
      offset += length;
      outputOffset += length;
    } else {
      const data = number();
      const delta = (data & 1 ? -1 : 1) * Math.floor(data / 2);
      if (command === 2) {
        sourceRelative += delta;
        target.set(
          source.subarray(sourceRelative, sourceRelative + length),
          outputOffset
        );
        sourceRelative += length;
        outputOffset += length;
      } else {
        targetRelative += delta;
        while (length-- > 0) target[outputOffset++] = target[targetRelative++];
      }
    }
  }
  if (crc32(target) !== footer.getUint32(4, true))
    throw new RomPatchError("wrong_rom");
  return target;
};

// ---- VCDIFF (xdelta3) -------------------------------------------------------------------------------

type Op = { type: 0 | 1 | 2 | 3; size: number; mode: number }; // 0 NOOP, 1 ADD, 2 RUN, 3 COPY
const NOOP: Op = { type: 0, size: 0, mode: 0 };

/** RFC 3284 §5.6 default code table. */
const CODE_TABLE: [Op, Op][] = (() => {
  const table: [Op, Op][] = [[{ type: 2, size: 0, mode: 0 }, NOOP]];
  for (let size = 0; size <= 17; size += 1)
    table.push([{ type: 1, size, mode: 0 }, NOOP]);
  for (let mode = 0; mode <= 8; mode += 1) {
    table.push([{ type: 3, size: 0, mode }, NOOP]);
    for (let size = 4; size <= 18; size += 1)
      table.push([{ type: 3, size, mode }, NOOP]);
  }
  for (let mode = 0; mode <= 5; mode += 1) {
    for (let add = 1; add <= 4; add += 1) {
      for (let copy = 4; copy <= 6; copy += 1) {
        table.push([
          { type: 1, size: add, mode: 0 },
          { type: 3, size: copy, mode },
        ]);
      }
    }
  }
  for (let mode = 6; mode <= 8; mode += 1) {
    for (let add = 1; add <= 4; add += 1)
      table.push([
        { type: 1, size: add, mode: 0 },
        { type: 3, size: 4, mode },
      ]);
  }
  for (let mode = 0; mode <= 8; mode += 1)
    table.push([
      { type: 3, size: 4, mode },
      { type: 1, size: 1, mode: 0 },
    ]);
  return table;
})();

const S_NEAR = 4;
const S_SAME = 3;

class Reader {
  constructor(
    public buf: Uint8Array,
    public pos = 0
  ) {}
  byte() {
    if (this.pos >= this.buf.length) throw new RomPatchError("corrupt_patch");
    return this.buf[this.pos++];
  }
  int() {
    let value = 0;
    for (;;) {
      const b = this.byte();
      value = value * 128 + (b & 0x7f);
      if (!(b & 0x80)) return value;
    }
  }
  bytes(n: number) {
    if (this.pos + n > this.buf.length)
      throw new RomPatchError("corrupt_patch");
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
}

/** Decodes one VCDIFF window. `readSource(pos, len)` returns that slice of the source file. */
export const decodeVcdiffWindow = async (
  win: {
    sourceLength: number;
    sourcePosition: number;
    targetLength: number;
    data: Uint8Array;
    inst: Uint8Array;
    addr: Uint8Array;
  },
  readSource: (position: number, length: number) => Promise<Uint8Array>
): Promise<Uint8Array> => {
  const source =
    win.sourceLength > 0
      ? await readSource(win.sourcePosition, win.sourceLength)
      : new Uint8Array(0);
  const target = new Uint8Array(win.targetLength);
  const data = new Reader(win.data);
  const inst = new Reader(win.inst);
  const addr = new Reader(win.addr);
  const near = new Array<number>(S_NEAR).fill(0);
  let nextNear = 0;
  const same = new Array<number>(S_SAME * 256).fill(0);
  let t = 0;

  const decodeAddress = (mode: number) => {
    const here = win.sourceLength + t;
    let address: number;
    if (mode === 0) address = addr.int();
    else if (mode === 1) address = here - addr.int();
    else if (mode - 2 < S_NEAR) address = near[mode - 2] + addr.int();
    else address = same[(mode - 2 - S_NEAR) * 256 + addr.byte()];
    near[nextNear] = address;
    nextNear = (nextNear + 1) % S_NEAR;
    same[address % (S_SAME * 256)] = address;
    return address;
  };

  const run = (op: Op) => {
    if (op.type === 0) return;
    const size = op.size === 0 ? inst.int() : op.size;
    if (t + size > target.length) throw new RomPatchError("corrupt_patch");
    if (op.type === 1) {
      target.set(data.bytes(size), t);
      t += size;
    } else if (op.type === 2) {
      target.fill(data.byte(), t, t + size);
      t += size;
    } else {
      let address = decodeAddress(op.mode);
      for (let i = 0; i < size; i += 1, address += 1) {
        target[t++] =
          address < win.sourceLength
            ? source[address]
            : target[address - win.sourceLength];
      }
    }
  };

  while (inst.pos < inst.buf.length) {
    const [first, second] = CODE_TABLE[inst.byte()];
    run(first);
    run(second);
  }
  if (t !== target.length) throw new RomPatchError("corrupt_patch");
  return target;
};

/** Streams an xdelta3/VCDIFF patch over `sourcePath`, writing the result to `targetPath`. */
export const applyVcdiffFile = async (
  sourcePath: string,
  patchPath: string,
  targetPath: string
) => {
  const patch = await fs.open(patchPath, "r");
  const source = await fs.open(sourcePath, "r");
  const out = await fs.open(targetPath, "w");
  try {
    const { size: patchSize } = await patch.stat();
    let pos = 0;
    const readAt = async (position: number, length: number) => {
      const buf = Buffer.alloc(length);
      const { bytesRead } = await patch.read(buf, 0, length, position);
      return buf.subarray(0, bytesRead);
    };
    const readSource = async (position: number, length: number) => {
      const buf = Buffer.alloc(length);
      const { bytesRead } = await source.read(buf, 0, length, position);
      if (bytesRead !== length) throw new RomPatchError("wrong_rom");
      return buf;
    };

    const header = new Reader(await readAt(0, Math.min(4096, patchSize)));
    const magic = header.bytes(4);
    if (magic[0] !== 0xd6 || magic[1] !== 0xc3 || magic[2] !== 0xc4)
      throw new RomPatchError("unsupported_format");
    const indicator = header.byte();
    if (indicator & 0x03) throw new RomPatchError("unsupported_format"); // secondary compression / custom table
    if (indicator & 0x04) header.bytes(header.int()); // xdelta3 app header (file names)
    pos = header.pos;

    while (pos < patchSize) {
      // A window header fits in 64 bytes; its sections follow.
      const head = new Reader(await readAt(pos, 64));
      const winIndicator = head.byte();
      let sourceLength = 0;
      let sourcePosition = 0;
      if (winIndicator & 0x03) {
        if (winIndicator & 0x02) throw new RomPatchError("unsupported_format"); // VCD_TARGET
        sourceLength = head.int();
        sourcePosition = head.int();
      }
      const deltaLength = head.int();
      const deltaStart = pos + head.pos;
      const delta = new Reader(await readAt(deltaStart, deltaLength));
      const targetLength = delta.int();
      if (delta.byte() !== 0) throw new RomPatchError("unsupported_format"); // compressed sections
      const dataLength = delta.int();
      const instLength = delta.int();
      const addrLength = delta.int();
      let checksum: number | null = null;
      if (winIndicator & 0x04) {
        // xdelta3's per-window Adler-32, big-endian. (Read bytewise: a Buffer slice shares the pool.)
        const c = delta.bytes(4);
        checksum = ((c[0] << 24) | (c[1] << 16) | (c[2] << 8) | c[3]) >>> 0;
      }
      const window = {
        sourceLength,
        sourcePosition,
        targetLength,
        data: delta.bytes(dataLength),
        inst: delta.bytes(instLength),
        addr: delta.bytes(addrLength),
      };
      const target = await decodeVcdiffWindow(window, readSource);
      if (checksum !== null && adler32(target) !== checksum)
        throw new RomPatchError("wrong_rom");
      await out.write(target);
      pos = deltaStart + deltaLength;
    }
  } finally {
    await Promise.all([patch.close(), source.close(), out.close()]);
  }
};

/** Patch by file type; writes `targetPath`. */
export const applyRomPatch = async (
  sourcePath: string,
  patchPath: string,
  targetPath: string
) => {
  const head = Buffer.alloc(4);
  const handle = await fs.open(patchPath, "r");
  await handle.read(head, 0, 4, 0);
  await handle.close();
  if (head.toString("latin1") === "BPS1") {
    const result = applyBps(
      await fs.readFile(sourcePath),
      await fs.readFile(patchPath)
    );
    await fs.writeFile(targetPath, result);
    return;
  }
  if (head[0] === 0xd6 && head[1] === 0xc3 && head[2] === 0xc4) {
    try {
      await applyVcdiffFile(sourcePath, patchPath, targetPath);
    } catch (error) {
      await fs.rm(targetPath, { force: true });
      throw error;
    }
    return;
  }
  throw new RomPatchError("unsupported_format");
};
