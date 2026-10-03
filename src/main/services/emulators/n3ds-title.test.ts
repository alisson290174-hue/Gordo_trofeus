import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { extract3dsProductCode } from "./n3ds-title";

const ncch = (productCode: string) => {
  const header = Buffer.alloc(0x200);
  header.write("NCCH", 0x100, "latin1");
  header.write(productCode, 0x150, "latin1");
  return header;
};

describe("extract3dsProductCode", () => {
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
    fs.writeFileSync(file, Buffer.concat([ncsd, ncch("CTR-P-EKJA")]));
    assert.equal(await extract3dsProductCode(file), "CTR-P-EKJA");
  });

  it("reads a bare NCCH (.cxi)", async () => {
    const file = path.join(dir, "Game.cxi");
    fs.writeFileSync(file, ncch("CTR-P-AREE"));
    assert.equal(await extract3dsProductCode(file), "CTR-P-AREE");
  });

  it("returns null for other files", async () => {
    const file = path.join(dir, "Homebrew.3dsx");
    fs.writeFileSync(file, Buffer.alloc(0x400));
    assert.equal(await extract3dsProductCode(file), null);
    const junk = path.join(dir, "junk.3ds");
    fs.writeFileSync(junk, Buffer.alloc(0x400));
    assert.equal(await extract3dsProductCode(junk), null);
  });
});
