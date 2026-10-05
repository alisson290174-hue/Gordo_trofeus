import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { computePs2DiscHash, parseBootExecutable } from "./ps2-disc-hash";

const SECTOR = 2048;

/** Minimal ISO 9660 image: PVD at 16, root dir at 20, SYSTEM.CNF at 21, ELF at 22+. */
function buildIso(bootName: string, elf: Buffer) {
  const cnf = Buffer.from(
    `BOOT2 = cdrom0:\\${bootName};1\r\nVER = 1.00\r\n`,
    "latin1"
  );
  const elfSectors = Math.ceil(elf.length / SECTOR);
  const image = Buffer.alloc((22 + elfSectors) * SECTOR);

  const record = (name: string, lba: number, size: number, isDir: boolean) => {
    const nameBytes = Buffer.from(name, "latin1");
    const length = 33 + nameBytes.length + (nameBytes.length % 2 === 0 ? 1 : 0);
    const buffer = Buffer.alloc(length);
    buffer[0] = length;
    buffer.writeUInt32LE(lba, 2);
    buffer.writeUInt32LE(size, 10);
    buffer[25] = isDir ? 0x02 : 0;
    buffer[32] = nameBytes.length;
    nameBytes.copy(buffer, 33);
    return buffer;
  };

  const pvd = image.subarray(16 * SECTOR);
  pvd[0] = 1;
  pvd.write("CD001", 1, "latin1");
  record("\0", 20, SECTOR, true).copy(pvd, 156);

  Buffer.concat([
    record("\0", 20, SECTOR, true),
    record("\x01", 20, SECTOR, true),
    record("SYSTEM.CNF;1", 21, cnf.length, false),
    record(`${bootName};1`, 22, elf.length, false),
  ]).copy(image, 20 * SECTOR);
  cnf.copy(image, 21 * SECTOR);
  elf.copy(image, 22 * SECTOR);
  return image;
}

/** Same image as raw Mode 2 CD sectors (2352 bytes, user data at offset 24). */
function toRawMode2(iso: Buffer) {
  const sync = Buffer.from([0x00, ...Array(10).fill(0xff), 0x00]);
  const raw = Buffer.alloc((iso.length / SECTOR) * 2352);
  for (let s = 0; s < iso.length / SECTOR; s++) {
    sync.copy(raw, s * 2352);
    raw[s * 2352 + 15] = 2;
    iso.copy(raw, s * 2352 + 24, s * SECTOR, (s + 1) * SECTOR);
  }
  return raw;
}

describe("ps2-disc-hash", () => {
  let dir: string;
  const bootName = "SLUS_210.04";
  const elf = Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 251));
  const expected = createHash("md5").update(bootName).update(elf).digest("hex");

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ps2hash-"));
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("parses BOOT2 like rcheevos", () => {
    assert.equal(
      parseBootExecutable("BOOT2 = cdrom0:\\SLUS_212.68;1\r\n"),
      "SLUS_212.68"
    );
    assert.equal(
      parseBootExecutable("VER=1\nBOOT2=cdrom0:\\DATA\\MAIN.ELF;1"),
      "DATA\\MAIN.ELF"
    );
    assert.equal(parseBootExecutable("BOOT = cdrom:\\SLPS_000.01;1"), null);
  });

  it("hashes a 2048-byte ISO as md5(boot name + executable)", async () => {
    const file = path.join(dir, "game.iso");
    fs.writeFileSync(file, buildIso(bootName, elf));
    assert.equal(await computePs2DiscHash(file), expected);
  });

  it("gives the same hash for a raw 2352-byte BIN, directly and via CUE", async () => {
    const bin = path.join(dir, "game.bin");
    fs.writeFileSync(bin, toRawMode2(buildIso(bootName, elf)));
    assert.equal(await computePs2DiscHash(bin), expected);

    const cue = path.join(dir, "game.cue");
    fs.writeFileSync(
      cue,
      'FILE "game.bin" BINARY\n  TRACK 01 MODE2/2352\n    INDEX 01 00:00:00\n'
    );
    assert.equal(await computePs2DiscHash(cue), expected);
  });

  it("returns null for files that are not PS2 discs", async () => {
    const file = path.join(dir, "bios.bin");
    fs.writeFileSync(file, Buffer.alloc(64 * 1024));
    assert.equal(await computePs2DiscHash(file), null);
    assert.equal(await computePs2DiscHash(path.join(dir, "game.chd")), null);
  });
});
