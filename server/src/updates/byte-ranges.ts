/**
 * Multi-range downloads for the update feed. electron-updater fetches only the changed blocks of
 * the new installer (a few MB) in requests like "Range: bytes=0-99,5000-6000"; it needs a
 * multipart/byteranges answer, which @fastify/static doesn't give, so every update was a full
 * 200 MB download. Single ranges keep going through @fastify/static.
 */
export interface ByteRange {
  start: number;
  end: number; // inclusive
}

const MAX_RANGES = 2000;

/** Ranges from a "bytes=a-b,c-d" header; null when absent, malformed or not satisfiable. */
export function parseByteRanges(header: string | undefined, size: number): ByteRange[] | null {
  if (!header || !header.startsWith("bytes=") || size <= 0) return null;
  const parts = header.slice("bytes=".length).split(",");
  if (parts.length > MAX_RANGES) return null;

  const ranges: ByteRange[] = [];
  for (const raw of parts) {
    const match = /^\s*(\d*)-(\d*)\s*$/.exec(raw);
    if (!match) return null;
    const [, from, to] = match;
    let start: number;
    let end: number;
    if (from === "" && to === "") return null;
    if (from === "") {
      // Suffix range: the last N bytes.
      const length = Number(to);
      if (length <= 0) return null;
      start = Math.max(0, size - length);
      end = size - 1;
    } else {
      start = Number(from);
      end = to === "" ? size - 1 : Math.min(Number(to), size - 1);
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size)
      return null;
    ranges.push({ start, end });
  }
  return ranges;
}

/** Part headers and total length of a multipart/byteranges body. */
export function buildMultipartLayout(
  ranges: ByteRange[],
  size: number,
  boundary: string,
  contentType = "application/octet-stream"
) {
  const parts = ranges.map((range, index) => ({
    range,
    header:
      `${index === 0 ? "" : "\r\n"}--${boundary}\r\n` +
      `Content-Type: ${contentType}\r\n` +
      `Content-Range: bytes ${range.start}-${range.end}/${size}\r\n\r\n`,
  }));
  const closing = `\r\n--${boundary}--\r\n`;
  const length =
    parts.reduce(
      (sum, part) => sum + Buffer.byteLength(part.header) + (part.range.end - part.range.start + 1),
      0
    ) + Buffer.byteLength(closing);
  return { parts, closing, length };
}

/** Streams the parts to the response; each read gets its own buffer (write() may keep a reference). */
export async function writeMultipartRanges(
  out: NodeJS.WritableStream & { destroy(error?: Error): void },
  filePath: string,
  layout: ReturnType<typeof buildMultipartLayout>
) {
  const { open } = await import("node:fs/promises");
  const fd = await open(filePath, "r");
  const write = (data: string | Buffer) =>
    out.write(data) ? Promise.resolve() : new Promise<void>((r) => out.once("drain", () => r()));
  try {
    for (const part of layout.parts) {
      await write(part.header);
      let position = part.range.start;
      while (position <= part.range.end) {
        const length = Math.min(256 * 1024, part.range.end - position + 1);
        const chunk = Buffer.allocUnsafe(length);
        const { bytesRead } = await fd.read(chunk, 0, length, position);
        if (bytesRead <= 0) break;
        await write(bytesRead === length ? chunk : chunk.subarray(0, bytesRead));
        position += bytesRead;
      }
    }
    out.end(layout.closing);
  } catch (error) {
    out.destroy(error as Error);
  } finally {
    await fd.close();
  }
}
