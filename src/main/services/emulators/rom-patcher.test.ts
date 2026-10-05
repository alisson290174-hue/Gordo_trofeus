import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { applyBps, applyRomPatch, crc32, RomPatchError } from "./rom-patcher";

const bpsNumber = (value: number) => {
  const out: number[] = [];
  let data = value;
  for (;;) {
    const x = data & 0x7f;
    data = Math.floor(data / 128);
    if (data === 0) {
      out.push(0x80 | x);
      break;
    }
    out.push(x);
    data -= 1;
  }
  return out;
};

/** BPS turning "HELLO WORLD" into "HELLO MUNDO": SourceRead 6, TargetRead "MUNDO". */
const makeBps = (source: Uint8Array, target: Uint8Array) => {
  const body = [
    ..."BPS1".split("").map((c) => c.charCodeAt(0)),
    ...bpsNumber(source.length),
    ...bpsNumber(target.length),
    ...bpsNumber(0),
    ...bpsNumber(((6 - 1) << 2) | 0),
    ...bpsNumber(((5 - 1) << 2) | 1),
    ...Array.from(target.subarray(6)),
  ];
  const withCrcs = new Uint8Array(body.length + 12);
  withCrcs.set(body);
  const view = new DataView(withCrcs.buffer);
  view.setUint32(body.length, crc32(source), true);
  view.setUint32(body.length + 4, crc32(target), true);
  view.setUint32(body.length + 8, crc32(withCrcs, 0, body.length + 8), true);
  return withCrcs;
};

/** VCDIFF: source "ABCDEFGH" → target "ABCDXYZ" (COPY 4 from source, ADD "XYZ"). */
const VCDIFF = new Uint8Array([
  0xd6,
  0xc3,
  0xc4,
  0x00, // magic + version
  0x00, // header indicator: nothing extra
  0x01, // window: VCD_SOURCE
  0x08, // source segment length
  0x00, // source segment position
  0x0b, // length of the delta encoding below
  0x07, // target window length
  0x00, // delta indicator
  0x03, // data section length
  0x02, // instruction section length
  0x01, // address section length
  0x58,
  0x59,
  0x5a, // data "XYZ"
  20,
  4, // COPY size 4 mode 0, ADD size 3
  0x00, // address 0
]);

describe("ROM patcher", () => {
  let dir: string;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "patch-"));
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("applies a BPS patch and checks the source CRC", () => {
    const source = new TextEncoder().encode("HELLO WORLD");
    const target = new TextEncoder().encode("HELLO MUNDO");
    const patch = makeBps(source, target);
    assert.equal(
      new TextDecoder().decode(applyBps(source, patch)),
      "HELLO MUNDO"
    );
    assert.throws(
      () => applyBps(new TextEncoder().encode("HELLO THERE"), patch),
      (error: unknown) =>
        error instanceof RomPatchError && error.reason === "wrong_rom"
    );
  });

  it("applies a plain VCDIFF (xdelta3) patch", async () => {
    const source = path.join(dir, "rom.bin");
    const patch = path.join(dir, "fix.xdelta");
    const out = path.join(dir, "out.bin");
    fs.writeFileSync(source, "ABCDEFGH");
    fs.writeFileSync(patch, VCDIFF);
    await applyRomPatch(source, patch, out);
    assert.equal(fs.readFileSync(out, "latin1"), "ABCDXYZ");
  });

  it("refuses unknown patch formats", async () => {
    const source = path.join(dir, "rom2.bin");
    const patch = path.join(dir, "fix.ips");
    fs.writeFileSync(source, "ABCD");
    fs.writeFileSync(patch, "PATCHxxxxEOF");
    await assert.rejects(
      applyRomPatch(source, patch, path.join(dir, "o.bin")),
      (error: unknown) =>
        error instanceof RomPatchError && error.reason === "unsupported_format"
    );
  });
});
