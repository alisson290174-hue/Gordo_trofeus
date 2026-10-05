import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  extract3dsProductCode,
  findInstalled3dsTitle,
  read3dsHeader,
} from "./n3ds-title";

const ncch = (
  productCode: string,
  { decrypted = false, programId = 0n } = {}
) => {
  const header = Buffer.alloc(0x200);
  header.write("NCCH", 0x100, "latin1");
  header.writeBigUInt64LE(programId, 0x118);
  header.write(productCode, 0x150, "latin1");
  if (decrypted) header[0x18f] = 0x04;
  return header;
};

/** Minimal CIA: header, cert chain, ticket and TMD sections (64-byte aligned), then the NCCH. */
const cia = (content: Buffer) => {
  const header = Buffer.alloc(0x2040);
  header.writeUInt32LE(0x2020, 0x00);
  header.writeUInt32LE(0xa00, 0x08);
  header.writeUInt32LE(0x350, 0x0c);
  header.writeUInt32LE(0xb34, 0x10);
  return Buffer.concat([header, Buffer.alloc(0xa00 + 0x380 + 0xb40), content]);
};

describe("3DS headers", () => {
  let dir: string;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "n3ds-"));
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("reads the product code from an NCSD (.3ds) image", async () => {
    const ncsd = Buffer.alloc(0x4000);
    ncsd.write("NCSD", 0x100, "latin1");
    ncsd.writeUInt32LE(0x4000 / 0x200, 0x120); // partition 0 starts at 0x4000
    const file = path.join(dir, "Pokemon X.3ds");
    fs.writeFileSync(
      file,
      Buffer.concat([ncsd, ncch("CTR-P-EKJA", { decrypted: true })])
    );
    assert.equal(await extract3dsProductCode(file), "CTR-P-EKJA");
    assert.equal((await read3dsHeader(file))?.encrypted, false);
  });

  it("reads a bare NCCH (.cxi)", async () => {
    const file = path.join(dir, "Game.cxi");
    fs.writeFileSync(file, ncch("CTR-P-AREE"));
    assert.equal(await extract3dsProductCode(file), "CTR-P-AREE");
  });

  it("reads a decrypted CIA with its title id", async () => {
    const file = path.join(dir, "Game.cia");
    fs.writeFileSync(
      file,
      cia(
        ncch("CTR-P-ECRA", { decrypted: true, programId: 0x000400000011c400n })
      )
    );
    assert.deepEqual(await read3dsHeader(file), {
      productCode: "CTR-P-ECRA",
      titleId: "000400000011c400",
      encrypted: false,
    });
  });

  it("flags encrypted dumps", async () => {
    const file = path.join(dir, "Encrypted.cia");
    fs.writeFileSync(file, cia(ncch("CTR-P-ECLA")));
    assert.equal((await read3dsHeader(file))?.encrypted, true);
    // Title-key encrypted content hides even the NCCH magic.
    const hidden = path.join(dir, "Hidden.cia");
    fs.writeFileSync(hidden, cia(Buffer.alloc(0x200, 0x5a)));
    assert.equal((await read3dsHeader(hidden))?.encrypted, true);
  });

  it("returns null for other files", async () => {
    const file = path.join(dir, "Homebrew.3dsx");
    fs.writeFileSync(file, Buffer.alloc(0x400));
    assert.equal(await read3dsHeader(file), null);
    const junk = path.join(dir, "junk.3ds");
    fs.writeFileSync(junk, Buffer.alloc(0x400));
    assert.equal(await extract3dsProductCode(junk), null);
  });

  it("finds a title installed in a portable Azahar", async () => {
    const exe = path.join(dir, "azahar", "azahar.exe");
    const sd = "0".repeat(32);
    const content = path.join(
      dir,
      "azahar",
      "user",
      "sdmc",
      "Nintendo 3DS",
      sd,
      sd,
      "title",
      "00040000",
      "0011c400",
      "content"
    );
    fs.mkdirSync(content, { recursive: true });
    fs.writeFileSync(path.join(content, "00000000.app"), "");
    fs.writeFileSync(path.join(content, "00000000.tmd"), "");
    assert.equal(
      await findInstalled3dsTitle(exe, "000400000011c400"),
      path.join(content, "00000000.app")
    );
    assert.equal(await findInstalled3dsTitle(exe, "0004000000055d00"), null);
    assert.equal(await findInstalled3dsTitle(exe, "../../etc"), null);
  });
});
